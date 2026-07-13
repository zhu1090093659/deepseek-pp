import type { Memory } from '../types';
import {
  assertSha256Checksum,
  createSha256Checksum,
  parseSha256Checksum,
  type Sha256Checksum,
} from './checksum';
import type { SyncDataSnapshot } from './snapshot';

export const SYNC_LOCAL_APPLY_JOURNAL_KIND = 'deepseek-pp.sync-local-apply-journal' as const;
export const SYNC_LOCAL_APPLY_JOURNAL_SCHEMA_VERSION = 1 as const;

export const SYNC_APPLY_STEP_ORDER = [
  'memories',
  'skills',
  'skillSources',
  'presets',
  'activePreset',
  'projectContext',
  'savedItems',
] as const;

export type SyncApplyStep = typeof SYNC_APPLY_STEP_ORDER[number];

export interface OpaqueStoragePreimage {
  present: boolean;
  value?: unknown;
}

export interface SyncUndoPreimageV1 {
  memoryRecords: Record<string, unknown>[];
  storage: Record<Exclude<SyncApplyStep, 'memories'>, OpaqueStoragePreimage>;
}

export interface SyncLocalApplyPlan {
  snapshot: Omit<SyncDataSnapshot, 'memories'> & { memories: Memory[] };
  applySteps: SyncApplyStep[];
}

export interface SyncLocalApplyJournalV1 {
  kind: typeof SYNC_LOCAL_APPLY_JOURNAL_KIND;
  schemaVersion: typeof SYNC_LOCAL_APPLY_JOURNAL_SCHEMA_VERSION;
  operationId: string;
  createdAt: number;
  preimage: SyncUndoPreimageV1;
  preimageChecksum: Sha256Checksum;
}

export interface SyncLocalStatePort {
  captureUndoPreimage(): Promise<SyncUndoPreimageV1>;
  stage(snapshot: SyncDataSnapshot, before: SyncUndoPreimageV1): SyncLocalApplyPlan;
  applyStep(step: SyncApplyStep, plan: SyncLocalApplyPlan): Promise<void>;
  restoreStep(step: SyncApplyStep, before: SyncUndoPreimageV1): Promise<void>;
}

export interface SyncLocalApplyJournalPort {
  readCurrent(): Promise<unknown | null>;
  writeCurrent(record: SyncLocalApplyJournalV1): Promise<void>;
  clearCurrent(): Promise<void>;
}

export interface SyncLocalApplyCoordinatorOptions {
  now?: () => number;
  createOperationId?: () => string;
}

export interface SyncLocalApplyResult {
  operationId: string;
}

export interface SyncLocalRecoveryResult {
  recovered: boolean;
  operationId: string | null;
}

export class SyncLocalCommitOutcomeUnknownError extends Error {
  constructor(cause: unknown, verificationError: unknown) {
    super('Sync local commit outcome is unknown', {
      cause: new AggregateError([cause, verificationError]),
    });
    this.name = 'SyncLocalCommitOutcomeUnknownError';
  }
}

export function createSyncLocalApplyCoordinator(
  localState: SyncLocalStatePort,
  journal: SyncLocalApplyJournalPort,
  options: SyncLocalApplyCoordinatorOptions = {},
) {
  const now = options.now ?? Date.now;
  const createOperationId = options.createOperationId ?? defaultOperationId;

  async function recover(): Promise<SyncLocalRecoveryResult> {
    const record = await readCurrentJournal(journal);
    if (!record) return { recovered: false, operationId: null };

    await restoreAllSteps(localState, record.preimage);
    await clearJournalAfterRollback(journal, record);
    return { recovered: true, operationId: record.operationId };
  }

  async function apply(snapshot: SyncDataSnapshot): Promise<SyncLocalApplyResult> {
    await recover();

    const before = await localState.captureUndoPreimage();
    const plan = localState.stage(snapshot, before);
    const createdAt = now();
    if (!Number.isSafeInteger(createdAt) || createdAt < 0) {
      throw new Error('Sync local apply createdAt is invalid');
    }
    const operationId = createOperationId();
    if (!operationId) throw new Error('Sync local apply operationId is required');
    const record = await createJournalRecord(operationId, createdAt, before);
    await prepareJournal(journal, record);

    try {
      for (const step of plan.applySteps) {
        await localState.applyStep(step, plan);
      }
      await clearJournalForCommit(journal, record);
      return { operationId };
    } catch (applyError) {
      if (applyError instanceof SyncLocalCommitOutcomeUnknownError) throw applyError;

      try {
        await restoreAllSteps(localState, before);
      } catch (rollbackError) {
        throw new AggregateError(
          [applyError, rollbackError],
          'Sync local apply failed and rollback is incomplete',
        );
      }

      try {
        await clearJournalAfterRollback(journal, record);
      } catch (cleanupError) {
        throw new AggregateError(
          [applyError, cleanupError],
          'Sync local apply failed, rollback completed, and journal cleanup failed',
        );
      }
      throw applyError;
    }
  }

  return { apply, recover };
}

async function createJournalRecord(
  operationId: string,
  createdAt: number,
  preimage: SyncUndoPreimageV1,
): Promise<SyncLocalApplyJournalV1> {
  return {
    kind: SYNC_LOCAL_APPLY_JOURNAL_KIND,
    schemaVersion: SYNC_LOCAL_APPLY_JOURNAL_SCHEMA_VERSION,
    operationId,
    createdAt,
    preimage,
    preimageChecksum: await createSha256Checksum(serializePreimage(preimage)),
  };
}

async function prepareJournal(
  journal: SyncLocalApplyJournalPort,
  record: SyncLocalApplyJournalV1,
): Promise<void> {
  try {
    await journal.writeCurrent(record);
  } catch (writeError) {
    let observed: SyncLocalApplyJournalV1 | null;
    try {
      observed = await readCurrentJournal(journal);
    } catch (verificationError) {
      throw new AggregateError(
        [writeError, verificationError],
        'Sync local journal prepare outcome is unknown',
      );
    }
    if (observed && sameJournal(observed, record)) return;
    throw writeError;
  }
}

async function clearJournalForCommit(
  journal: SyncLocalApplyJournalPort,
  record: SyncLocalApplyJournalV1,
): Promise<void> {
  try {
    await journal.clearCurrent();
  } catch (clearError) {
    let observed: SyncLocalApplyJournalV1 | null;
    try {
      observed = await readCurrentJournal(journal);
    } catch (verificationError) {
      throw new SyncLocalCommitOutcomeUnknownError(clearError, verificationError);
    }
    if (!observed) return;
    if (!sameJournal(observed, record)) {
      throw new AggregateError(
        [clearError, new Error('A different sync local journal is present')],
        'Sync local journal changed before commit',
      );
    }
    throw clearError;
  }
}

async function clearJournalAfterRollback(
  journal: SyncLocalApplyJournalPort,
  record: SyncLocalApplyJournalV1,
): Promise<void> {
  try {
    await journal.clearCurrent();
  } catch (clearError) {
    let observed: SyncLocalApplyJournalV1 | null;
    try {
      observed = await readCurrentJournal(journal);
    } catch (verificationError) {
      throw new AggregateError(
        [clearError, verificationError],
        'Sync local rollback journal cleanup outcome is unknown',
      );
    }
    if (!observed) return;
    if (!sameJournal(observed, record)) {
      throw new AggregateError(
        [clearError, new Error('A different sync local journal is present')],
        'Sync local rollback preserved an unexpected journal',
      );
    }
    throw clearError;
  }
}

async function restoreAllSteps(
  localState: SyncLocalStatePort,
  before: SyncUndoPreimageV1,
): Promise<void> {
  const failures: unknown[] = [];
  for (const step of [...SYNC_APPLY_STEP_ORDER].reverse()) {
    try {
      await localState.restoreStep(step, before);
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length > 0) {
    throw new AggregateError(failures, 'Sync local rollback did not restore every persistence store');
  }
}

async function readCurrentJournal(
  journal: SyncLocalApplyJournalPort,
): Promise<SyncLocalApplyJournalV1 | null> {
  const value = await journal.readCurrent();
  if (value === null) return null;
  return validateSyncLocalApplyJournal(value);
}

export async function validateSyncLocalApplyJournal(
  value: unknown,
): Promise<SyncLocalApplyJournalV1> {
  const record = parseJournalEnvelope(value);
  await assertSha256Checksum(
    'Sync local journal preimage',
    serializePreimage(record.preimage),
    record.preimageChecksum,
  );
  return record;
}

function parseJournalEnvelope(value: unknown): SyncLocalApplyJournalV1 {
  const object = objectValue(value, 'Sync local journal');
  if (object.kind !== SYNC_LOCAL_APPLY_JOURNAL_KIND) {
    throw new Error('Sync local journal kind is not supported');
  }
  if (object.schemaVersion !== SYNC_LOCAL_APPLY_JOURNAL_SCHEMA_VERSION) {
    throw new Error('Sync local journal schema is not supported');
  }
  if (typeof object.operationId !== 'string' || object.operationId.length === 0) {
    throw new Error('Sync local journal operationId is required');
  }
  if (!Number.isSafeInteger(object.createdAt) || (object.createdAt as number) < 0) {
    throw new Error('Sync local journal createdAt is invalid');
  }
  return {
    kind: SYNC_LOCAL_APPLY_JOURNAL_KIND,
    schemaVersion: SYNC_LOCAL_APPLY_JOURNAL_SCHEMA_VERSION,
    operationId: object.operationId,
    createdAt: object.createdAt as number,
    preimage: parseUndoPreimage(object.preimage),
    preimageChecksum: parseSha256Checksum(
      object.preimageChecksum,
      'Sync local journal preimageChecksum',
    ),
  };
}

function parseUndoPreimage(value: unknown): SyncUndoPreimageV1 {
  const object = objectValue(value, 'Sync local journal preimage');
  if (!Array.isArray(object.memoryRecords)) {
    throw new Error('Sync local journal memoryRecords must be an array');
  }
  const memoryRecords = object.memoryRecords.map((record, index) => (
    objectValue(record, `Sync local journal memoryRecords[${index}]`)
  ));
  const storage = objectValue(object.storage, 'Sync local journal storage');
  return {
    memoryRecords,
    storage: {
      skills: parseOpaqueStoragePreimage(storage.skills, 'skills'),
      skillSources: parseOpaqueStoragePreimage(storage.skillSources, 'skillSources'),
      presets: parseOpaqueStoragePreimage(storage.presets, 'presets'),
      activePreset: parseOpaqueStoragePreimage(storage.activePreset, 'activePreset'),
      projectContext: parseOpaqueStoragePreimage(storage.projectContext, 'projectContext'),
      savedItems: parseOpaqueStoragePreimage(storage.savedItems, 'savedItems'),
    },
  };
}

function parseOpaqueStoragePreimage(value: unknown, slot: string): OpaqueStoragePreimage {
  const object = objectValue(value, `Sync local journal storage.${slot}`);
  if (typeof object.present !== 'boolean') {
    throw new Error(`Sync local journal storage.${slot}.present must be a boolean`);
  }
  if (!object.present) return { present: false };
  if (!Object.prototype.hasOwnProperty.call(object, 'value')) {
    throw new Error(`Sync local journal storage.${slot}.value is required`);
  }
  return { present: true, value: object.value };
}

function objectValue(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function serializePreimage(preimage: SyncUndoPreimageV1): string {
  const serialized = JSON.stringify(preimage);
  if (serialized === undefined) throw new Error('Sync local journal preimage is not serializable');
  return serialized;
}

function sameJournal(left: SyncLocalApplyJournalV1, right: SyncLocalApplyJournalV1): boolean {
  return left.operationId === right.operationId
    && left.preimageChecksum.value === right.preimageChecksum.value;
}

function defaultOperationId(): string {
  const cryptoApi = globalThis.crypto;
  if (typeof cryptoApi?.randomUUID !== 'function') {
    throw new Error('Web Crypto randomUUID is required for sync local apply');
  }
  return cryptoApi.randomUUID();
}
