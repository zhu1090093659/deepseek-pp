import type { SyncConfig } from '../types';

const CONFIG_KEY = 'deepseek_pp_sync_config';

export async function getSyncConfig(): Promise<SyncConfig | null> {
  const data = await chrome.storage.local.get(CONFIG_KEY);
  return data[CONFIG_KEY] ?? null;
}

export async function saveSyncConfig(config: SyncConfig): Promise<void> {
  await chrome.storage.local.set({ [CONFIG_KEY]: config });
}
