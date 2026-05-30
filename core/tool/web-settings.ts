/**
 * Per-tool enabled/disabled settings for built-in web tools.
 * Stored in chrome.storage.local so settings persist across sessions.
 */

import { WEB_SEARCH_TOOL_NAMES, type WebSearchToolName } from './web-search';

const STORAGE_KEY = 'deepseek_pp_web_tool_settings';

export type WebToolSettings = Record<WebSearchToolName, boolean>;

const DEFAULT_SETTINGS: WebToolSettings = {
  web_search: true,
  web_fetch: true,
};

export async function getWebToolSettings(): Promise<WebToolSettings> {
  const data = (await chrome.storage.local.get(STORAGE_KEY)) as Record<string, unknown>;
  const stored = data[STORAGE_KEY];
  if (stored && typeof stored === 'object' && !Array.isArray(stored)) {
    return {
      ...DEFAULT_SETTINGS,
      ...(stored as Partial<WebToolSettings>),
    };
  }
  return { ...DEFAULT_SETTINGS };
}

export async function setWebToolEnabled(name: WebSearchToolName, enabled: boolean): Promise<void> {
  const current = await getWebToolSettings();
  current[name] = enabled;
  await chrome.storage.local.set({ [STORAGE_KEY]: current });
}

export async function isWebToolEnabled(name: WebSearchToolName): Promise<boolean> {
  const settings = await getWebToolSettings();
  return settings[name] ?? true;
}
