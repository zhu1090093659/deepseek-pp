import Dexie from 'dexie';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ARTIFACT_PERSISTENCE_CONTRACT } from '../core/artifact/schema';
import {
  ADDITIVE_LEGACY_ARTIFACT_RECORD,
  LEGACY_ARTIFACTS_OVER_RETENTION_LIMIT,
  LEGACY_ARTIFACT_RECORD,
  LEGAL_LEGACY_ARTIFACT_STORAGE,
  REJECTED_LEGACY_ARTIFACT_STATES,
} from './fixtures/persistence-contract/artifact';

const LEGACY_KEY = ARTIFACT_PERSISTENCE_CONTRACT.legacyStorageKey;
const originalIndexedDb = Dexie.dependencies.indexedDB;
const originalIdbKeyRange = Dexie.dependencies.IDBKeyRange;

let indexedDbFactory: IDBFactory;
let storage: Record<string, unknown>;
let storageRemove: ReturnType<typeof vi.fn>;
let removeMode: 'success' | 'fail-before-delete' | 'fail-after-delete';
let loadedStore: typeof import('../core/artifact/store') | null;

beforeEach(() => {
  vi.resetModules();
  indexedDbFactory = new IDBFactory();
  installIndexedDb(indexedDbFactory);
  storage = {};
  removeMode = 'success';
  loadedStore = null;
  storageRemove = vi.fn(async (key: string) => {
    if (removeMode === 'fail-before-delete') throw new Error('remove failed before delete');
    delete storage[key];
    if (removeMode === 'fail-after-delete') throw new Error('remove response lost after delete');
  });
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: vi.fn(async (key: string) => (
          Object.prototype.hasOwnProperty.call(storage, key)
            ? { [key]: storage[key] }
            : {}
        )),
        set: vi.fn(async (values: Record<string, unknown>) => Object.assign(storage, values)),
        remove: storageRemove,
      },
    },
  });
});

afterEach(async () => {
  loadedStore?.db.close();
  installIndexedDb(indexedDbFactory);
  await Dexie.delete(ARTIFACT_PERSISTENCE_CONTRACT.databaseName);
  Dexie.dependencies.indexedDB = originalIndexedDb;
  Dexie.dependencies.IDBKeyRange = originalIdbKeyRange;
  vi.unstubAllGlobals();
});

describe('Artifact historical IndexedDB compatibility', () => {
  it('migrates legal additive rows exactly and preserves database identity on reopen', async () => {
    storage[LEGACY_KEY] = LEGAL_LEGACY_ARTIFACT_STORAGE;
    const store = await loadStore();

    await expect(store.getArtifacts()).resolves.toEqual([
      ADDITIVE_LEGACY_ARTIFACT_RECORD,
      LEGACY_ARTIFACT_RECORD,
    ]);
    expect(storageRemove).toHaveBeenCalledWith(LEGACY_KEY);
    expect(storage).not.toHaveProperty(LEGACY_KEY);
    expect(store.db.name).toBe(ARTIFACT_PERSISTENCE_CONTRACT.databaseName);
    expect(store.db.artifacts.schema.primKey.name).toBe('id');
    expect(store.db.artifacts.schema.indexes.map((index) => index.name)).toContain('createdAt');

    const rawRows = await store.db.artifacts.toArray();
    expect(rawRows).toHaveLength(2);
    expect(rawRows.find((row) => row.id === ADDITIVE_LEGACY_ARTIFACT_RECORD.id))
      .toEqual(ADDITIVE_LEGACY_ARTIFACT_RECORD);

    store.db.close();
    await store.db.open();
    await expect(store.getArtifacts()).resolves.toEqual([
      ADDITIVE_LEGACY_ARTIFACT_RECORD,
      LEGACY_ARTIFACT_RECORD,
    ]);
  });

  it.each(Object.entries(REJECTED_LEGACY_ARTIFACT_STATES))(
    'rejects the whole %s legacy value without deleting or partially importing it',
    async (_name, raw) => {
      storage[LEGACY_KEY] = raw;
      const store = await loadStore();

      await expect(store.getArtifacts()).rejects.toThrow();
      expect(storage[LEGACY_KEY]).toBe(raw);
      expect(storageRemove).not.toHaveBeenCalled();
      await expect(store.db.artifacts.count()).resolves.toBe(0);
    },
  );

  it('retries an interrupted cleanup idempotently and remains converged after worker restart', async () => {
    storage[LEGACY_KEY] = LEGAL_LEGACY_ARTIFACT_STORAGE;
    removeMode = 'fail-before-delete';
    let store = await loadStore();

    await expect(store.getArtifacts()).rejects.toThrow('Artifact legacy migration cleanup failed');
    expect(storage[LEGACY_KEY]).toBe(LEGAL_LEGACY_ARTIFACT_STORAGE);
    await expect(store.db.artifacts.count()).resolves.toBe(2);

    removeMode = 'success';
    await expect(store.getArtifacts()).resolves.toHaveLength(2);
    expect(storage).not.toHaveProperty(LEGACY_KEY);
    await expect(store.db.artifacts.count()).resolves.toBe(2);

    store.db.close();
    vi.resetModules();
    store = await loadStore();
    await expect(store.getArtifacts()).resolves.toHaveLength(2);
    await expect(store.db.artifacts.count()).resolves.toBe(2);
  });

  it('treats a lost cleanup response as committed when readback proves the key is absent', async () => {
    storage[LEGACY_KEY] = LEGAL_LEGACY_ARTIFACT_STORAGE;
    removeMode = 'fail-after-delete';
    const store = await loadStore();

    await expect(store.getArtifacts()).resolves.toHaveLength(2);
    expect(storage).not.toHaveProperty(LEGACY_KEY);
    await expect(store.db.artifacts.count()).resolves.toBe(2);
  });

  it('migrates more than the runtime retention limit without deleting legal raw rows', async () => {
    storage[LEGACY_KEY] = LEGACY_ARTIFACTS_OVER_RETENTION_LIMIT;
    const store = await loadStore();

    await expect(store.getArtifacts()).resolves.toHaveLength(ARTIFACT_PERSISTENCE_CONTRACT.maxRecords);
    const rawRows = await store.db.artifacts.toArray();
    expect(rawRows).toHaveLength(LEGACY_ARTIFACTS_OVER_RETENTION_LIMIT.length);
    expect(rawRows.map((row) => row.id).sort()).toEqual(
      LEGACY_ARTIFACTS_OVER_RETENTION_LIMIT.map((row) => row.id).sort(),
    );
    expect(storage).not.toHaveProperty(LEGACY_KEY);
  });

  it('preserves a future database and legacy input when the released version cannot open it', async () => {
    const futureRow = ADDITIVE_LEGACY_ARTIFACT_RECORD;
    const futureDb = createArtifactDatabase(2);
    await futureDb.open();
    await futureDb.table(ARTIFACT_PERSISTENCE_CONTRACT.tableName).add(futureRow);
    futureDb.close();
    storage[LEGACY_KEY] = LEGAL_LEGACY_ARTIFACT_STORAGE;
    const store = await loadStore();

    await expect(store.getArtifacts()).rejects.toThrow(
      'Artifact database version 2 is not supported by version 1',
    );
    await expect(store.saveArtifact({
      kind: 'file',
      filename: 'must-not-write.md',
      mimeType: 'text/markdown',
      content: '# Future database remains untouched',
    })).rejects.toThrow('Artifact database version 2 is not supported by version 1');
    expect(storage[LEGACY_KEY]).toBe(LEGAL_LEGACY_ARTIFACT_STORAGE);
    expect(storageRemove).not.toHaveBeenCalled();
    store.db.close();

    const inspector = createArtifactDatabase(2);
    await inspector.open();
    await expect(inspector.table(ARTIFACT_PERSISTENCE_CONTRACT.tableName).toArray())
      .resolves.toEqual([futureRow]);
    inspector.close();
  });

  it('rejects corrupt IndexedDB rows without filtering or overwriting them', async () => {
    const store = await loadStore();
    await expect(store.getArtifacts()).resolves.toEqual([]);
    const corruptRow = {
      ...LEGACY_ARTIFACT_RECORD,
      content: undefined,
      additiveRawEvidence: { preserve: true },
    };
    await store.db.table(ARTIFACT_PERSISTENCE_CONTRACT.tableName).add(corruptRow as never);

    await expect(store.getArtifacts()).rejects.toThrow('artifactDatabase[0].content must be a string');
    await expect(store.db.table(ARTIFACT_PERSISTENCE_CONTRACT.tableName).toArray())
      .resolves.toEqual([corruptRow]);
  });

  it('rejects conflicting legacy and IndexedDB rows without overwriting either side', async () => {
    const currentRow = {
      ...LEGACY_ARTIFACT_RECORD,
      content: '# IndexedDB remains authoritative',
    };
    const seeded = createArtifactDatabase(1);
    await seeded.open();
    await seeded.table(ARTIFACT_PERSISTENCE_CONTRACT.tableName).add(currentRow);
    seeded.close();
    storage[LEGACY_KEY] = [LEGACY_ARTIFACT_RECORD];
    const store = await loadStore();

    await expect(store.getArtifacts()).rejects.toThrow(
      `Legacy artifact conflicts with IndexedDB id: ${LEGACY_ARTIFACT_RECORD.id}`,
    );
    expect(storage[LEGACY_KEY]).toEqual([LEGACY_ARTIFACT_RECORD]);
    await expect(store.db.artifacts.toArray()).resolves.toEqual([currentRow]);
  });

  it('converges released dual writes when Chrome storage omitted undefined optional fields', async () => {
    const indexedDbRow = {
      ...LEGACY_ARTIFACT_RECORD,
      files: undefined,
      view: undefined,
    };
    const legacyRow = JSON.parse(JSON.stringify(indexedDbRow));
    const seeded = createArtifactDatabase(1);
    await seeded.open();
    await seeded.table(ARTIFACT_PERSISTENCE_CONTRACT.tableName).add(indexedDbRow);
    seeded.close();
    storage[LEGACY_KEY] = [legacyRow];
    const store = await loadStore();

    await expect(store.getArtifacts()).resolves.toEqual([indexedDbRow]);
    expect(storage).not.toHaveProperty(LEGACY_KEY);
    await expect(store.db.artifacts.toArray()).resolves.toEqual([indexedDbRow]);
  });

  it('rejects an invalid repository input before it can poison the authoritative database', async () => {
    const store = await loadStore();

    await expect(store.saveArtifact({
      kind: 'file',
      filename: '',
      mimeType: '',
      content: 'invalid',
      view: { previewMode: 'broken', language: 'text' } as never,
    })).rejects.toThrow('artifactInput.filename must be a non-empty string');
    await expect(store.db.artifacts.toArray()).resolves.toEqual([]);
    await expect(store.getArtifacts()).resolves.toEqual([]);
  });

  it('retains the newly saved artifact when older rows have future timestamps', async () => {
    const futureRows = Array.from(
      { length: ARTIFACT_PERSISTENCE_CONTRACT.maxRecords + 1 },
      (_, index) => ({
        ...LEGACY_ARTIFACT_RECORD,
        id: `future-${index}`,
        createdAt: 10_000 + index,
      }),
    );
    const seeded = createArtifactDatabase(1);
    await seeded.open();
    await seeded.table(ARTIFACT_PERSISTENCE_CONTRACT.tableName).bulkAdd(futureRows);
    seeded.close();
    vi.spyOn(Date, 'now').mockReturnValue(1);
    const store = await loadStore();

    const saved = await store.saveArtifact({
      kind: 'file',
      filename: 'clock-rollback.txt',
      mimeType: 'text/plain',
      content: 'must remain readable',
    });

    await expect(store.db.artifacts.count())
      .resolves.toBe(ARTIFACT_PERSISTENCE_CONTRACT.maxRecords);
    await expect(store.getArtifact(saved.id)).resolves.toEqual(saved);
  });

  it('fails explicitly when IndexedDB is unavailable and leaves legacy input untouched', async () => {
    storage[LEGACY_KEY] = LEGAL_LEGACY_ARTIFACT_STORAGE;
    Dexie.dependencies.indexedDB = undefined as unknown as IDBFactory;
    Dexie.dependencies.IDBKeyRange = undefined as unknown as typeof IDBKeyRange;
    vi.stubGlobal('indexedDB', undefined);
    vi.stubGlobal('IDBKeyRange', undefined);
    vi.resetModules();
    const store = await loadStore();

    await expect(store.getArtifacts()).rejects.toThrow('Artifact IndexedDB is unavailable');
    expect(storage[LEGACY_KEY]).toBe(LEGAL_LEGACY_ARTIFACT_STORAGE);
    expect(storageRemove).not.toHaveBeenCalled();
  });
});

async function loadStore(): Promise<typeof import('../core/artifact/store')> {
  loadedStore = await import('../core/artifact/store');
  return loadedStore;
}

function installIndexedDb(factory: IDBFactory): void {
  Dexie.dependencies.indexedDB = factory;
  Dexie.dependencies.IDBKeyRange = IDBKeyRange;
  vi.stubGlobal('indexedDB', factory);
  vi.stubGlobal('IDBKeyRange', IDBKeyRange);
}

function createArtifactDatabase(version: 1 | 2): Dexie {
  const database = new Dexie(ARTIFACT_PERSISTENCE_CONTRACT.databaseName);
  database.version(1).stores({
    [ARTIFACT_PERSISTENCE_CONTRACT.tableName]: ARTIFACT_PERSISTENCE_CONTRACT.tableSchema,
  });
  if (version === 2) {
    database.version(2).stores({
      [ARTIFACT_PERSISTENCE_CONTRACT.tableName]: ARTIFACT_PERSISTENCE_CONTRACT.tableSchema,
    });
  }
  return database;
}
