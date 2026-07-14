import { describe, expect, it } from 'vitest';
import type { Memory } from '../core/types';
import { stageSyncLocalApply } from '../core/sync/local-state-browser';
import type { SyncUndoPreimageV1 } from '../core/sync/local-apply';
import type { SyncDataSnapshot } from '../core/sync/snapshot';

describe('browser sync local-state staging', () => {
  it('reuses numeric memory ids by syncId and allocates new ids deterministically', () => {
    const before = createPreimage([
      {
        ...memory('sync-a'),
        id: 4,
        localAdditiveField: { preserve: true },
        sharedAdditiveField: 'local-value',
      },
      { ...memory('deleted-sync'), id: 9 },
    ]);
    const snapshot = createSnapshot([
      {
        ...memory('sync-a'),
        remoteAdditiveField: { preserve: true },
        sharedAdditiveField: 'remote-value',
      } as Memory,
      memory('sync-new-1'),
      memory('sync-new-2'),
    ]);

    const first = stageSyncLocalApply(snapshot, before);
    expect(first.snapshot.memories.map(({ syncId, id }) => ({ syncId, id }))).toEqual([
      { syncId: 'sync-a', id: 4 },
      { syncId: 'sync-new-1', id: 10 },
      { syncId: 'sync-new-2', id: 11 },
    ]);
    expect(first.snapshot.memories[0]).toMatchObject({
      localAdditiveField: { preserve: true },
      remoteAdditiveField: { preserve: true },
      sharedAdditiveField: 'remote-value',
    });

    const committedBefore = createPreimage(first.snapshot.memories as unknown as Record<string, unknown>[]);
    const retry = stageSyncLocalApply(snapshot, committedBefore);
    expect(retry.snapshot.memories).toEqual(first.snapshot.memories);
  });

  it('preserves duplicate sync ids with occurrence-stable ids across retries', () => {
    const snapshot = createSnapshot([
      { ...memory('duplicate'), name: 'first' },
      { ...memory('duplicate'), name: 'second' },
      { ...memory('duplicate'), name: 'third' },
    ]);
    const before = createPreimage([
      { ...memory('duplicate'), id: 8, name: 'older-second' },
      { ...memory('duplicate'), id: 3, name: 'older-first' },
      { ...memory('other'), id: 11 },
    ]);

    const first = stageSyncLocalApply(snapshot, before);
    expect(first.snapshot.memories.map(({ name, syncId, id }) => ({ name, syncId, id }))).toEqual([
      { name: 'first', syncId: 'duplicate', id: 3 },
      { name: 'second', syncId: 'duplicate', id: 8 },
      { name: 'third', syncId: 'duplicate', id: 12 },
    ]);

    const committedBefore = createPreimage(first.snapshot.memories as unknown as Record<string, unknown>[]);
    expect(stageSyncLocalApply(snapshot, committedBefore).snapshot.memories)
      .toEqual(first.snapshot.memories);
  });

  it('stages only optional remote stores that exist and preserves a valid active preset', () => {
    const before = createPreimage([]);
    before.storage.activePreset = { present: true, value: 'keep-active' };
    const snapshot = createSnapshot([]);
    snapshot.presets = [{
      id: 'keep-active',
      name: 'Keep active',
      content: 'Prompt',
      createdAt: 1,
      updatedAt: 1,
    }];

    expect(stageSyncLocalApply(snapshot, before).applySteps).toEqual([
      'memories',
      'skills',
      'skillSources',
      'presets',
    ]);

    snapshot.projectContext = {
      schemaVersion: 2,
      projects: [],
      conversations: [],
      pendingProjectId: null,
    };
    snapshot.savedItems = { schemaVersion: 1, items: [] };
    expect(stageSyncLocalApply(snapshot, before).applySteps).toEqual([
      'memories',
      'skills',
      'skillSources',
      'presets',
      'projectContext',
      'savedItems',
    ]);
  });

  it('stages active-preset cleanup only for a released string id and rejects unsupported state', () => {
    const before = createPreimage([]);
    before.storage.activePreset = { present: true, value: 'removed-preset' };
    expect(stageSyncLocalApply(createSnapshot([]), before).applySteps).toContain('activePreset');

    before.storage.activePreset = { present: true, value: { future: 'opaque' } };
    expect(() => stageSyncLocalApply(createSnapshot([]), before)).toThrow(
      'activePresetId must use the released string schema',
    );
  });
});

function createSnapshot(memories: Memory[]): SyncDataSnapshot {
  return {
    memories,
    skills: [],
    skillSources: [],
    presets: [],
    projectContext: null,
    savedItems: null,
  };
}

function createPreimage(memoryRecords: Record<string, unknown>[]): SyncUndoPreimageV1 {
  return {
    memoryRecords,
    storage: {
      skills: { present: false },
      skillSources: { present: false },
      presets: { present: false },
      activePreset: { present: false },
      projectContext: { present: false },
      savedItems: { present: false },
    },
  };
}

function memory(syncId: string): Memory {
  return {
    syncId,
    scope: 'global',
    type: 'reference',
    name: syncId,
    content: `content:${syncId}`,
    description: `description:${syncId}`,
    tags: ['sync'],
    pinned: false,
    createdAt: 1,
    updatedAt: 1,
    accessCount: 0,
    lastAccessedAt: 1,
  };
}
