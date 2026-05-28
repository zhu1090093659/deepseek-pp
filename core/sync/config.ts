import type { SyncConfig } from '../types';
import { encryptString, decryptString } from '../crypto';

const CONFIG_KEY = 'deepseek_pp_sync_config';

async function decryptOrMigrate(value: string): Promise<string> {
  try {
    return await decryptString(value);
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('Legacy plaintext')) {
      return value;
    }
    throw err;
  }
}

export async function getSyncConfig(): Promise<SyncConfig | null> {
  const data = await chrome.storage.local.get(CONFIG_KEY) as Record<string, SyncConfig | undefined>;
  const config = data[CONFIG_KEY] ?? null;
  if (!config) return null;

  return {
    ...config,
    username: await decryptOrMigrate(config.username),
    password: await decryptOrMigrate(config.password),
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
