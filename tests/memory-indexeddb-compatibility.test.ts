import Dexie from 'dexie';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  MEMORY_DATABASE_NAME,
  MEMORY_TABLE_NAME,
  MEMORY_TABLE_SCHEMAS,
} from '../core/memory/schema';
import {
  MEMORY_V1_ADDITIVE_RECORD,
  MEMORY_IMPORT_PREVIEW_RECORD,
  MEMORY_V2_ADDITIVE_RECORD,
  MEMORY_V2_RECORD,
  MEMORY_V3_PROJECT_ADDITIVE_RECORD,
  MEMORY_V3_PROJECT_RECORD,
  MEMORY_V3_RECORD,
} from './fixtures/persistence-contract/memory';

const indexedDbFactory = new IDBFactory();
const originalIndexedDb = Dexie.dependencies.indexedDB;
const originalIdbKeyRange = Dexie.dependencies.IDBKeyRange;

beforeAll(() => {
  Dexie.dependencies.indexedDB = indexedDbFactory;
  Dexie.dependencies.IDBKeyRange = IDBKeyRange;
  vi.stubGlobal('indexedDB', indexedDbFactory);
  vi.stubGlobal('IDBKeyRange', IDBKeyRange);
  vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue(MEMORY_V2_RECORD.syncId);
});

afterEach(async () => {
  const { db } = await import('../core/memory/store');
  db.close();
  await Dexie.delete(MEMORY_DATABASE_NAME);
});

afterAll(() => {
  Dexie.dependencies.indexedDB = originalIndexedDb;
  Dexie.dependencies.IDBKeyRange = originalIdbKeyRange;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Memory historical IndexedDB compatibility', () => {
  it('executes v1→v3 and v2→v3 upgrades while preserving additive fields across reopen', async () => {
    await seedMemoryDatabase(1, MEMORY_V1_ADDITIVE_RECORD);
    const {
      captureRawMemoryRecordsForSyncRecovery,
      db,
      replaceAllMemories,
      restoreRawMemoryRecordsForSyncRecovery,
    } = await import('../core/memory/store');

    await db.open();
    expect(await db.memories.toArray()).toEqual([{
      ...MEMORY_V3_RECORD,
      futureRecordField: MEMORY_V1_ADDITIVE_RECORD.futureRecordField,
    }]);
    db.close();
    await db.open();
    expect(await db.memories.toArray()).toEqual([{
      ...MEMORY_V3_RECORD,
      futureRecordField: MEMORY_V1_ADDITIVE_RECORD.futureRecordField,
    }]);

    db.close();
    await Dexie.delete(MEMORY_DATABASE_NAME);
    await seedMemoryDatabase(2, MEMORY_V2_ADDITIVE_RECORD);

    await db.open();
    expect(await db.memories.toArray()).toEqual([{
      ...MEMORY_V3_RECORD,
      futureRecordField: MEMORY_V2_ADDITIVE_RECORD.futureRecordField,
    }]);
    await db.memories.add({
      ...MEMORY_V3_PROJECT_ADDITIVE_RECORD,
      tags: [...MEMORY_V3_PROJECT_ADDITIVE_RECORD.tags],
    });
    db.close();

    await db.open();
    expect(await db.memories.orderBy('id').toArray()).toEqual([
      {
        ...MEMORY_V3_RECORD,
        futureRecordField: MEMORY_V2_ADDITIVE_RECORD.futureRecordField,
      },
      MEMORY_V3_PROJECT_ADDITIVE_RECORD,
    ]);
    expect(db.name).toBe(MEMORY_DATABASE_NAME);
    expect(db.memories.schema.primKey).toMatchObject({ name: 'id', auto: true });

    await db.memories.update(MEMORY_V3_RECORD.id, { recoveryFutureField: { preserve: true } } as never);
    const rawBefore = await captureRawMemoryRecordsForSyncRecovery();
    await replaceAllMemories([{ ...MEMORY_V3_RECORD, id: 99, tags: [...MEMORY_V3_RECORD.tags] }]);
    await restoreRawMemoryRecordsForSyncRecovery(rawBefore);
    expect(await db.memories.orderBy('id').toArray()).toEqual(rawBefore);
    const { id: _id, ...newMemory } = MEMORY_V3_PROJECT_RECORD;
    const nextIdAfterRollback = await db.memories.add({
      ...newMemory,
      syncId: '00000000-0000-4000-8000-000000000009',
      tags: [...newMemory.tags],
    });
    expect(nextIdAfterRollback).toBe(100);
  });

  it('rejects a future database version without overwriting its raw rows', async () => {
    const futureRecord = {
      ...MEMORY_V3_RECORD,
      futureDatabaseField: { preserve: true },
    };
    const future = new Dexie(MEMORY_DATABASE_NAME);
    future.version(4).stores({ [MEMORY_TABLE_NAME]: MEMORY_TABLE_SCHEMAS[3] });
    await future.open();
    await future.table(MEMORY_TABLE_NAME).add(futureRecord);
    future.close();

    const {
      db,
      getAllMemories,
      importMemoriesAtomically,
    } = await import('../core/memory/store');
    await expect(getAllMemories()).rejects.toBeInstanceOf(Error);
    await expect(importMemoriesAtomically([{
      ...MEMORY_IMPORT_PREVIEW_RECORD,
      tags: [...MEMORY_IMPORT_PREVIEW_RECORD.tags],
    }])).rejects.toBeInstanceOf(Error);
    db.close();

    const inspector = new Dexie(MEMORY_DATABASE_NAME);
    inspector.version(4).stores({ [MEMORY_TABLE_NAME]: MEMORY_TABLE_SCHEMAS[3] });
    await inspector.open();
    expect(await inspector.table(MEMORY_TABLE_NAME).toArray()).toEqual([futureRecord]);
    inspector.close();
  });
});

async function seedMemoryDatabase(version: 1 | 2, record: Record<string, unknown>): Promise<void> {
  const historical = new Dexie(MEMORY_DATABASE_NAME);
  historical.version(1).stores({ [MEMORY_TABLE_NAME]: MEMORY_TABLE_SCHEMAS[1] });
  if (version === 2) {
    historical.version(2).stores({ [MEMORY_TABLE_NAME]: MEMORY_TABLE_SCHEMAS[2] });
  }
  await historical.open();
  await historical.table(MEMORY_TABLE_NAME).add({ ...record });
  historical.close();
}
