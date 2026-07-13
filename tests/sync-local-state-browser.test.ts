import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SYNC_APPLY_STEP_ORDER, type SyncLocalApplyPlan, type SyncUndoPreimageV1 } from '../core/sync/local-apply';

const mocks = vi.hoisted(() => ({
  captureRawMemories: vi.fn(),
  replaceMemories: vi.fn(),
  restoreRawMemories: vi.fn(),
  replacePresets: vi.fn(),
  clearActivePreset: vi.fn(),
  saveProject: vi.fn(),
  replaceSavedItems: vi.fn(),
  replaceSkills: vi.fn(),
  replaceSkillSources: vi.fn(),
}));

vi.mock('../core/memory/store', () => ({
  captureRawMemoryRecordsForSyncRecovery: mocks.captureRawMemories,
  replaceAllMemoriesForSyncApply: mocks.replaceMemories,
  restoreRawMemoryRecordsForSyncRecovery: mocks.restoreRawMemories,
}));

vi.mock('../core/preset/store', () => ({
  ACTIVE_PRESET_STORAGE_KEY: 'deepseek_pp_active_preset_id',
  PRESETS_STORAGE_KEY: 'deepseek_pp_presets',
  clearActivePresetForSyncApply: mocks.clearActivePreset,
  replacePresetCollectionForSyncApply: mocks.replacePresets,
}));

vi.mock('../core/project/store', () => ({
  PROJECT_CONTEXT_STORAGE_KEY: 'deepseek_pp_project_context',
  saveProjectContextStateForSyncApply: mocks.saveProject,
}));

vi.mock('../core/saved-items/store', () => ({
  SAVED_ITEMS_STORAGE_KEY: 'deepseek_pp_saved_items',
  replaceAllSavedItemsForSyncApply: mocks.replaceSavedItems,
}));

vi.mock('../core/skill/registry', () => ({
  SKILLS_STORAGE_KEY: 'deepseek_pp_skills',
  SKILL_SOURCES_STORAGE_KEY: 'deepseek_pp_skill_sources',
  replaceAllCustomSkillsForSyncApply: mocks.replaceSkills,
  replaceAllSkillSourcesForSyncApply: mocks.replaceSkillSources,
}));

import {
  SYNC_RECOVERY_STORAGE_KEYS,
  browserSyncLocalStatePort,
} from '../core/sync/local-state-browser';

let storage: Record<string, unknown>;
let storageSet: ReturnType<typeof vi.fn>;
let storageRemove: ReturnType<typeof vi.fn>;

beforeEach(() => {
  storage = {};
  storageSet = vi.fn(async (patch: Record<string, unknown>) => {
    storage = { ...storage, ...structuredClone(patch) };
  });
  storageRemove = vi.fn(async (key: string) => {
    delete storage[key];
  });
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: vi.fn(async (keys: string[]) => Object.fromEntries(
          keys.filter((key) => Object.prototype.hasOwnProperty.call(storage, key))
            .map((key) => [key, structuredClone(storage[key])]),
        )),
        set: storageSet,
        remove: storageRemove,
      },
    },
  });
  mocks.captureRawMemories.mockResolvedValue([{ id: 44, syncId: 'raw', future: true }]);
  for (const mock of Object.values(mocks)) mock.mockClear();
  mocks.captureRawMemories.mockResolvedValue([{ id: 44, syncId: 'raw', future: true }]);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('browser sync local-state adapter', () => {
  it('captures opaque values and distinguishes missing keys without domain decoding', async () => {
    storage = {
      [SYNC_RECOVERY_STORAGE_KEYS.skills]: { schemaVersion: 99, raw: true },
      [SYNC_RECOVERY_STORAGE_KEYS.skillSources]: null,
      [SYNC_RECOVERY_STORAGE_KEYS.presets]: [{ unknown: 'preserve' }],
      [SYNC_RECOVERY_STORAGE_KEYS.projectContext]: { schemaVersion: 99 },
    };

    await expect(browserSyncLocalStatePort.captureUndoPreimage()).resolves.toEqual({
      memoryRecords: [{ id: 44, syncId: 'raw', future: true }],
      storage: {
        skills: { present: true, value: { schemaVersion: 99, raw: true } },
        skillSources: { present: true, value: null },
        presets: { present: true, value: [{ unknown: 'preserve' }] },
        activePreset: { present: false },
        projectContext: { present: true, value: { schemaVersion: 99 } },
        savedItems: { present: false },
      },
    });
  });

  it('routes each staged target write through the existing domain primitive', async () => {
    const plan = fullPlan();
    for (const step of SYNC_APPLY_STEP_ORDER) {
      await browserSyncLocalStatePort.applyStep(step, plan);
    }

    expect(mocks.replaceMemories).toHaveBeenCalledWith(plan.snapshot.memories);
    expect(mocks.replaceSkills).toHaveBeenCalledWith(plan.snapshot.skills);
    expect(mocks.replaceSkillSources).toHaveBeenCalledWith(plan.snapshot.skillSources);
    expect(mocks.replacePresets).toHaveBeenCalledWith(plan.snapshot.presets);
    expect(mocks.clearActivePreset).toHaveBeenCalledOnce();
    expect(mocks.saveProject).toHaveBeenCalledWith(plan.snapshot.projectContext);
    expect(mocks.replaceSavedItems).toHaveBeenCalledWith(plan.snapshot.savedItems?.items);
  });

  it('restores raw memory rows, opaque values, and key absence exactly', async () => {
    storage = Object.fromEntries(
      Object.values(SYNC_RECOVERY_STORAGE_KEYS).map((key) => [key, `target:${key}`]),
    );
    const before = rawPreimage();

    for (const step of [...SYNC_APPLY_STEP_ORDER].reverse()) {
      await browserSyncLocalStatePort.restoreStep(step, before);
    }

    expect(mocks.restoreRawMemories).toHaveBeenCalledWith(before.memoryRecords);
    expect(storage).toEqual({
      [SYNC_RECOVERY_STORAGE_KEYS.skills]: { raw: 'skills' },
      [SYNC_RECOVERY_STORAGE_KEYS.presets]: [{ raw: 'presets' }],
      [SYNC_RECOVERY_STORAGE_KEYS.activePreset]: 'before-active',
      [SYNC_RECOVERY_STORAGE_KEYS.projectContext]: { schemaVersion: 99 },
    });
    expect(storageRemove).toHaveBeenCalledWith(SYNC_RECOVERY_STORAGE_KEYS.skillSources);
    expect(storageRemove).toHaveBeenCalledWith(SYNC_RECOVERY_STORAGE_KEYS.savedItems);
  });
});

function fullPlan(): SyncLocalApplyPlan {
  return {
    snapshot: {
      memories: [],
      skills: [],
      skillSources: [],
      presets: [],
      projectContext: {
        schemaVersion: 2,
        projects: [],
        conversations: [],
        pendingProjectId: null,
      },
      savedItems: { schemaVersion: 1, items: [] },
    },
    applySteps: [...SYNC_APPLY_STEP_ORDER],
  };
}

function rawPreimage(): SyncUndoPreimageV1 {
  return {
    memoryRecords: [{ id: 17, raw: 'memory' }],
    storage: {
      skills: { present: true, value: { raw: 'skills' } },
      skillSources: { present: false },
      presets: { present: true, value: [{ raw: 'presets' }] },
      activePreset: { present: true, value: 'before-active' },
      projectContext: { present: true, value: { schemaVersion: 99 } },
      savedItems: { present: false },
    },
  };
}
