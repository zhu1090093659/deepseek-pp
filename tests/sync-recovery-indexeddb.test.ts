import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createSha256Checksum } from '../core/sync/checksum';
import {
  SYNC_LOCAL_APPLY_JOURNAL_KIND,
  SYNC_LOCAL_APPLY_JOURNAL_SCHEMA_VERSION,
  type SyncLocalApplyJournalV1,
  type SyncUndoPreimageV1,
} from '../core/sync/local-apply';
import { deleteIndexedDb } from './helpers/indexeddb';

const indexedDbFactory = new IDBFactory();

beforeAll(() => {
  vi.stubGlobal('indexedDB', indexedDbFactory);
  vi.stubGlobal('IDBKeyRange', IDBKeyRange);
});

afterAll(async () => {
  const { syncRecoveryDb, SYNC_RECOVERY_DATABASE_NAME } = await import('../core/sync/apply-journal');
  syncRecoveryDb.close();
  await deleteIndexedDb(SYNC_RECOVERY_DATABASE_NAME);
  vi.unstubAllGlobals();
});

describe('sync recovery IndexedDB contract', () => {
  it('freezes the v1 singleton identity and preserves an opaque preimage until explicit clear', async () => {
    const journalModule = await import('../core/sync/apply-journal');
    const {
      indexedDbSyncLocalApplyJournal,
      syncRecoveryDb,
      SYNC_RECOVERY_DATABASE_NAME,
      SYNC_RECOVERY_DATABASE_VERSION,
      SYNC_RECOVERY_JOURNAL_ID,
      SYNC_RECOVERY_JOURNAL_TABLE_NAME,
      SYNC_RECOVERY_JOURNAL_TABLE_SCHEMA,
    } = journalModule;
    const journal = syncRecoveryDb.table(SYNC_RECOVERY_JOURNAL_TABLE_NAME);

    expect(SYNC_RECOVERY_DATABASE_NAME).toBe('DeepSeekPPSyncRecovery');
    expect(SYNC_RECOVERY_DATABASE_VERSION).toBe(1);
    expect(SYNC_RECOVERY_JOURNAL_TABLE_NAME).toBe('journal');
    expect(SYNC_RECOVERY_JOURNAL_TABLE_SCHEMA).toBe('&id');
    expect(SYNC_RECOVERY_JOURNAL_ID).toBe('current');

    const record = await createRecord();
    await indexedDbSyncLocalApplyJournal.writeCurrent(record);
    expect(await indexedDbSyncLocalApplyJournal.readCurrent()).toEqual({
      id: 'current',
      ...record,
    });
    expect(journal.schema.primKey).toMatchObject({ name: 'id', unique: true });

    syncRecoveryDb.close();
    await syncRecoveryDb.open();
    expect(await indexedDbSyncLocalApplyJournal.readCurrent()).toEqual({
      id: 'current',
      ...record,
    });

    await indexedDbSyncLocalApplyJournal.clearCurrent();
    await expect(indexedDbSyncLocalApplyJournal.readCurrent()).resolves.toBeNull();
  });

  it('returns a future raw row instead of treating it as an empty journal', async () => {
    const {
      indexedDbSyncLocalApplyJournal,
      syncRecoveryDb,
      SYNC_RECOVERY_JOURNAL_ID,
      SYNC_RECOVERY_JOURNAL_TABLE_NAME,
    } = await import('../core/sync/apply-journal');
    const future = { id: SYNC_RECOVERY_JOURNAL_ID, kind: 'future', schemaVersion: 99 };
    await syncRecoveryDb.table(SYNC_RECOVERY_JOURNAL_TABLE_NAME).put(future);
    await expect(indexedDbSyncLocalApplyJournal.readCurrent()).resolves.toEqual(future);
    await indexedDbSyncLocalApplyJournal.clearCurrent();
  });
});

async function createRecord(): Promise<SyncLocalApplyJournalV1> {
  const preimage: SyncUndoPreimageV1 = {
    memoryRecords: [{ id: 44, syncId: 'raw-memory', unknown: { preserved: true } }],
    storage: {
      skills: { present: true, value: [{ future: 'opaque' }] },
      skillSources: { present: false },
      presets: { present: false },
      activePreset: { present: true, value: 'active-before' },
      projectContext: { present: true, value: { schemaVersion: 99 } },
      savedItems: { present: false },
    },
  };
  return {
    kind: SYNC_LOCAL_APPLY_JOURNAL_KIND,
    schemaVersion: SYNC_LOCAL_APPLY_JOURNAL_SCHEMA_VERSION,
    operationId: 'indexeddb-contract',
    createdAt: 1_700_000_000_000,
    preimage,
    preimageChecksum: await createSha256Checksum(JSON.stringify(preimage)),
  };
}
