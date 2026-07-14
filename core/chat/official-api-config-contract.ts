export const OFFICIAL_DEEPSEEK_MODELS = ['deepseek-v4-flash', 'deepseek-v4-pro'] as const;
export type OfficialDeepSeekModel = typeof OFFICIAL_DEEPSEEK_MODELS[number];

export const OFFICIAL_DEEPSEEK_THINKING_MODES = ['disabled', 'enabled'] as const;
export type OfficialDeepSeekThinkingMode = typeof OFFICIAL_DEEPSEEK_THINKING_MODES[number];

export const OFFICIAL_DEEPSEEK_REASONING_EFFORTS = ['high', 'max'] as const;
export type OfficialDeepSeekReasoningEffort = typeof OFFICIAL_DEEPSEEK_REASONING_EFFORTS[number];

export interface OfficialApiChatConfig {
  model: OfficialDeepSeekModel;
  thinking: OfficialDeepSeekThinkingMode;
  reasoningEffort: OfficialDeepSeekReasoningEffort;
}

export const DEFAULT_OFFICIAL_API_CHAT_CONFIG: OfficialApiChatConfig = {
  model: 'deepseek-v4-flash',
  thinking: 'disabled',
  reasoningEffort: 'high',
};
