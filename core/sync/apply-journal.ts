import Dexie, { type EntityTable } from 'dexie';
import type { SyncLocalApplyJournalPort, SyncLocalApplyJournalV1 } from './local-apply';

export const SYNC_RECOVERY_DATABASE_NAME = 'DeepSeekPPSyncRecovery';
export const SYNC_RECOVERY_DATABASE_VERSION = 1 as const;
export const SYNC_RECOVERY_JOURNAL_TABLE_NAME = 'journal';
export const SYNC_RECOVERY_JOURNAL_TABLE_SCHEMA = '&id';
export const SYNC_RECOVERY_JOURNAL_ID = 'current';

type SyncRecoveryJournalRow = Record<string, unknown> & { id: string };

export const syncRecoveryDb = new Dexie(SYNC_RECOVERY_DATABASE_NAME) as Dexie & {
  journal: EntityTable<SyncRecoveryJournalRow, 'id'>;
};

syncRecoveryDb.version(SYNC_RECOVERY_DATABASE_VERSION).stores({
  [SYNC_RECOVERY_JOURNAL_TABLE_NAME]: SYNC_RECOVERY_JOURNAL_TABLE_SCHEMA,
});

export const indexedDbSyncLocalApplyJournal: SyncLocalApplyJournalPort = {
  async readCurrent() {
    return await syncRecoveryDb.journal.get(SYNC_RECOVERY_JOURNAL_ID) ?? null;
  },

  async writeCurrent(record: SyncLocalApplyJournalV1) {
    await syncRecoveryDb.journal.put({ id: SYNC_RECOVERY_JOURNAL_ID, ...record });
  },

  async clearCurrent() {
    await syncRecoveryDb.journal.delete(SYNC_RECOVERY_JOURNAL_ID);
  },
};
