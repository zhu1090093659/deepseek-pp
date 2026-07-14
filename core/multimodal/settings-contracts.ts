export interface MultimodalSettings {
  openaiApiKey: string | null;
  geminiApiKey: string | null;
  openaiImageModel: string;
  geminiVideoModel: string;
  openaiBaseUrl: string;
  geminiBaseUrl: string;
}

export interface MultimodalSettingsStatus {
  openaiConfigured: boolean;
  geminiConfigured: boolean;
  openaiImageModel: string;
  geminiVideoModel: string;
  openaiBaseUrl: string;
  geminiBaseUrl: string;
}

export interface MultimodalSettingsPatch {
  openaiApiKey?: string;
  geminiApiKey?: string;
  openaiImageModel?: string;
  geminiVideoModel?: string;
  openaiBaseUrl?: string;
  geminiBaseUrl?: string;
}

export const DEFAULT_MULTIMODAL_SETTINGS: MultimodalSettings = {
  openaiApiKey: null,
  geminiApiKey: null,
  openaiImageModel: 'gpt-4.1-mini',
  geminiVideoModel: 'gemini-2.5-flash',
  openaiBaseUrl: 'https://api.openai.com/v1',
  geminiBaseUrl: 'https://generativelanguage.googleapis.com',
};
