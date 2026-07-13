import { beforeEach, describe, expect, it, vi } from 'vitest';
import { withSyncLocalStateLock } from '../core/persistence/local-state-lock';
import type { SyncDataSnapshot } from '../core/sync/snapshot';

const coordinator = vi.hoisted(() => ({
  apply: vi.fn(),
  recover: vi.fn(),
}));

vi.mock('../core/sync/local-apply', () => ({
  createSyncLocalApplyCoordinator: () => coordinator,
}));
vi.mock('../core/sync/apply-journal', () => ({
  indexedDbSyncLocalApplyJournal: {},
}));
vi.mock('../core/sync/local-state-browser', () => ({
  browserSyncLocalStatePort: {},
}));

import { stageAndApplySyncSnapshotLocally } from '../core/sync/local-apply-runtime';

const SNAPSHOT = {
  memories: [],
  skills: [],
  skillSources: [],
  presets: [],
  projectContext: null,
  savedItems: null,
} satisfies SyncDataSnapshot;

beforeEach(() => {
  coordinator.apply.mockReset();
  coordinator.recover.mockReset();
});

describe('sync local-apply runtime lock integration', () => {
  it('recovers inside the failed apply lock before a queued ordinary write', async () => {
    const events: string[] = [];
    let rejectApply!: (error: Error) => void;
    coordinator.apply.mockImplementation(() => new Promise<void>((_resolve, reject) => {
      events.push('apply');
      rejectApply = reject;
    }));
    coordinator.recover
      .mockImplementationOnce(async () => {
        events.push('recover:failed');
        throw new Error('recovery unavailable');
      })
      .mockImplementationOnce(async () => {
        events.push('recover:retried');
        return { recovered: true, operationId: 'operation-1' };
      });

    const syncApply = stageAndApplySyncSnapshotLocally(async () => {
      events.push('stage');
      return SNAPSHOT;
    });
    await vi.waitFor(() => expect(events).toEqual(['stage', 'apply']));
    const ordinaryWrite = withSyncLocalStateLock(async () => {
      events.push('ordinary:write');
    });

    rejectApply(new Error('apply failed'));
    await expect(syncApply).rejects.toThrow('required recovery remains pending');
    await ordinaryWrite;
    expect(events).toEqual([
      'stage',
      'apply',
      'recover:failed',
      'recover:retried',
      'ordinary:write',
    ]);
  });

  it('recovers before staging a second queued download', async () => {
    const events: string[] = [];
    let rejectFirstApply!: (error: Error) => void;
    coordinator.apply
      .mockImplementationOnce(() => new Promise<void>((_resolve, reject) => {
        events.push('apply:first');
        rejectFirstApply = reject;
      }))
      .mockImplementationOnce(async () => {
        events.push('apply:second');
      });
    coordinator.recover
      .mockImplementationOnce(async () => {
        events.push('recover:failed');
        throw new Error('recovery unavailable');
      })
      .mockImplementationOnce(async () => {
        events.push('recover:retried');
        return { recovered: true, operationId: 'operation-1' };
      });

    const first = stageAndApplySyncSnapshotLocally(async () => {
      events.push('stage:first');
      return SNAPSHOT;
    });
    await vi.waitFor(() => expect(events).toEqual(['stage:first', 'apply:first']));
    const second = stageAndApplySyncSnapshotLocally(async () => {
      events.push('stage:second');
      return SNAPSHOT;
    });

    rejectFirstApply(new Error('apply failed'));
    await expect(first).rejects.toThrow('required recovery remains pending');
    await expect(second).resolves.toBe(SNAPSHOT);
    expect(events).toEqual([
      'stage:first',
      'apply:first',
      'recover:failed',
      'recover:retried',
      'stage:second',
      'apply:second',
    ]);
  });
});
