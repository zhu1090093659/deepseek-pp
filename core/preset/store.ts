import type { SystemPromptPreset } from '../types';

const STORAGE_KEY = 'deepseek_pp_presets';
const ACTIVE_KEY = 'deepseek_pp_active_preset_id';

export async function getAllPresets(): Promise<SystemPromptPreset[]> {
  const data = await chrome.storage.local.get(STORAGE_KEY);
  return data[STORAGE_KEY] ?? [];
}

export async function savePreset(preset: SystemPromptPreset): Promise<void> {
  const presets = await getAllPresets();
  const idx = presets.findIndex((p) => p.id === preset.id);
  if (idx >= 0) {
    presets[idx] = preset;
  } else {
    presets.push(preset);
  }
  await chrome.storage.local.set({ [STORAGE_KEY]: presets });
}

export async function deletePreset(id: string): Promise<void> {
  const presets = await getAllPresets();
  const filtered = presets.filter((p) => p.id !== id);
  await chrome.storage.local.set({ [STORAGE_KEY]: filtered });

  const activeId = await getActivePresetId();
  if (activeId === id) {
    await setActivePresetId(null);
  }
}

export async function getActivePresetId(): Promise<string | null> {
  const data = await chrome.storage.local.get(ACTIVE_KEY);
  return data[ACTIVE_KEY] ?? null;
}

export async function setActivePresetId(id: string | null): Promise<void> {
  if (id === null) {
    await chrome.storage.local.remove(ACTIVE_KEY);
  } else {
    await chrome.storage.local.set({ [ACTIVE_KEY]: id });
  }
}

export async function getActivePreset(): Promise<SystemPromptPreset | null> {
  const activeId = await getActivePresetId();
  if (!activeId) return null;
  const presets = await getAllPresets();
  return presets.find((p) => p.id === activeId) ?? null;
}

export async function replaceAllPresets(presets: SystemPromptPreset[]): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: presets });
}
