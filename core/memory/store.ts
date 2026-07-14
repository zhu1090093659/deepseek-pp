import Dexie, { type EntityTable } from 'dexie';
import type { Memory, NewMemory } from '../types';
import { withSyncLocalStateLock } from '../persistence/local-state-lock';
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

const db = new Dexie(MEMORY_DATABASE_NAME) as Dexie & {
  memories: EntityTable<Memory, 'id'>;
};

db.version(1).stores({
  [MEMORY_TABLE_NAME]: MEMORY_TABLE_SCHEMAS[1],
});

db.version(2)
  .stores({
    [MEMORY_TABLE_NAME]: MEMORY_TABLE_SCHEMAS[2],
  })
  .upgrade((tx) => {
    return tx
      .table(MEMORY_TABLE_NAME)
      .toCollection()
      .modify((memory: Record<string, unknown>) => {
        Object.assign(memory, migrateMemoryV1RecordToV2(memory, crypto.randomUUID()));
      });
  });

db.version(3)
  .stores({
    [MEMORY_TABLE_NAME]: MEMORY_TABLE_SCHEMAS[3],
  })
  .upgrade((tx) => {
    return tx
      .table(MEMORY_TABLE_NAME)
      .toCollection()
      .modify((memory: Record<string, unknown>) => {
        Object.assign(memory, migrateMemoryV2RecordToV3(memory));
        delete memory.projectId;
      });
  });

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
  memories: readonly NewMemory[],
): Promise<number[]> {
  const validated = memories.map((memory, index) => (
    decodeImportedMemory(memory, `memories[${index}]`)
  ));
  await assertCurrentMemoryDatabaseVersion();

  return withSyncLocalStateLock(() => db.transaction('rw', db.memories, async () => {
    await readValidatedMemoryRecords();
    const now = Date.now();
    const ids: number[] = [];
    for (const memory of validated) {
      const id = await db.memories.add({
        ...memory,
        syncId: memory.syncId ?? crypto.randomUUID(),
        createdAt: now,
        updatedAt: now,
        accessCount: 0,
        lastAccessedAt: now,
      } as Memory);
      ids.push(id as number);
    }
    return ids;
  }));
}

export async function updateMemory(mem: Memory): Promise<void> {
  const validated = decodePersistedMemoryRecord(mem);
  const id = validated.id;
  if (id === undefined) throw new Error('Memory id is required');
  await assertCurrentMemoryDatabaseVersion();
  await withSyncLocalStateLock(() => db.transaction('rw', db.memories, async () => {
    await readValidatedMemoryRecords();
    await db.memories.update(id, { ...validated, updatedAt: Date.now() });
  }));
}

export async function deleteMemory(id: number): Promise<void> {
  await assertCurrentMemoryDatabaseVersion();
  await withSyncLocalStateLock(() => db.transaction('rw', db.memories, async () => {
    await readValidatedMemoryRecords();
    await db.memories.delete(id);
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
  return db.transaction('rw', db.memories, async () => {
    await readValidatedMemoryRecords();
    return db.memories.where('projectId').equals(trimmedProjectId).delete();
  });
}

export async function assertMemoryRecordsValidAlreadyLocked(): Promise<void> {
  await readValidatedMemoryRecords();
}

export async function touchMemories(ids: number[]): Promise<void> {
  await assertCurrentMemoryDatabaseVersion();
  await withSyncLocalStateLock(async () => {
    await db.transaction('rw', db.memories, async () => {
      const current = await readValidatedMemoryRecords();
      const targetIds = new Set(ids);
      const now = Date.now();
      const touched = current
        .filter((memory) => memory.id !== undefined && targetIds.has(memory.id))
        .map((memory) => ({
          ...memory,
          accessCount: memory.accessCount + 1,
          lastAccessedAt: now,
        }));
      if (touched.length > 0) await db.memories.bulkPut(touched);
    });
  });
}

export async function replaceAllMemories(memories: readonly Memory[]): Promise<void> {
  await withSyncLocalStateLock(() => replaceAllMemoriesForSyncApply(memories));
}

export async function replaceAllMemoriesForSyncApply(memories: readonly Memory[]): Promise<void> {
  const validated = memories.map((memory, index) => (
    decodePersistedMemoryRecord(memory, `memories[${index}]`)
  ));
  await assertCurrentMemoryDatabaseVersion();
  await db.transaction('rw', db.memories, async () => {
    await readValidatedMemoryRecords();
    await db.memories.clear();
    await db.memories.bulkAdd(validated);
  });
}

export async function captureRawMemoryRecordsForSyncRecovery(): Promise<Record<string, unknown>[]> {
  await assertCurrentMemoryDatabaseVersion();
  return db.memories.toArray() as unknown as Record<string, unknown>[];
}

export async function restoreRawMemoryRecordsForSyncRecovery(
  records: readonly Record<string, unknown>[],
): Promise<void> {
  // Recovery must restore the opaque preimage byte-for-byte, including state
  // that a newer runtime cannot decode. Ordinary reads and writes validate it.
  await assertCurrentMemoryDatabaseVersion();
  await db.transaction('rw', db.memories, async () => {
    await db.memories.clear();
    await db.memories.bulkAdd(records.map((record) => ({ ...record })) as unknown as Memory[]);
  });
}

const STALE_THRESHOLD_DAYS = 90;
const MIN_ACCESS_FOR_RETENTION = 3;

export async function archiveStaleMemories(): Promise<number> {
  await assertCurrentMemoryDatabaseVersion();
  return withSyncLocalStateLock(async () => {
    return db.transaction('rw', db.memories, async () => {
      const threshold = Date.now() - STALE_THRESHOLD_DAYS * 86_400_000;
      const current = await readValidatedMemoryRecords();
      const ids = current
        .filter((memory) => (
          memory.lastAccessedAt < threshold
          && !memory.pinned
          && memory.accessCount < MIN_ACCESS_FOR_RETENTION
        ))
        .map((memory) => memory.id)
        .filter((id): id is number => id !== undefined);

      if (ids.length > 0) await db.memories.bulkDelete(ids);
      return ids.length;
    });
  });
}

export { db };

async function readValidatedMemoryRecords(): Promise<Memory[]> {
  await assertCurrentMemoryDatabaseVersion();
  const records = await db.memories.toArray() as unknown[];
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
