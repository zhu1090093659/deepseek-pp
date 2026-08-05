import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  IndexedDb,
  type IndexedDbUpgradeStep,
} from '../core/persistence/indexeddb';
import { parseDexieSchema } from '../core/persistence/indexeddb-schema';
import { deleteIndexedDb } from './helpers/indexeddb';

const MEMORIES_SCHEMA_V1 = '++id, type, name, pinned, createdAt, updatedAt, lastAccessedAt';
const MEMORIES_SCHEMA_V2 = `${MEMORIES_SCHEMA_V1}, syncId`;
const MEMORIES_SCHEMA_V3 = `${MEMORIES_SCHEMA_V2}, scope, projectId`;

let indexedDbFactory: IDBFactory;
let databaseCounter = 0;
let openDatabases: IndexedDb[] = [];

function track(db: IndexedDb): IndexedDb {
  openDatabases.push(db);
  return db;
}

function memoryUpgrades(): IndexedDbUpgradeStep[] {
  return [
    {
      version: 10,
      stores: { memories: MEMORIES_SCHEMA_V1 },
    },
    {
      version: 20,
      stores: { memories: MEMORIES_SCHEMA_V2 },
      migrate: (tx) => tx.table('memories').modifyAll((memory) => {
        memory.syncId = memory.syncId ?? 'migrated-v2';
      }),
    },
    {
      version: 30,
      stores: { memories: MEMORIES_SCHEMA_V3 },
      migrate: (tx) => tx.table('memories').modifyAll((memory) => {
        delete memory.projectId;
        memory.scope = 'global';
      }),
    },
  ];
}

beforeEach(() => {
  indexedDbFactory = new IDBFactory();
  vi.stubGlobal('indexedDB', indexedDbFactory);
  vi.stubGlobal('IDBKeyRange', IDBKeyRange);
});

afterEach(async () => {
  for (const db of openDatabases) db.close();
  openDatabases = [];
  await deleteIndexedDb(`wrapper-${databaseCounter}`);
  vi.unstubAllGlobals();
});

function nextDbName(): string {
  databaseCounter += 1;
  return `wrapper-${databaseCounter}`;
}

function freshDb(upgrades: IndexedDbUpgradeStep[] = memoryUpgrades()): IndexedDb {
  return track(new IndexedDb(nextDbName(), upgrades));
}

/** Seeds a database at a single historical version with one row. */
async function seedAt(
  name: string,
  version: number,
  schema: string,
  row: Record<string, unknown>,
): Promise<void> {
  const historical = track(new IndexedDb(name, [{ version, stores: { memories: schema } }]));
  await historical.open();
  await historical.table('memories').add(row);
  historical.close();
}

describe('IndexedDb thin wrapper', () => {
  describe('dexie schema translation', () => {
    it('translates an auto-increment primary key and plain indexes', () => {
      expect(parseDexieSchema(MEMORIES_SCHEMA_V3)).toEqual({
        keyPath: 'id',
        autoIncrement: true,
        indexes: [
          { name: 'type', keyPath: 'type', unique: false, multiEntry: false },
          { name: 'name', keyPath: 'name', unique: false, multiEntry: false },
          { name: 'pinned', keyPath: 'pinned', unique: false, multiEntry: false },
          { name: 'createdAt', keyPath: 'createdAt', unique: false, multiEntry: false },
          { name: 'updatedAt', keyPath: 'updatedAt', unique: false, multiEntry: false },
          { name: 'lastAccessedAt', keyPath: 'lastAccessedAt', unique: false, multiEntry: false },
          { name: 'syncId', keyPath: 'syncId', unique: false, multiEntry: false },
          { name: 'scope', keyPath: 'scope', unique: false, multiEntry: false },
          { name: 'projectId', keyPath: 'projectId', unique: false, multiEntry: false },
        ],
      });
    });

    it('translates a unique in-line primary key and unique/multi-entry indexes', () => {
      expect(parseDexieSchema('&id, &email, *tags')).toEqual({
        keyPath: 'id',
        autoIncrement: false,
        indexes: [
          { name: 'email', keyPath: 'email', unique: true, multiEntry: false },
          { name: 'tags', keyPath: 'tags', unique: false, multiEntry: true },
        ],
      });
      expect(parseDexieSchema('id, createdAt')).toEqual({
        keyPath: 'id',
        autoIncrement: false,
        indexes: [{ name: 'createdAt', keyPath: 'createdAt', unique: false, multiEntry: false }],
      });
    });
  });

  it('creates a fresh database directly at the target version with the final schema', async () => {
    const db = freshDb();
    await db.open();
    expect(db.isOpen()).toBe(true);
    expect(db.backendDB().version).toBe(30);
    expect(db.name).toBe(`wrapper-${databaseCounter}`);

    const memories = db.table('memories');
    expect(memories.schema.primKey).toMatchObject({ name: 'id', keyPath: 'id', auto: true, unique: true });
    expect(memories.schema.indexes.map((index) => index.name)).toEqual([
      'type', 'name', 'pinned', 'createdAt', 'updatedAt', 'lastAccessedAt', 'syncId', 'scope', 'projectId',
    ]);
    expect(await memories.count()).toBe(0);

    const id = await memories.add({ type: 'reference', name: 'fresh' });
    expect(id).toBe(1);
    expect(await memories.get(id)).toMatchObject({ id: 1, name: 'fresh' });
  });

  it('applies 10→20→30 upgrades step by step with additive fields preserved', async () => {
    const name = nextDbName();
    await seedAt(name, 10, MEMORIES_SCHEMA_V1, {
      id: 7,
      type: 'topic',
      name: 'historical',
      pinned: false,
      createdAt: 100,
      updatedAt: 110,
      lastAccessedAt: 120,
      futureField: { preserve: true },
    });

    const db = track(new IndexedDb(name, memoryUpgrades()));
    const memories = db.table('memories');
    await db.open();
    expect(db.backendDB().version).toBe(30);
    expect(await memories.orderBy('id').toArray()).toEqual([{
      id: 7,
      type: 'topic',
      name: 'historical',
      pinned: false,
      createdAt: 100,
      updatedAt: 110,
      lastAccessedAt: 120,
      futureField: { preserve: true },
      syncId: 'migrated-v2',
      scope: 'global',
    }]);
  });

  it('runs only the v2→v3 step for databases already at 20', async () => {
    const name = nextDbName();
    await seedAt(name, 20, MEMORIES_SCHEMA_V2, {
      id: 3,
      type: 'topic',
      name: 'v2-era',
      pinned: false,
      createdAt: 100,
      updatedAt: 110,
      lastAccessedAt: 120,
      syncId: 'original-sync-id',
      projectId: 'stale-project',
    });

    const db = track(new IndexedDb(name, memoryUpgrades()));
    const memories = db.table('memories');
    await db.open();
    expect(await memories.orderBy('id').toArray()).toEqual([{
      id: 3,
      type: 'topic',
      name: 'v2-era',
      pinned: false,
      createdAt: 100,
      updatedAt: 110,
      lastAccessedAt: 120,
      syncId: 'original-sync-id',
      scope: 'global',
    }]);
  });

  it('aborts a failed migration visibly and preserves the original database', async () => {
    const name = nextDbName();
    await seedAt(name, 10, MEMORIES_SCHEMA_V1, {
      id: 5,
      type: 'topic',
      name: 'untouched',
      pinned: false,
    });

    const db = track(new IndexedDb(name, [
      { version: 10, stores: { memories: MEMORIES_SCHEMA_V1 } },
      {
        version: 20,
        stores: { memories: MEMORIES_SCHEMA_V2 },
        migrate: () => {
          throw new Error('injected migration failure');
        },
      },
      { version: 30, stores: { memories: MEMORIES_SCHEMA_V3 } },
    ]));
    await expect(db.open()).rejects.toThrow('injected migration failure');
    expect(db.isOpen()).toBe(false);

    const inspector = track(new IndexedDb(name, [
      { version: 10, stores: { memories: MEMORIES_SCHEMA_V1 } },
    ]));
    await inspector.open();
    expect(inspector.backendDB().version).toBe(10);
    expect(await inspector.table('memories').orderBy('id').toArray()).toEqual([
      { id: 5, type: 'topic', name: 'untouched', pinned: false },
    ]);
    inspector.close();
  });

  it('fails visibly when the existing version is not on a released upgrade step', async () => {
    const name = nextDbName();
    // A database at 15 cannot come from any released runtime.
    const { createIndexedDbAtVersion, createStore } = await import('./helpers/indexeddb');
    await createIndexedDbAtVersion(name, 15, (db) => {
      createStore(db, 'memories', { keyPath: 'id', autoIncrement: true });
    });

    const db = track(new IndexedDb(name, memoryUpgrades()));
    await expect(db.open()).rejects.toThrow('version 15 is not on a supported upgrade step');
    expect(db.isOpen()).toBe(false);
  });

  it('opens a future-version database without upgrading or touching its rows', async () => {
    const name = nextDbName();
    const { createIndexedDbAtVersion, createStore, addIndexedDbRecords } = await import('./helpers/indexeddb');
    await createIndexedDbAtVersion(name, 40, (db) => {
      createStore(db, 'memories', { keyPath: 'id', autoIncrement: true, indexes: ['type'] });
    });
    const futureRow = { id: 1, type: 'future', name: 'opaque', futureField: { preserve: true } };
    await addIndexedDbRecords(name, 'memories', [futureRow]);

    const db = track(new IndexedDb(name, memoryUpgrades()));
    await expect(db.open()).resolves.toBeUndefined();
    expect(db.backendDB().version).toBe(40);
    expect(await db.table('memories').toArray()).toEqual([futureRow]);
  });

  it('commits multi-operation transactions atomically and rolls back on failure', async () => {
    const db = freshDb();
    const memories = db.table('memories');

    await db.transaction('rw', memories, async (tx) => {
      const table = tx.table('memories');
      await table.add({ type: 'reference', name: 'first' });
      await table.add({ type: 'reference', name: 'second' });
    });
    expect(await memories.count()).toBe(2);

    await expect(db.transaction('rw', memories, async (tx) => {
      await tx.table('memories').add({ type: 'reference', name: 'rolled-back' });
      throw new Error('injected transaction failure');
    })).rejects.toThrow('injected transaction failure');
    expect(await memories.count()).toBe(2);

    await expect(db.transaction('rw', memories, async (tx) => {
      await tx.table('memories').add({ type: 'reference', name: 'conflict' });
      await tx.table('memories').add({ type: 'reference', name: 'conflict', id: 1 });
    })).rejects.toThrow();
    expect(await memories.count()).toBe(2);
  });

  it('reads its own writes inside a transaction and merges update changes partially', async () => {
    const db = freshDb();
    const memories = db.table('memories');
    const id = await memories.add({ type: 'reference', name: 'original', extra: { keep: true } });

    await db.transaction('rw', memories, async (tx) => {
      const table = tx.table('memories');
      expect((await table.get(id))).toMatchObject({ name: 'original' });
      expect(await table.update(id, { name: 'updated' })).toBe(1);
      expect(await table.get(id)).toMatchObject({ name: 'updated', extra: { keep: true } });
    });

    expect(await memories.get(id)).toMatchObject({ name: 'updated', extra: { keep: true } });
    expect(await memories.update(999, { name: 'missing' })).toBe(0);
    expect(await memories.get(999)).toBeUndefined();
  });

  it('deletes by index equality and orders by index descending primary keys', async () => {
    const db = freshDb();
    const memories = db.table('memories');
    await memories.bulkAdd([
      { id: 1, type: 'topic', name: 'a', pinned: false, scope: 'project', projectId: 'p1', syncId: 's1' },
      { id: 2, type: 'topic', name: 'b', pinned: false, scope: 'project', projectId: 'p1', syncId: 's2' },
      { id: 3, type: 'topic', name: 'c', pinned: false, scope: 'global', projectId: 'p2', syncId: 's3' },
    ]);

    expect(await memories.where('projectId').equals('p1').delete()).toBe(2);
    expect(await memories.orderBy('id').toArray()).toEqual([
      expect.objectContaining({ id: 3 }),
    ]);

    await memories.bulkAdd([
      { id: 4, type: 'topic', name: 'd', pinned: false, scope: 'project', projectId: 'p2', syncId: 's4', createdAt: 10 },
      { id: 5, type: 'topic', name: 'e', pinned: false, scope: 'project', projectId: 'p2', syncId: 's5', createdAt: 20 },
      { id: 6, type: 'topic', name: 'f', pinned: false, scope: 'global', projectId: 'p2', syncId: 's6', createdAt: 30 },
    ]);
    expect(await memories.orderBy('createdAt').reverse().primaryKeys()).toEqual([6, 5, 4]);
    expect(await memories.count()).toBe(4);
  });

  it('bulk-deletes, clears, and persists across close/reopen', async () => {
    const db = freshDb();
    const memories = db.table('memories');
    await memories.bulkAdd([
      { id: 1, type: 'topic', name: 'a', pinned: false, syncId: 's1' },
      { id: 2, type: 'topic', name: 'b', pinned: false, syncId: 's2' },
      { id: 3, type: 'topic', name: 'c', pinned: false, syncId: 's3' },
    ]);
    await memories.bulkDelete([1, 3]);
    expect(await memories.orderBy('id').toArray()).toEqual([expect.objectContaining({ id: 2 })]);
    await memories.bulkPut([{ id: 2, type: 'topic', name: 'b-put', pinned: false, syncId: 's2' }]);
    expect(await memories.get(2)).toMatchObject({ name: 'b-put' });

    db.close();
    expect(db.isOpen()).toBe(false);
    await db.open();
    expect(await memories.get(2)).toMatchObject({ name: 'b-put' });

    await memories.clear();
    expect(await memories.count()).toBe(0);
  });

  it('fires and unsubscribes the creating hook for adds and new puts only', async () => {
    const db = freshDb();
    const memories = db.table('memories');
    const created: string[] = [];
    const hook = () => created.push('creating');
    memories.hook('creating', hook);

    await memories.add({ id: 1, type: 'topic', name: 'a', pinned: false, syncId: 's1' });
    await memories.put({ id: 2, type: 'topic', name: 'b', pinned: false, syncId: 's2' });
    await memories.put({ id: 1, type: 'topic', name: 'a-updated', pinned: false, syncId: 's1' });
    expect(created).toHaveLength(2);

    memories.hook('creating').unsubscribe(hook);
    await memories.add({ id: 3, type: 'topic', name: 'c', pinned: false, syncId: 's3' });
    expect(created).toHaveLength(2);
  });

  it('supports read-only transactions and rejects writes bound to them', async () => {
    const db = freshDb();
    const memories = db.table('memories');
    await memories.add({ id: 1, type: 'topic', name: 'a', pinned: false, syncId: 's1' });

    const seen = await db.transaction('r', memories, async (tx) => (
      await tx.table('memories').toArray()
    ));
    expect(seen).toEqual([expect.objectContaining({ id: 1 })]);

    await expect(db.transaction('r', memories, async (tx) => {
      await tx.table('memories').add({ id: 9, type: 'topic', name: 'blocked', pinned: false, syncId: 's9' });
    })).rejects.toThrow('requires a readwrite transaction');
    expect(await memories.count()).toBe(1);
  });
});
