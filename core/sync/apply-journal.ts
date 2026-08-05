import type { SyncLocalApplyJournalPort, SyncLocalApplyJournalV1 } from './local-apply';
import { IndexedDb } from '../persistence/indexeddb';

export const SYNC_RECOVERY_DATABASE_NAME = 'DeepSeekPPSyncRecovery';
export const SYNC_RECOVERY_DATABASE_VERSION = 1 as const;
export const SYNC_RECOVERY_JOURNAL_TABLE_NAME = 'journal';
export const SYNC_RECOVERY_JOURNAL_TABLE_SCHEMA = '&id';
export const SYNC_RECOVERY_JOURNAL_ID = 'current';

type SyncRecoveryJournalRow = Record<string, unknown> & { id: string };

// The IndexedDB version is the logical schema version x10 (the convention
// dexie established internally): the released recovery journal lives at 10.
export const syncRecoveryDb = new IndexedDb(SYNC_RECOVERY_DATABASE_NAME, [
  {
    version: SYNC_RECOVERY_DATABASE_VERSION * 10,
    stores: {
      [SYNC_RECOVERY_JOURNAL_TABLE_NAME]: SYNC_RECOVERY_JOURNAL_TABLE_SCHEMA,
    },
  },
]);

const journal = syncRecoveryDb.table(SYNC_RECOVERY_JOURNAL_TABLE_NAME);

export const indexedDbSyncLocalApplyJournal: SyncLocalApplyJournalPort = {
  async readCurrent() {
    return await journal.get(SYNC_RECOVERY_JOURNAL_ID) as SyncRecoveryJournalRow | undefined
      ?? null;
  },

  async writeCurrent(record: SyncLocalApplyJournalV1) {
    await journal.put({ id: SYNC_RECOVERY_JOURNAL_ID, ...record });
  },

  async clearCurrent() {
    await journal.delete(SYNC_RECOVERY_JOURNAL_ID);
  },
};
