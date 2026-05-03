import type { BackgroundConfig } from '../types';

const STORAGE_KEY = 'deepseek_pp_background';

export async function getBackgroundConfig(): Promise<BackgroundConfig | null> {
  const data = await chrome.storage.local.get(STORAGE_KEY);
  return data[STORAGE_KEY] ?? null;
}

export async function saveBackgroundConfig(config: BackgroundConfig): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: config });
}

export async function clearBackgroundConfig(): Promise<void> {
  await chrome.storage.local.remove(STORAGE_KEY);
}
