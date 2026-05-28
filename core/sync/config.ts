import type { SyncConfig } from '../types';
import { encryptString, decryptString } from '../crypto';

const CONFIG_KEY = 'deepseek_pp_sync_config';

export async function getSyncConfig(): Promise<SyncConfig | null> {
  const data = await chrome.storage.local.get(CONFIG_KEY) as Record<string, SyncConfig | undefined>;
  const config = data[CONFIG_KEY] ?? null;
  if (!config) return null;

  return {
    ...config,
    username: await decryptString(config.username),
    password: await decryptString(config.password),
  };
}

export async function saveSyncConfig(config: SyncConfig): Promise<void> {
  await chrome.storage.local.set({
    [CONFIG_KEY]: {
      ...config,
      username: await encryptString(config.username),
      password: await encryptString(config.password),
    },
  });
}
