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
import { decodeActivePresetId } from '../preset/codec';
import {
  PROJECT_CONTEXT_STORAGE_KEY,
  saveProjectContextStateForSyncApply,
} from '../project/store';
import {
  SAVED_ITEMS_STORAGE_KEY,
  replaceSavedItemsStateForSyncApply,
} from '../saved-items/store';
import {
  SKILLS_STORAGE_KEY,
  SKILL_SOURCES_STORAGE_KEY,
  replaceAllCustomSkillsForSyncApply,
  replaceAllSkillSourcesForSyncApply,
} from '../skill/registry';
import type { Memory } from '../types';
import { decodePersistedMemoryRecord } from '../memory/codec';
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
    ? decodeActivePresetId(before.storage.activePreset.value, 'activePresetId')
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
      await replaceSavedItemsStateForSyncApply(snapshot.savedItems);
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
  const recordsBySyncId = new Map<string, Memory[]>();
  let nextId = 1;

  for (const [index, rawRecord] of before.entries()) {
    const record = decodePersistedMemoryRecord(rawRecord, `memoryRecords[${index}]`);
    nextId = Math.max(nextId, (record.id as number) + 1);
    const records = recordsBySyncId.get(record.syncId) ?? [];
    records.push(record);
    recordsBySyncId.set(record.syncId, records);
  }
  for (const records of recordsBySyncId.values()) {
    records.sort((left, right) => (left.id as number) - (right.id as number));
  }

  const occurrenceBySyncId = new Map<string, number>();
  return incoming.map((memory) => {
    const occurrence = occurrenceBySyncId.get(memory.syncId) ?? 0;
    occurrenceBySyncId.set(memory.syncId, occurrence + 1);
    const existing = recordsBySyncId.get(memory.syncId)?.[occurrence];
    if (existing?.id !== undefined) {
      return {
        ...memoryAdditiveFields(existing),
        ...memory,
        id: existing.id,
      };
    }
    if (!Number.isSafeInteger(nextId)) throw new Error('Memory id space is exhausted');
    return { ...memory, id: nextId++ };
  });
}

function memoryAdditiveFields(memory: Memory): Record<string, unknown> {
  const {
    id: _id,
    syncId: _syncId,
    scope: _scope,
    projectId: _projectId,
    type: _type,
    name: _name,
    content: _content,
    description: _description,
    tags: _tags,
    pinned: _pinned,
    createdAt: _createdAt,
    updatedAt: _updatedAt,
    accessCount: _accessCount,
    lastAccessedAt: _lastAccessedAt,
    ...additiveFields
  } = memory as Memory & Record<string, unknown>;
  return additiveFields;
}
