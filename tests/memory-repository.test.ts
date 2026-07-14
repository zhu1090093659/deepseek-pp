import Dexie from 'dexie';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Memory, NewMemory } from '../core/types';
import { MEMORY_DATABASE_NAME } from '../core/memory/schema';
import {
  MEMORY_CORRUPT_RAW_RECORD,
  MEMORY_HISTORICAL_EXPORT_RECORD,
  MEMORY_IMPORT_PREVIEW_RECORD,
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
});

beforeEach(async () => {
  const { db } = await import('../core/memory/store');
  if (!db.isOpen()) await db.open();
});

afterEach(async () => {
  const { db } = await import('../core/memory/store');
  db.close();
  await Dexie.delete(MEMORY_DATABASE_NAME);
  vi.restoreAllMocks();
});

afterAll(() => {
  Dexie.dependencies.indexedDB = originalIndexedDb;
  Dexie.dependencies.IDBKeyRange = originalIdbKeyRange;
  vi.unstubAllGlobals();
});

describe('Memory repository transaction and codec boundaries', () => {
  it('imports preview-style drafts and historical exports atomically, including empty descriptions', async () => {
    const generatedSyncId = '00000000-0000-4000-8000-000000000101';
    vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue(generatedSyncId);
    vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
    const { db, importMemoriesAtomically } = await import('../core/memory/store');

    const ids = await importMemoriesAtomically([
      cloneDraft(MEMORY_IMPORT_PREVIEW_RECORD),
      cloneDraft(MEMORY_HISTORICAL_EXPORT_RECORD),
    ]);

    expect(ids).toEqual([1, 2]);
    expect(await db.memories.orderBy('id').toArray()).toEqual([
      {
        ...MEMORY_IMPORT_PREVIEW_RECORD,
        tags: [...MEMORY_IMPORT_PREVIEW_RECORD.tags],
        id: 1,
        syncId: generatedSyncId,
        scope: 'global',
        projectId: undefined,
        createdAt: 1_700_000_000_000,
        updatedAt: 1_700_000_000_000,
        accessCount: 0,
        lastAccessedAt: 1_700_000_000_000,
      },
      {
        type: MEMORY_HISTORICAL_EXPORT_RECORD.type,
        name: MEMORY_HISTORICAL_EXPORT_RECORD.name,
        content: MEMORY_HISTORICAL_EXPORT_RECORD.content,
        description: '',
        tags: [...MEMORY_HISTORICAL_EXPORT_RECORD.tags],
        pinned: MEMORY_HISTORICAL_EXPORT_RECORD.pinned,
        id: 2,
        syncId: MEMORY_HISTORICAL_EXPORT_RECORD.syncId,
        scope: 'global',
        projectId: undefined,
        createdAt: 1_700_000_000_000,
        updatedAt: 1_700_000_000_000,
        accessCount: 0,
        lastAccessedAt: 1_700_000_000_000,
      },
    ]);
  });

  it('rolls back the whole import batch when the Nth IndexedDB write fails', async () => {
    const { db, importMemoriesAtomically } = await import('../core/memory/store');
    let writeCount = 0;
    const failOnSecondWrite = () => {
      writeCount += 1;
      if (writeCount === 2) throw new Error('injected second write failure');
    };
    db.memories.hook('creating', failOnSecondWrite);

    try {
      await expect(importMemoriesAtomically([
        draft('batch-1', 'sync-batch-1'),
        draft('batch-2', 'sync-batch-2'),
        draft('batch-3', 'sync-batch-3'),
      ])).rejects.toThrow('injected second write failure');
    } finally {
      db.memories.hook('creating').unsubscribe(failOnSecondWrite);
    }

    expect(writeCount).toBe(2);
    await expect(db.memories.toArray()).resolves.toEqual([]);
  });

  it('serializes concurrent import batches without interleaving their rows', async () => {
    const { db, importMemoriesAtomically } = await import('../core/memory/store');
    const [firstIds, secondIds] = await Promise.all([
      importMemoriesAtomically([
        draft('first-1', 'sync-first-1'),
        draft('first-2', 'sync-first-2'),
      ]),
      importMemoriesAtomically([
        draft('second-1', 'sync-second-1'),
        draft('second-2', 'sync-second-2'),
      ]),
    ]);

    expect(firstIds).toEqual([1, 2]);
    expect(secondIds).toEqual([3, 4]);
    expect((await db.memories.orderBy('id').toArray()).map((memory) => memory.name)).toEqual([
      'first-1',
      'first-2',
      'second-1',
      'second-2',
    ]);
  });

  it('blocks ordinary reads, writes, and sync replacement when raw state is corrupt', async () => {
    const {
      db,
      getAllMemories,
      replaceAllMemoriesForSyncApply,
      saveMemory,
      updateMemory,
    } = await import('../core/memory/store');
    const corrupt = cloneRaw(MEMORY_CORRUPT_RAW_RECORD);
    await db.memories.add(corrupt as unknown as Memory);

    await expect(getAllMemories()).rejects.toThrow('memories[0].scope');
    await expect(saveMemory(draft('blocked-write', 'sync-blocked-write')))
      .rejects.toThrow('memories[0].scope');
    await expect(updateMemory(cloneMemory({
      ...MEMORY_V3_RECORD,
      id: 99,
      tags: [...MEMORY_V3_RECORD.tags],
    }))).rejects.toThrow('memories[0].scope');
    await expect(replaceAllMemoriesForSyncApply([cloneMemory({
      ...MEMORY_V3_RECORD,
      tags: [...MEMORY_V3_RECORD.tags],
    })]))
      .rejects.toThrow('memories[0].scope');
    await expect(db.memories.toArray()).resolves.toEqual([corrupt]);
  });

  it('rejects an update without a persisted id instead of reporting a no-op success', async () => {
    const { db, updateMemory } = await import('../core/memory/store');
    const withoutId = cloneMemory({
      ...MEMORY_V3_RECORD,
      tags: [...MEMORY_V3_RECORD.tags],
    });
    delete withoutId.id;

    await expect(updateMemory(withoutId))
      .rejects.toThrow('memory.id must be a positive safe integer');
    await expect(db.memories.toArray()).resolves.toEqual([]);
  });

  it('lets the raw recovery path restore opaque corrupt rows without codec downgrade', async () => {
    const {
      captureRawMemoryRecordsForSyncRecovery,
      getAllMemories,
      restoreRawMemoryRecordsForSyncRecovery,
    } = await import('../core/memory/store');
    const corrupt = cloneRaw(MEMORY_CORRUPT_RAW_RECORD);

    await expect(restoreRawMemoryRecordsForSyncRecovery([corrupt])).resolves.toBeUndefined();
    await expect(captureRawMemoryRecordsForSyncRecovery()).resolves.toEqual([corrupt]);
    await expect(getAllMemories()).rejects.toThrow('memories[0].scope');
  });
});

function draft(name: string, syncId: string): NewMemory {
  return {
    syncId,
    type: 'reference',
    name,
    content: `content:${name}`,
    description: '',
    tags: ['repository'],
    pinned: false,
  };
}

function cloneDraft(record: Record<string, unknown>): NewMemory {
  return {
    ...(record as NewMemory),
    tags: [...(record.tags as string[])],
  };
}

function cloneMemory(record: Memory): Memory {
  return { ...record, tags: [...record.tags] };
}

function cloneRaw(record: Record<string, unknown>): Record<string, unknown> {
  return {
    ...record,
    tags: [...(record.tags as string[])],
    recoveryOnlyField: { ...(record.recoveryOnlyField as Record<string, unknown>) },
  };
}
