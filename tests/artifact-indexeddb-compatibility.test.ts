import Dexie from 'dexie';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ARTIFACT_PERSISTENCE_CONTRACT } from '../core/artifact/schema';
import {
  ARTIFACT_FILTERING_DATA_LOSS_GAP,
  LEGACY_ARTIFACT_RECORD,
} from './fixtures/persistence-contract/artifact';

const indexedDbFactory = new IDBFactory();
const originalIndexedDb = Dexie.dependencies.indexedDB;
const originalIdbKeyRange = Dexie.dependencies.IDBKeyRange;
const storage: Record<string, unknown> = {
  [ARTIFACT_PERSISTENCE_CONTRACT.legacyStorageKey]: ARTIFACT_FILTERING_DATA_LOSS_GAP.input,
};
const storageRemove = vi.fn(async (key: string) => {
  delete storage[key];
});

beforeAll(() => {
  Dexie.dependencies.indexedDB = indexedDbFactory;
  Dexie.dependencies.IDBKeyRange = IDBKeyRange;
  vi.stubGlobal('indexedDB', indexedDbFactory);
  vi.stubGlobal('IDBKeyRange', IDBKeyRange);
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: vi.fn(async (key: string) => ({ [key]: storage[key] })),
        set: vi.fn(async (values: Record<string, unknown>) => Object.assign(storage, values)),
        remove: storageRemove,
      },
    },
  });
});

afterAll(() => {
  Dexie.dependencies.indexedDB = originalIndexedDb;
  Dexie.dependencies.IDBKeyRange = originalIdbKeyRange;
  vi.unstubAllGlobals();
});

describe('Artifact historical IndexedDB compatibility', () => {
  it('migrates valid legacy rows through the production store and exposes malformed-row loss as a gap', async () => {
    const { getArtifacts } = await import('../core/artifact/store');

    await expect(getArtifacts()).resolves.toEqual([LEGACY_ARTIFACT_RECORD]);
    expect(storageRemove).toHaveBeenCalledWith(ARTIFACT_PERSISTENCE_CONTRACT.legacyStorageKey);
    expect(storage).not.toHaveProperty(ARTIFACT_PERSISTENCE_CONTRACT.legacyStorageKey);
    expect(ARTIFACT_FILTERING_DATA_LOSS_GAP.target)
      .toBe('preserve-unread-rows-for-explicit-recovery-after-T3.3');

    const persisted = new Dexie(ARTIFACT_PERSISTENCE_CONTRACT.databaseName);
    persisted.version(ARTIFACT_PERSISTENCE_CONTRACT.databaseVersion).stores({
      [ARTIFACT_PERSISTENCE_CONTRACT.tableName]: ARTIFACT_PERSISTENCE_CONTRACT.tableSchema,
    });
    await persisted.open();
    expect(await persisted.table(ARTIFACT_PERSISTENCE_CONTRACT.tableName).toArray())
      .toEqual([LEGACY_ARTIFACT_RECORD]);
    persisted.close();
    await Dexie.delete(ARTIFACT_PERSISTENCE_CONTRACT.databaseName);
  });
});
