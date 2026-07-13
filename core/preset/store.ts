import type { SystemPromptPreset } from '../types';
import { withSyncLocalStateLock } from '../persistence/local-state-lock';

export const PRESETS_STORAGE_KEY = 'deepseek_pp_presets';
export const ACTIVE_PRESET_STORAGE_KEY = 'deepseek_pp_active_preset_id';

export async function getAllPresets(): Promise<SystemPromptPreset[]> {
  const data = await chrome.storage.local.get(PRESETS_STORAGE_KEY) as Record<string, unknown>;
  const presets = data[PRESETS_STORAGE_KEY];
  return Array.isArray(presets) ? (presets as SystemPromptPreset[]) : [];
}

export async function savePreset(preset: SystemPromptPreset): Promise<void> {
  await withSyncLocalStateLock(async () => {
    const presets = await getAllPresets();
    const idx = presets.findIndex((p) => p.id === preset.id);
    const next = [...presets];
    if (idx >= 0) {
      next[idx] = preset;
    } else {
      next.push(preset);
    }
    await writePresetCollection(next);
  });
}

export async function deletePreset(id: string): Promise<void> {
  await withSyncLocalStateLock(async () => {
    const presets = await getAllPresets();
    await writePresetCollection(presets.filter((p) => p.id !== id));

    const activeId = await getActivePresetId();
    if (activeId === id) await writeActivePresetId(null);
  });
}

export async function getActivePresetId(): Promise<string | null> {
  const data = await chrome.storage.local.get(ACTIVE_PRESET_STORAGE_KEY) as Record<string, unknown>;
  const activeId = data[ACTIVE_PRESET_STORAGE_KEY];
  return typeof activeId === 'string' ? activeId : null;
}

export async function setActivePresetId(id: string | null): Promise<void> {
  await withSyncLocalStateLock(() => writeActivePresetId(id));
}

export async function clearActivePresetForSyncApply(): Promise<void> {
  await writeActivePresetId(null);
}

async function writeActivePresetId(id: string | null): Promise<void> {
  if (id === null) {
    await chrome.storage.local.remove(ACTIVE_PRESET_STORAGE_KEY);
  } else {
    await chrome.storage.local.set({ [ACTIVE_PRESET_STORAGE_KEY]: id });
  }
}

export async function getActivePreset(): Promise<SystemPromptPreset | null> {
  const activeId = await getActivePresetId();
  if (!activeId) return null;
  const presets = await getAllPresets();
  return presets.find((p) => p.id === activeId) ?? null;
}

export async function replacePresetCollectionForSyncApply(
  presets: SystemPromptPreset[],
): Promise<void> {
  await writePresetCollection(presets);
}

async function writePresetCollection(presets: SystemPromptPreset[]): Promise<void> {
  await chrome.storage.local.set({ [PRESETS_STORAGE_KEY]: presets });
}
