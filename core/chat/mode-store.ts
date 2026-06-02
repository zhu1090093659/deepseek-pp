const STORAGE_KEY = 'deepseek_pp_chat_modes';

export interface ChatModes {
  thinkingEnabled: boolean;
  searchEnabled: boolean;
  modelType: 'expert' | null;
}

const DEFAULTS: ChatModes = {
  thinkingEnabled: true,
  searchEnabled: true,
  modelType: null,
};

export async function getChatModes(): Promise<ChatModes> {
  const data = await chrome.storage.local.get(STORAGE_KEY) as Record<string, Partial<ChatModes> | undefined>;
  const stored = data[STORAGE_KEY];
  if (!stored || typeof stored !== 'object') return { ...DEFAULTS };
  return {
    thinkingEnabled: stored.thinkingEnabled === true,
    searchEnabled: stored.searchEnabled === true,
    modelType: stored.modelType === 'expert' ? 'expert' : null,
  };
}

export async function setChatModes(modes: Partial<ChatModes>): Promise<void> {
  const current = await getChatModes();
  const next = { ...current, ...modes };
  await chrome.storage.local.set({ [STORAGE_KEY]: next });
}
