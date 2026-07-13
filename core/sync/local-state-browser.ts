import {
  captureRawMemoryRecordsForSyncRecovery,
  replaceAllMemoriesForSyncApply,
  restoreRawMemoryRecordsForSyncRecovery,
} from '../memory/store';
import {
  ACTIVE_PRESET_STORAGE_KEY,
  PRESETS_STORAGE_KEY,
  clearActivePresetForSyncApply,
  replacePresetCollectionForSyncApply,
} from '../preset/store';
import {
  PROJECT_CONTEXT_STORAGE_KEY,
  saveProjectContextStateForSyncApply,
} from '../project/store';
import {
  SAVED_ITEMS_STORAGE_KEY,
  replaceAllSavedItemsForSyncApply,
} from '../saved-items/store';
import {
  SKILLS_STORAGE_KEY,
  SKILL_SOURCES_STORAGE_KEY,
  replaceAllCustomSkillsForSyncApply,
  replaceAllSkillSourcesForSyncApply,
} from '../skill/registry';
import type { Memory } from '../types';
import type { SyncDataSnapshot } from './snapshot';
import type {
  OpaqueStoragePreimage,
  SyncApplyStep,
  SyncLocalApplyPlan,
  SyncLocalStatePort,
  SyncUndoPreimageV1,
} from './local-apply';

export const SYNC_RECOVERY_STORAGE_KEYS = {
  skills: SKILLS_STORAGE_KEY,
  skillSources: SKILL_SOURCES_STORAGE_KEY,
  presets: PRESETS_STORAGE_KEY,
  activePreset: ACTIVE_PRESET_STORAGE_KEY,
  projectContext: PROJECT_CONTEXT_STORAGE_KEY,
  savedItems: SAVED_ITEMS_STORAGE_KEY,
} as const;

type SyncRecoveryStorageSlot = keyof typeof SYNC_RECOVERY_STORAGE_KEYS;

export const browserSyncLocalStatePort: SyncLocalStatePort = {
  captureUndoPreimage,
  stage: stageSyncLocalApply,
  applyStep,
  restoreStep,
};

async function captureUndoPreimage(): Promise<SyncUndoPreimageV1> {
  const storageKeys = Object.values(SYNC_RECOVERY_STORAGE_KEYS);
  const [memoryRecords, rawStorage] = await Promise.all([
    captureRawMemoryRecordsForSyncRecovery(),
    chrome.storage.local.get(storageKeys) as Promise<Record<string, unknown>>,
  ]);

  return {
    memoryRecords,
    storage: {
      skills: captureStorageValue(rawStorage, SKILLS_STORAGE_KEY),
      skillSources: captureStorageValue(rawStorage, SKILL_SOURCES_STORAGE_KEY),
      presets: captureStorageValue(rawStorage, PRESETS_STORAGE_KEY),
      activePreset: captureStorageValue(rawStorage, ACTIVE_PRESET_STORAGE_KEY),
      projectContext: captureStorageValue(rawStorage, PROJECT_CONTEXT_STORAGE_KEY),
      savedItems: captureStorageValue(rawStorage, SAVED_ITEMS_STORAGE_KEY),
    },
  };
}

export function stageSyncLocalApply(
  snapshot: SyncDataSnapshot,
  before: SyncUndoPreimageV1,
): SyncLocalApplyPlan {
  const memories = assignStableMemoryIds(snapshot.memories, before.memoryRecords);
  const applySteps: SyncApplyStep[] = ['memories', 'skills', 'skillSources', 'presets'];
  const activePresetId = before.storage.activePreset.present
    && typeof before.storage.activePreset.value === 'string'
    ? before.storage.activePreset.value
    : null;
  const clearActivePreset = activePresetId !== null
    && !snapshot.presets.some((preset) => preset.id === activePresetId);
  if (clearActivePreset) applySteps.push('activePreset');
  if (snapshot.projectContext) applySteps.push('projectContext');
  if (snapshot.savedItems) applySteps.push('savedItems');

  return {
    snapshot: { ...snapshot, memories },
    applySteps,
  };
}

async function applyStep(step: SyncApplyStep, plan: SyncLocalApplyPlan): Promise<void> {
  const snapshot = plan.snapshot;
  switch (step) {
    case 'memories':
      await replaceAllMemoriesForSyncApply(snapshot.memories);
      return;
    case 'skills':
      await replaceAllCustomSkillsForSyncApply(snapshot.skills);
      return;
    case 'skillSources':
      await replaceAllSkillSourcesForSyncApply(snapshot.skillSources);
      return;
    case 'presets':
      await replacePresetCollectionForSyncApply(snapshot.presets);
      return;
    case 'activePreset':
      await clearActivePresetForSyncApply();
      return;
    case 'projectContext':
      if (!snapshot.projectContext) throw new Error('Project context apply step was not staged');
      await saveProjectContextStateForSyncApply(snapshot.projectContext);
      return;
    case 'savedItems':
      if (!snapshot.savedItems) throw new Error('Saved items apply step was not staged');
      await replaceAllSavedItemsForSyncApply(snapshot.savedItems.items);
      return;
  }
}

async function restoreStep(step: SyncApplyStep, before: SyncUndoPreimageV1): Promise<void> {
  if (step === 'memories') {
    await restoreRawMemoryRecordsForSyncRecovery(before.memoryRecords);
    return;
  }
  await restoreStorageSlot(step, before);
}

async function restoreStorageSlot(step: Exclude<SyncApplyStep, 'memories'>, before: SyncUndoPreimageV1) {
  const slot = step satisfies SyncRecoveryStorageSlot;
  const key = SYNC_RECOVERY_STORAGE_KEYS[slot];
  const preimage = before.storage[slot];
  if (preimage.present) {
    await chrome.storage.local.set({ [key]: preimage.value });
  } else {
    await chrome.storage.local.remove(key);
  }
}

function captureStorageValue(
  rawStorage: Record<string, unknown>,
  key: string,
): OpaqueStoragePreimage {
  return Object.prototype.hasOwnProperty.call(rawStorage, key)
    ? { present: true, value: rawStorage[key] }
    : { present: false };
}

function assignStableMemoryIds(
  incoming: SyncDataSnapshot['memories'],
  before: readonly Record<string, unknown>[],
): Memory[] {
  const idsBySyncId = new Map<string, number[]>();
  let nextId = 1;

  for (const record of before) {
    const id = record.id;
    if (Number.isSafeInteger(id) && (id as number) > 0) {
      nextId = Math.max(nextId, (id as number) + 1);
    }
    if (typeof record.syncId !== 'string' || !Number.isSafeInteger(id) || (id as number) <= 0) continue;
    const ids = idsBySyncId.get(record.syncId) ?? [];
    ids.push(id as number);
    idsBySyncId.set(record.syncId, ids);
  }
  for (const ids of idsBySyncId.values()) ids.sort((left, right) => left - right);

  const occurrenceBySyncId = new Map<string, number>();
  return incoming.map((memory) => {
    const occurrence = occurrenceBySyncId.get(memory.syncId) ?? 0;
    occurrenceBySyncId.set(memory.syncId, occurrence + 1);
    const existingId = idsBySyncId.get(memory.syncId)?.[occurrence];
    if (existingId !== undefined) return { ...memory, id: existingId };
    if (!Number.isSafeInteger(nextId)) throw new Error('Memory id space is exhausted');
    return { ...memory, id: nextId++ };
  });
}
