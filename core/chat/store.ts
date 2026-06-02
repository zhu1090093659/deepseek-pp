const STORAGE_KEY = 'deepseek_pp_chat_enabled';

// Must match STORAGE_HEADERS_KEY in core/deepseek/adapter.ts
const STORAGE_HEADERS_KEY = 'deepseekCachedClientHeaders';

export async function getChatEnabled(): Promise<boolean> {
  const data = await chrome.storage.local.get(STORAGE_KEY) as Record<string, unknown>;
  return data[STORAGE_KEY] === true;
}

export async function setChatEnabled(enabled: boolean): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: enabled });
  if (!enabled) {
    try {
      await chrome.storage.local.remove(STORAGE_HEADERS_KEY);
    } catch {}
  }
}
