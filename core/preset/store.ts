import type { SystemPromptPreset } from '../types';
import { withSyncLocalStateLock } from '../persistence/local-state-lock';
import {
  createChromeStorageSlot,
  createVersionedRepository,
  type RawStorageSlot,
} from '../persistence/versioned-repository';
import {
  decodeActivePresetId,
  decodePreset,
  decodePresetCollection,
  presetCollectionCodec,
} from './codec';

export const PRESETS_STORAGE_KEY = 'deepseek_pp_presets';
export const ACTIVE_PRESET_STORAGE_KEY = 'deepseek_pp_active_preset_id';

const presetRepository = createVersionedRepository({
  label: 'presets',
  createDefault: () => [],
  codec: presetCollectionCodec,
  storage: createChromeStorageSlot(PRESETS_STORAGE_KEY),
});
const activePresetStorage = createChromeStorageSlot(ACTIVE_PRESET_STORAGE_KEY);

export async function getAllPresets(): Promise<SystemPromptPreset[]> {
  return presetRepository.read();
}

export async function getAllPresetsAlreadyLocked(): Promise<SystemPromptPreset[]> {
  return presetRepository.readAlreadyLocked();
}

export async function savePreset(preset: SystemPromptPreset): Promise<void> {
  await withSyncLocalStateLock(async () => {
    const decoded = decodePreset(preset, 'preset');
    const presets = await getAllPresetsAlreadyLocked();
    const matchingIndexes = presets
      .map((item, index) => item.id === decoded.id ? index : -1)
      .filter((index) => index >= 0);
    if (matchingIndexes.length > 1) {
      throw new Error('Preset edit is ambiguous because the id is duplicated');
    }
    const index = matchingIndexes[0] ?? -1;
    const next = [...presets];
    if (index >= 0) {
      next[index] = decodePreset({ ...presets[index], ...decoded }, 'preset');
    } else {
      next.push(decoded);
    }
    await presetRepository.writeAfterReadAlreadyLocked(next);
  });
}

export async function stageDeletePresetAlreadyLocked(
  id: string,
): Promise<() => Promise<void>> {
  requireNonEmptyPresetId(id);
  const [presets, activeId] = await Promise.all([
    getAllPresetsAlreadyLocked(),
    getActivePresetIdAlreadyLocked(),
  ]);
  const next = presets.filter((preset) => preset.id !== id);

  return async () => {
    if (next.length !== presets.length) {
      await presetRepository.writeAfterReadAlreadyLocked(next);
    }
    if (activeId === id) await activePresetStorage.remove();
  };
}

export async function getActivePresetId(): Promise<string | null> {
  return withSyncLocalStateLock(getActivePresetIdAlreadyLocked);
}

export async function getActivePresetIdAlreadyLocked(): Promise<string | null> {
  return decodeActivePresetSlot(await activePresetStorage.read());
}

export async function setActivePresetId(id: string | null): Promise<void> {
  await withSyncLocalStateLock(async () => {
    await getActivePresetIdAlreadyLocked();
    if (id === null) {
      await activePresetStorage.remove();
      return;
    }
    requireNonEmptyPresetId(id);
    const presets = await getAllPresetsAlreadyLocked();
    if (!presets.some((preset) => preset.id === id)) {
      throw new Error(`Preset was not found: ${id}`);
    }
    await activePresetStorage.write(id);
  });
}

export async function clearActivePresetForSyncApply(): Promise<void> {
  const current = await activePresetStorage.read();
  if (!current.present) return;
  decodeActivePresetId(current.value, 'activePresetId');
  await activePresetStorage.remove();
}

export async function getActivePreset(): Promise<SystemPromptPreset | null> {
  return withSyncLocalStateLock(async () => {
    const [activeId, presets] = await Promise.all([
      getActivePresetIdAlreadyLocked(),
      getAllPresetsAlreadyLocked(),
    ]);
    if (!activeId) return null;
    return presets.find((preset) => preset.id === activeId) ?? null;
  });
}

export async function replacePresetCollectionForSyncApply(
  presets: SystemPromptPreset[],
): Promise<void> {
  const decoded = decodePresetCollection(presets, 'presets');
  await presetRepository.replaceAlreadyLocked(decoded);
}

function decodeActivePresetSlot(slot: RawStorageSlot): string | null {
  return slot.present
    ? decodeActivePresetId(slot.value, 'activePresetId')
    : null;
}

function requireNonEmptyPresetId(value: unknown): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error('Preset id is required');
  }
}
