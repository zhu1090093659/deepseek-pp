import {
  DEFAULT_OFFICIAL_API_CHAT_CONFIG,
  type OfficialApiChatConfig,
  type OfficialDeepSeekModel,
  type OfficialDeepSeekReasoningEffort,
  type OfficialDeepSeekThinkingMode,
} from './official-api-config-contract';

export {
  DEFAULT_OFFICIAL_API_CHAT_CONFIG,
  OFFICIAL_DEEPSEEK_MODELS,
  OFFICIAL_DEEPSEEK_REASONING_EFFORTS,
  OFFICIAL_DEEPSEEK_THINKING_MODES,
} from './official-api-config-contract';
export type {
  OfficialApiChatConfig,
  OfficialDeepSeekModel,
  OfficialDeepSeekReasoningEffort,
  OfficialDeepSeekThinkingMode,
} from './official-api-config-contract';

export const OFFICIAL_API_CHAT_CONFIG_STORAGE_KEY = 'deepseek_pp_official_api_chat_config';

export async function getOfficialApiChatConfig(): Promise<OfficialApiChatConfig> {
  const data = await chrome.storage.local.get(OFFICIAL_API_CHAT_CONFIG_STORAGE_KEY) as Record<string, unknown>;
  return normalizeOfficialApiChatConfig(data[OFFICIAL_API_CHAT_CONFIG_STORAGE_KEY]);
}

export async function saveOfficialApiChatConfig(value: unknown): Promise<OfficialApiChatConfig> {
  const config = normalizeOfficialApiChatConfig(value);
  await chrome.storage.local.set({ [OFFICIAL_API_CHAT_CONFIG_STORAGE_KEY]: config });
  return config;
}

export function normalizeOfficialApiChatConfig(value: unknown): OfficialApiChatConfig {
  if (!value || typeof value !== 'object') return DEFAULT_OFFICIAL_API_CHAT_CONFIG;
  const object = value as Partial<Record<keyof OfficialApiChatConfig, unknown>>;
  const model = normalizeModel(object.model);
  const thinking = normalizeThinkingMode(object.thinking);
  return {
    model,
    thinking,
    reasoningEffort: thinking === 'enabled'
      ? normalizeReasoningEffort(object.reasoningEffort)
      : DEFAULT_OFFICIAL_API_CHAT_CONFIG.reasoningEffort,
  };
}

function normalizeModel(value: unknown): OfficialDeepSeekModel {
  return value === 'deepseek-v4-pro' ? 'deepseek-v4-pro' : 'deepseek-v4-flash';
}

function normalizeThinkingMode(value: unknown): OfficialDeepSeekThinkingMode {
  return value === 'enabled' ? 'enabled' : 'disabled';
}

function normalizeReasoningEffort(value: unknown): OfficialDeepSeekReasoningEffort {
  return value === 'max' ? 'max' : 'high';
}
