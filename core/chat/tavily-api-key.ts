export const TAVILY_API_KEY_STORAGE_KEY = 'deepseek_pp_tavily_api_key';

export async function getTavilyApiKey(): Promise<string | null> {
  const data = await chrome.storage.local.get(TAVILY_API_KEY_STORAGE_KEY) as Record<string, unknown>;
  return normalizeApiKey(data[TAVILY_API_KEY_STORAGE_KEY]);
}

export async function hasTavilyApiKey(): Promise<boolean> {
  return (await getTavilyApiKey()) !== null;
}

export async function saveTavilyApiKey(apiKey: string): Promise<void> {
  const normalized = normalizeApiKey(apiKey);
  if (!normalized) {
    throw new Error('Tavily API Key cannot be empty');
  }
  if (!normalized.startsWith('tvly-')) {
    throw new Error('Invalid Tavily API Key format (expected tvly-…)');
  }
  await chrome.storage.local.set({ [TAVILY_API_KEY_STORAGE_KEY]: normalized });
}

export async function clearTavilyApiKey(): Promise<void> {
  await chrome.storage.local.remove(TAVILY_API_KEY_STORAGE_KEY);
}

function normalizeApiKey(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
