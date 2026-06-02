const STORAGE_KEY = 'deepseek_pp_chat_enabled';

export async function getChatEnabled(): Promise<boolean> {
  const data = await chrome.storage.local.get(STORAGE_KEY) as Record<string, unknown>;
  return data[STORAGE_KEY] === true;
}

export async function setChatEnabled(enabled: boolean): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: enabled });
}
