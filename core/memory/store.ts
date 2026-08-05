import type { Memory, NewMemory } from '../types';
import { withSyncLocalStateLock } from '../persistence/local-state-lock';
import {
  IndexedDb,
  type IndexedDbTransaction,
} from '../persistence/indexeddb';
import {
  MEMORY_DATABASE_NAME,
  MEMORY_DATABASE_VERSION,
  MEMORY_TABLE_NAME,
  MEMORY_TABLE_SCHEMAS,
  migrateMemoryV1RecordToV2,
  migrateMemoryV2RecordToV3,
} from './schema';
import {
  decodeImportedMemory,
  decodePersistedMemoryRecord,
} from './codec';

// The IndexedDB version is the logical schema version x10 (the convention
// dexie established internally): released databases live at 10/20/30 and
// `assertCurrentMemoryDatabaseVersion` checks `backendDB().version === 30`.
const db = new IndexedDb(MEMORY_DATABASE_NAME, [
  {
    version: 10,
    stores: { [MEMORY_TABLE_NAME]: MEMORY_TABLE_SCHEMAS[1] },
  },
  {
    version: 20,
    stores: { [MEMORY_TABLE_NAME]: MEMORY_TABLE_SCHEMAS[2] },
    migrate: (tx) => {
      return tx.table(MEMORY_TABLE_NAME).modifyAll((memory) => {
        Object.assign(memory, migrateMemoryV1RecordToV2(memory, crypto.randomUUID()));
      });
    },
  },
  {
    version: 30,
    stores: { [MEMORY_TABLE_NAME]: MEMORY_TABLE_SCHEMAS[3] },
    migrate: (tx) => {
      return tx.table(MEMORY_TABLE_NAME).modifyAll((memory) => {
        Object.assign(memory, migrateMemoryV2RecordToV3(memory));
        delete memory.projectId;
      });
    },
  },
]);

const memories = db.table(MEMORY_TABLE_NAME);

export async function getAllMemories(): Promise<Memory[]> {
  return getAllMemoriesAlreadyLocked();
}

export async function getAllMemoriesAlreadyLocked(): Promise<Memory[]> {
  return readValidatedMemoryRecords();
}

export async function getMemoryById(id: number): Promise<Memory | undefined> {
  return (await readValidatedMemoryRecords()).find((memory) => memory.id === id);
}

export async function saveMemory(
  mem: NewMemory,
): Promise<number> {
  const [id] = await importMemoriesAtomically([mem]);
  if (id === undefined) throw new Error('Memory save did not create a record');
  return id;
}

export async function importMemoriesAtomically(
  memoriesToImport: readonly NewMemory[],
): Promise<number[]> {
  const validated = memoriesToImport.map((memory, index) => (
    decodeImportedMemory(memory, `memories[${index}]`)
  ));
  await assertCurrentMemoryDatabaseVersion();

  return withSyncLocalStateLock(() => db.transaction('rw', memories, async (tx) => {
    const table = tx.table(MEMORY_TABLE_NAME);
    const current = await readValidatedMemoryRecords(tx);
    const now = Date.now();
    const ids: number[] = [];
    // Rows this import already created, keyed by syncId, so a syncId repeated
    // *within one batch* merges into the same row instead of creating a second
    // duplicate (duplicate syncIds break sync apply occurrence matching, M10).
    const batchRows = new Map<string, Memory>();
    for (const memory of validated) {
      // Dedup by caller-supplied syncId: importing a record whose syncId
      // already exists locally (e.g. re-importing an export) must update the
      // existing row instead of creating a duplicate.
      const syncId = memory.syncId ?? crypto.randomUUID();
      const existing = memory.syncId
        ? current.find((record) => record.syncId === memory.syncId)
        : undefined;
      if (existing?.id !== undefined) {
        const merged: Memory = {
          ...existing,
          ...memory,
          id: existing.id,
          syncId,
          updatedAt: now,
        };
        await table.put(merged);
        ids.push(existing.id);
        continue;
      }
      if (memory.syncId) {
        const batchRow = batchRows.get(memory.syncId);
        if (batchRow?.id !== undefined) {
          const merged: Memory = {
            ...batchRow,
            ...memory,
            id: batchRow.id,
            syncId,
            updatedAt: now,
          };
          await table.put(merged);
          batchRows.set(memory.syncId, merged);
          ids.push(batchRow.id);
          continue;
        }
      }
      const record: Memory = {
        ...memory,
        syncId,
        createdAt: now,
        updatedAt: now,
        accessCount: 0,
        lastAccessedAt: now,
      } as Memory;
      const id = await table.add(record);
      const numericId = id as number;
      if (memory.syncId) batchRows.set(memory.syncId, { ...record, id: numericId });
      ids.push(numericId);
    }
    return ids;
  }));
}

export async function updateMemory(mem: Memory): Promise<void> {
  const validated = decodePersistedMemoryRecord(mem);
  const id = validated.id;
  if (id === undefined) throw new Error('Memory id is required');
  await assertCurrentMemoryDatabaseVersion();
  await withSyncLocalStateLock(() => db.transaction('rw', memories, async (tx) => {
    await readValidatedMemoryRecords(tx);
    await tx.table(MEMORY_TABLE_NAME).update(id, { ...validated, updatedAt: Date.now() });
  }));
}

export async function deleteMemory(id: number): Promise<void> {
  await assertCurrentMemoryDatabaseVersion();
  await withSyncLocalStateLock(() => db.transaction('rw', memories, async (tx) => {
    await readValidatedMemoryRecords(tx);
    await tx.table(MEMORY_TABLE_NAME).delete(id);
  }));
}

export async function deleteMemoriesForProject(projectId: string): Promise<number> {
  const trimmedProjectId = projectId.trim();
  if (!trimmedProjectId) throw new Error('Project id is required.');
  return withSyncLocalStateLock(() => deleteMemoriesForProjectAlreadyLocked(trimmedProjectId));
}

export async function deleteMemoriesForProjectAlreadyLocked(projectId: string): Promise<number> {
  const trimmedProjectId = projectId.trim();
  if (!trimmedProjectId) throw new Error('Project id is required.');
  await assertCurrentMemoryDatabaseVersion();
  return db.transaction('rw', memories, async (tx) => {
    await readValidatedMemoryRecords(tx);
    return tx.table(MEMORY_TABLE_NAME).where('projectId').equals(trimmedProjectId).delete();
  });
}

export async function assertMemoryRecordsValidAlreadyLocked(): Promise<void> {
  await readValidatedMemoryRecords();
}

export async function touchMemories(ids: number[]): Promise<void> {
  await assertCurrentMemoryDatabaseVersion();
  await withSyncLocalStateLock(async () => {
    await db.transaction('rw', memories, async (tx) => {
      const current = await readValidatedMemoryRecords(tx);
      const targetIds = new Set(ids);
      const now = Date.now();
      const touched = current
        .filter((memory) => memory.id !== undefined && targetIds.has(memory.id))
        .map((memory) => ({
          ...memory,
          accessCount: memory.accessCount + 1,
          lastAccessedAt: now,
        }));
      if (touched.length > 0) await tx.table(MEMORY_TABLE_NAME).bulkPut(touched);
    });
  });
}

export async function replaceAllMemories(memoriesToReplace: readonly Memory[]): Promise<void> {
  await withSyncLocalStateLock(() => replaceAllMemoriesForSyncApply(memoriesToReplace));
}

export async function replaceAllMemoriesForSyncApply(memoriesToReplace: readonly Memory[]): Promise<void> {
  const validated = memoriesToReplace.map((memory, index) => (
    decodePersistedMemoryRecord(memory, `memories[${index}]`)
  ));
  await assertCurrentMemoryDatabaseVersion();
  await db.transaction('rw', memories, async (tx) => {
    const table = tx.table(MEMORY_TABLE_NAME);
    await readValidatedMemoryRecords(tx);
    await table.clear();
    await table.bulkAdd(validated);
  });
}

export async function captureRawMemoryRecordsForSyncRecovery(): Promise<Record<string, unknown>[]> {
  await assertCurrentMemoryDatabaseVersion();
  return memories.toArray() as unknown as Record<string, unknown>[];
}

export async function restoreRawMemoryRecordsForSyncRecovery(
  records: readonly Record<string, unknown>[],
): Promise<void> {
  // Recovery must restore the opaque preimage byte-for-byte, including state
  // that a newer runtime cannot decode. Ordinary reads and writes validate it.
  await assertCurrentMemoryDatabaseVersion();
  await db.transaction('rw', memories, async (tx) => {
    const table = tx.table(MEMORY_TABLE_NAME);
    await table.clear();
    await table.bulkAdd(records.map((record) => ({ ...record })) as unknown as Memory[]);
  });
}

const STALE_THRESHOLD_DAYS = 90;
const MIN_ACCESS_FOR_RETENTION = 3;

export async function archiveStaleMemories(): Promise<number> {
  await assertCurrentMemoryDatabaseVersion();
  return withSyncLocalStateLock(async () => {
    return db.transaction('rw', memories, async (tx) => {
      const threshold = Date.now() - STALE_THRESHOLD_DAYS * 86_400_000;
      const current = await readValidatedMemoryRecords(tx);
      const ids = current
        .filter((memory) => (
          memory.lastAccessedAt < threshold
          && !memory.pinned
          && memory.accessCount < MIN_ACCESS_FOR_RETENTION
        ))
        .map((memory) => memory.id)
        .filter((id): id is number => id !== undefined);

      if (ids.length > 0) await tx.table(MEMORY_TABLE_NAME).bulkDelete(ids);
      return ids.length;
    });
  });
}

export { db };

async function readValidatedMemoryRecords(tx?: IndexedDbTransaction): Promise<Memory[]> {
  await assertCurrentMemoryDatabaseVersion();
  const table = tx ? tx.table(MEMORY_TABLE_NAME) : memories;
  const records = await table.toArray() as unknown[];
  return records.map((record, index) => (
    decodePersistedMemoryRecord(record, `memories[${index}]`)
  ));
}

async function assertCurrentMemoryDatabaseVersion(): Promise<void> {
  await db.open();
  const actualVersion = db.backendDB().version;
  const expectedVersion = MEMORY_DATABASE_VERSION * 10;
  if (actualVersion !== expectedVersion) {
    throw new Error(
      `Memory database version ${actualVersion / 10} is not supported by version ${MEMORY_DATABASE_VERSION}`,
    );
  }
}
