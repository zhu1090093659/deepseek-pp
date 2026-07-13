import type { SyncConfig } from '../types';

export const SYNC_CONFIG_STORAGE_KEY = 'deepseek_pp_sync_config';

export async function getSyncConfig(): Promise<SyncConfig | null> {
  const data = await chrome.storage.local.get(SYNC_CONFIG_STORAGE_KEY) as Record<string, SyncConfig | undefined>;
  return data[SYNC_CONFIG_STORAGE_KEY] ?? null;
}

export async function saveSyncConfig(config: SyncConfig): Promise<void> {
  await chrome.storage.local.set({ [SYNC_CONFIG_STORAGE_KEY]: config });
}
