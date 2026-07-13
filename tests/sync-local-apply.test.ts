import { describe, expect, it } from 'vitest';
import type { Memory } from '../core/types';
import { createSha256Checksum } from '../core/sync/checksum';
import {
  SYNC_APPLY_STEP_ORDER,
  SYNC_LOCAL_APPLY_JOURNAL_KIND,
  SYNC_LOCAL_APPLY_JOURNAL_SCHEMA_VERSION,
  SyncLocalCommitOutcomeUnknownError,
  createSyncLocalApplyCoordinator,
  type SyncApplyStep,
  type SyncLocalApplyJournalPort,
  type SyncLocalApplyJournalV1,
  type SyncLocalApplyPlan,
  type SyncLocalStatePort,
  type SyncUndoPreimageV1,
} from '../core/sync/local-apply';
import type { SyncDataSnapshot } from '../core/sync/snapshot';

const BEFORE = {
  memoryRecords: [{ id: 7, syncId: 'before-memory', futureField: { keep: true } }],
  storage: {
    skills: { present: true, value: { future: 'raw-skills' } },
    skillSources: { present: false },
    presets: { present: true, value: [{ raw: 'preset' }] },
    activePreset: { present: true, value: 'preset-before' },
    projectContext: { present: true, value: { schemaVersion: 99, raw: true } },
    savedItems: { present: false },
  },
} satisfies SyncUndoPreimageV1;

const SNAPSHOT: SyncDataSnapshot = {
  memories: [],
  skills: [],
  skillSources: [],
  presets: [],
  projectContext: null,
  savedItems: null,
};

describe('sync local apply coordinator', () => {
  it('commits only by deleting the prepared journal after deterministic writes', async () => {
    const state = new FakeLocalState();
    const journal = new FakeJournal();
    const coordinator = createCoordinator(state, journal);

    await expect(coordinator.apply(SNAPSHOT)).resolves.toEqual({ operationId: 'operation-1' });

    expect(state.applyCalls).toEqual(SYNC_APPLY_STEP_ORDER);
    expect(state.restoreCalls).toEqual([]);
    expect(state.values).toEqual(targetValues());
    expect(journal.current).toBeNull();
    expect(journal.events).toEqual(['read', 'write', 'clear']);
  });

  for (const step of SYNC_APPLY_STEP_ORDER) {
    for (const mode of ['before', 'after'] as const) {
      it(`restores the exact preimage when ${step} fails ${mode} its write`, async () => {
        const state = new FakeLocalState({ applyFailure: { step, mode } });
        const journal = new FakeJournal();
        const coordinator = createCoordinator(state, journal);

        await expect(coordinator.apply(SNAPSHOT)).rejects.toThrow(`apply ${step} ${mode}`);

        expect(state.values).toEqual(beforeValues());
        expect(state.restoreCalls).toEqual([...SYNC_APPLY_STEP_ORDER].reverse());
        expect(journal.current).toBeNull();
      });
    }
  }

  it('accepts a journal prepare that committed before the storage API threw', async () => {
    const state = new FakeLocalState();
    const journal = new FakeJournal({ writeMode: 'after' });
    const coordinator = createCoordinator(state, journal);

    await expect(coordinator.apply(SNAPSHOT)).resolves.toEqual({ operationId: 'operation-1' });
    expect(state.values).toEqual(targetValues());
    expect(journal.current).toBeNull();
  });

  it('does not mutate local state when journal preparation fails before commit', async () => {
    const state = new FakeLocalState();
    const journal = new FakeJournal({ writeMode: 'before' });
    const coordinator = createCoordinator(state, journal);

    await expect(coordinator.apply(SNAPSHOT)).rejects.toThrow('journal write before');
    expect(state.applyCalls).toEqual([]);
    expect(state.restoreCalls).toEqual([]);
    expect(state.values).toEqual(beforeValues());
    expect(journal.current).toBeNull();
  });

  it('fails closed when a failed journal preparation cannot be verified', async () => {
    const state = new FakeLocalState();
    const journal = new FakeJournal({ writeMode: 'before', failReadAt: 2 });
    const coordinator = createCoordinator(state, journal);

    await expect(coordinator.apply(SNAPSHOT)).rejects.toThrow(
      'Sync local journal prepare outcome is unknown',
    );
    expect(state.applyCalls).toEqual([]);
    expect(state.restoreCalls).toEqual([]);
    expect(state.values).toEqual(beforeValues());
  });

  it('accepts a commit delete that completed before the storage API threw', async () => {
    const state = new FakeLocalState();
    const journal = new FakeJournal({ clearModes: ['after'] });
    const coordinator = createCoordinator(state, journal);

    await expect(coordinator.apply(SNAPSHOT)).resolves.toEqual({ operationId: 'operation-1' });
    expect(state.values).toEqual(targetValues());
    expect(state.restoreCalls).toEqual([]);
    expect(journal.current).toBeNull();
  });

  it('rolls back when commit deletion fails before removing the journal', async () => {
    const state = new FakeLocalState();
    const journal = new FakeJournal({ clearModes: ['before', 'success'] });
    const coordinator = createCoordinator(state, journal);

    await expect(coordinator.apply(SNAPSHOT)).rejects.toThrow('journal clear before');
    expect(state.values).toEqual(beforeValues());
    expect(journal.current).toBeNull();
  });

  it('fails explicitly without guessing when commit deletion cannot be verified', async () => {
    const state = new FakeLocalState();
    const journal = new FakeJournal({ clearModes: ['before'], failReadAt: 2 });
    const coordinator = createCoordinator(state, journal);

    await expect(coordinator.apply(SNAPSHOT)).rejects.toBeInstanceOf(
      SyncLocalCommitOutcomeUnknownError,
    );
    expect(state.values).toEqual(targetValues());
    expect(state.restoreCalls).toEqual([]);
    expect(journal.current).not.toBeNull();
  });

  for (const failedRestoreStep of SYNC_APPLY_STEP_ORDER) {
    for (const mode of ['before', 'after'] as const) {
      it(`keeps the journal when rollback restore of ${failedRestoreStep} fails ${mode} commit`, async () => {
        const state = new FakeLocalState({
          applyFailure: { step: 'savedItems', mode: 'after' },
          restoreFailure: { step: failedRestoreStep, mode },
        });
        const journal = new FakeJournal();
        const coordinator = createCoordinator(state, journal);

        await expect(coordinator.apply(SNAPSHOT)).rejects.toThrow('rollback is incomplete');
        expect(state.restoreCalls).toEqual([...SYNC_APPLY_STEP_ORDER].reverse());
        expect(journal.current).not.toBeNull();

        state.restoreFailure = null;
        const restarted = createCoordinator(state, journal, 'operation-2');
        await expect(restarted.recover()).resolves.toEqual({
          recovered: true,
          operationId: 'operation-1',
        });
        expect(state.values).toEqual(beforeValues());
        expect(journal.current).toBeNull();
        await expect(restarted.recover()).resolves.toEqual({ recovered: false, operationId: null });
      });
    }
  }

  it('recovers every interrupted apply prefix after a worker restart', async () => {
    for (let prefix = 0; prefix <= SYNC_APPLY_STEP_ORDER.length; prefix += 1) {
      const state = new FakeLocalState();
      for (const step of SYNC_APPLY_STEP_ORDER.slice(0, prefix)) state.values[step] = `target:${step}`;
      const journal = new FakeJournal();
      journal.current = await createJournal('crashed-operation');

      const restarted = createCoordinator(state, journal, 'retry-operation');
      await expect(restarted.recover()).resolves.toEqual({
        recovered: true,
        operationId: 'crashed-operation',
      });
      expect(state.values).toEqual(beforeValues());
      expect(journal.current).toBeNull();
    }
  });

  it('retries the same snapshot idempotently after a rolled-back failure', async () => {
    const state = new FakeLocalState({ applyFailure: { step: 'presets', mode: 'after' } });
    const journal = new FakeJournal();
    const coordinator = createCoordinator(state, journal);

    await expect(coordinator.apply(SNAPSHOT)).rejects.toThrow('apply presets after');
    state.applyFailure = null;
    await expect(coordinator.apply(SNAPSHOT)).resolves.toEqual({ operationId: 'operation-1' });
    expect(state.values).toEqual(targetValues());
    expect(journal.current).toBeNull();
  });

  it('preserves corrupt and future journals without touching local state', async () => {
    const invalidRecords: unknown[] = [
      { ...(await createJournal('future')), schemaVersion: 2 },
      { ...(await createJournal('checksum')), preimageChecksum: { algorithm: 'sha256', value: '0'.repeat(64) } },
      { kind: 'corrupt' },
    ];

    for (const record of invalidRecords) {
      const state = new FakeLocalState();
      const journal = new FakeJournal();
      journal.current = structuredClone(record);
      const coordinator = createCoordinator(state, journal);

      await expect(coordinator.recover()).rejects.toThrow();
      expect(state.values).toEqual(beforeValues());
      expect(state.restoreCalls).toEqual([]);
      expect(journal.current).toEqual(record);
    }
  });
});

class FakeLocalState implements SyncLocalStatePort {
  values = beforeValues();
  applyCalls: SyncApplyStep[] = [];
  restoreCalls: SyncApplyStep[] = [];
  applyFailure: { step: SyncApplyStep; mode: 'before' | 'after' } | null;
  restoreFailure: { step: SyncApplyStep; mode: 'before' | 'after' } | null;

  constructor(options: {
    applyFailure?: { step: SyncApplyStep; mode: 'before' | 'after' };
    restoreFailure?: { step: SyncApplyStep; mode: 'before' | 'after' };
  } = {}) {
    this.applyFailure = options.applyFailure ?? null;
    this.restoreFailure = options.restoreFailure ?? null;
  }

  async captureUndoPreimage() {
    return structuredClone(BEFORE);
  }

  stage(snapshot: SyncDataSnapshot): SyncLocalApplyPlan {
    return {
      snapshot: snapshot as SyncLocalApplyPlan['snapshot'],
      applySteps: [...SYNC_APPLY_STEP_ORDER],
    };
  }

  async applyStep(step: SyncApplyStep) {
    this.applyCalls.push(step);
    if (this.applyFailure?.step === step && this.applyFailure.mode === 'before') {
      throw new Error(`apply ${step} before`);
    }
    this.values[step] = `target:${step}`;
    if (this.applyFailure?.step === step && this.applyFailure.mode === 'after') {
      throw new Error(`apply ${step} after`);
    }
  }

  async restoreStep(step: SyncApplyStep) {
    this.restoreCalls.push(step);
    if (this.restoreFailure?.step === step && this.restoreFailure.mode === 'before') {
      throw new Error(`restore ${step} before`);
    }
    this.values[step] = `before:${step}`;
    if (this.restoreFailure?.step === step && this.restoreFailure.mode === 'after') {
      throw new Error(`restore ${step} after`);
    }
  }
}

class FakeJournal implements SyncLocalApplyJournalPort {
  current: unknown | null = null;
  events: string[] = [];
  private readonly writeMode: 'success' | 'before' | 'after';
  private readonly clearModes: Array<'success' | 'before' | 'after'>;
  private readonly failReadAt: number | null;
  private readCount = 0;

  constructor(options: {
    writeMode?: 'success' | 'before' | 'after';
    clearModes?: Array<'success' | 'before' | 'after'>;
    failReadAt?: number;
  } = {}) {
    this.writeMode = options.writeMode ?? 'success';
    this.clearModes = [...(options.clearModes ?? [])];
    this.failReadAt = options.failReadAt ?? null;
  }

  async readCurrent() {
    this.events.push('read');
    this.readCount += 1;
    if (this.failReadAt === this.readCount) throw new Error('journal read failed');
    return this.current === null ? null : structuredClone(this.current);
  }

  async writeCurrent(record: SyncLocalApplyJournalV1) {
    this.events.push('write');
    if (this.writeMode === 'before') throw new Error('journal write before');
    this.current = structuredClone(record);
    if (this.writeMode === 'after') throw new Error('journal write after');
  }

  async clearCurrent() {
    this.events.push('clear');
    const mode = this.clearModes.shift() ?? 'success';
    if (mode === 'before') throw new Error('journal clear before');
    this.current = null;
    if (mode === 'after') throw new Error('journal clear after');
  }
}

function createCoordinator(
  state: FakeLocalState,
  journal: FakeJournal,
  operationId = 'operation-1',
) {
  return createSyncLocalApplyCoordinator(state, journal, {
    now: () => 1_700_000_000_000,
    createOperationId: () => operationId,
  });
}

async function createJournal(operationId: string): Promise<SyncLocalApplyJournalV1> {
  const preimage = structuredClone(BEFORE);
  return {
    kind: SYNC_LOCAL_APPLY_JOURNAL_KIND,
    schemaVersion: SYNC_LOCAL_APPLY_JOURNAL_SCHEMA_VERSION,
    operationId,
    createdAt: 1_700_000_000_000,
    preimage,
    preimageChecksum: await createSha256Checksum(JSON.stringify(preimage)),
  };
}

function beforeValues(): Record<SyncApplyStep, string> {
  return Object.fromEntries(
    SYNC_APPLY_STEP_ORDER.map((step) => [step, `before:${step}`]),
  ) as Record<SyncApplyStep, string>;
}

function targetValues(): Record<SyncApplyStep, string> {
  return Object.fromEntries(
    SYNC_APPLY_STEP_ORDER.map((step) => [step, `target:${step}`]),
  ) as Record<SyncApplyStep, string>;
}
