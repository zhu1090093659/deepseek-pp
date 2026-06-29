export const MULTIMODAL_SETTINGS_STORAGE_KEY = 'deepseek_pp_multimodal_settings';

export interface MultimodalSettings {
  openaiApiKey: string | null;
  geminiApiKey: string | null;
  siliconflowApiKey: string | null;
  openaiImageModel: string;
  geminiVideoModel: string;
  siliconflowImageModel: string;
  siliconflowVideoModel: string;
  openaiBaseUrl: string;
  geminiBaseUrl: string;
  siliconflowBaseUrl: string;
}

export interface MultimodalSettingsStatus {
  openaiConfigured: boolean;
  geminiConfigured: boolean;
  siliconflowConfigured: boolean;
  openaiImageModel: string;
  geminiVideoModel: string;
  siliconflowImageModel: string;
  siliconflowVideoModel: string;
  openaiBaseUrl: string;
  geminiBaseUrl: string;
  siliconflowBaseUrl: string;
}

export interface MultimodalSettingsPatch {
  openaiApiKey?: string;
  geminiApiKey?: string;
  siliconflowApiKey?: string;
  openaiImageModel?: string;
  geminiVideoModel?: string;
  siliconflowImageModel?: string;
  siliconflowVideoModel?: string;
  openaiBaseUrl?: string;
  geminiBaseUrl?: string;
  siliconflowBaseUrl?: string;
}

export const DEFAULT_MULTIMODAL_SETTINGS: MultimodalSettings = {
  openaiApiKey: null,
  geminiApiKey: null,
  siliconflowApiKey: null,
  openaiImageModel: 'gpt-4.1-mini',
  geminiVideoModel: 'gemini-2.5-flash',
  siliconflowImageModel: 'Qwen/Qwen3-VL-30B-A3B-Instruct',
  siliconflowVideoModel: 'Qwen/Qwen3-Omni-30B-A3B-Instruct',
  openaiBaseUrl: 'https://api.openai.com/v1',
  geminiBaseUrl: 'https://generativelanguage.googleapis.com',
  siliconflowBaseUrl: 'https://api.siliconflow.cn/v1',
};

export async function getMultimodalSettings(): Promise<MultimodalSettings> {
  const data = await chrome.storage.local.get(MULTIMODAL_SETTINGS_STORAGE_KEY) as Record<string, unknown>;
  return normalizeMultimodalSettings(data[MULTIMODAL_SETTINGS_STORAGE_KEY]);
}

export async function getMultimodalSettingsStatus(): Promise<MultimodalSettingsStatus> {
  const settings = await getMultimodalSettings();
  return {
    openaiConfigured: Boolean(settings.openaiApiKey),
    geminiConfigured: Boolean(settings.geminiApiKey),
    siliconflowConfigured: Boolean(settings.siliconflowApiKey),
    openaiImageModel: settings.openaiImageModel,
    geminiVideoModel: settings.geminiVideoModel,
    siliconflowImageModel: settings.siliconflowImageModel,
    siliconflowVideoModel: settings.siliconflowVideoModel,
    openaiBaseUrl: settings.openaiBaseUrl,
    geminiBaseUrl: settings.geminiBaseUrl,
    siliconflowBaseUrl: settings.siliconflowBaseUrl,
  };
}

export async function saveMultimodalSettings(patch: MultimodalSettingsPatch): Promise<MultimodalSettingsStatus> {
  const current = await getMultimodalSettings();
  const next = normalizeMultimodalSettings({
    ...current,
    ...definedPatch(patch),
  });
  validateHttpBaseUrl(next.openaiBaseUrl, 'OpenAI request URL');
  validateHttpBaseUrl(next.geminiBaseUrl, 'Gemini request URL');
  validateHttpBaseUrl(next.siliconflowBaseUrl, 'SiliconFlow request URL');
  await chrome.storage.local.set({ [MULTIMODAL_SETTINGS_STORAGE_KEY]: next });
  return getMultimodalSettingsStatus();
}

export async function clearMultimodalSettings(): Promise<MultimodalSettingsStatus> {
  await chrome.storage.local.remove(MULTIMODAL_SETTINGS_STORAGE_KEY);
  return getMultimodalSettingsStatus();
}

export async function getMultimodalNativeEnv(): Promise<Record<string, string>> {
  const settings = await getMultimodalSettings();
  const env: Record<string, string> = {
    OPENAI_IMAGE_MODEL: settings.openaiImageModel,
    GEMINI_VIDEO_MODEL: settings.geminiVideoModel,
    SILICONFLOW_IMAGE_MODEL: settings.siliconflowImageModel,
    SILICONFLOW_VIDEO_MODEL: settings.siliconflowVideoModel,
    OPENAI_BASE_URL: settings.openaiBaseUrl,
    GEMINI_BASE_URL: settings.geminiBaseUrl,
    SILICONFLOW_BASE_URL: settings.siliconflowBaseUrl,
  };
  if (settings.openaiApiKey) env.OPENAI_API_KEY = settings.openaiApiKey;
  if (settings.geminiApiKey) env.GEMINI_API_KEY = settings.geminiApiKey;
  if (settings.siliconflowApiKey) env.SILICONFLOW_API_KEY = settings.siliconflowApiKey;
  return env;
}

export function normalizeMultimodalSettings(value: unknown): MultimodalSettings {
  const object = value && typeof value === 'object' ? value as Partial<MultimodalSettings> : {};
  return {
    openaiApiKey: normalizeSecret(object.openaiApiKey),
    geminiApiKey: normalizeSecret(object.geminiApiKey),
    siliconflowApiKey: normalizeSecret(object.siliconflowApiKey),
    openaiImageModel: normalizeModel(object.openaiImageModel, DEFAULT_MULTIMODAL_SETTINGS.openaiImageModel),
    geminiVideoModel: normalizeModel(object.geminiVideoModel, DEFAULT_MULTIMODAL_SETTINGS.geminiVideoModel),
    siliconflowImageModel: normalizeModel(object.siliconflowImageModel, DEFAULT_MULTIMODAL_SETTINGS.siliconflowImageModel),
    siliconflowVideoModel: normalizeModel(object.siliconflowVideoModel, DEFAULT_MULTIMODAL_SETTINGS.siliconflowVideoModel),
    openaiBaseUrl: normalizeBaseUrl(object.openaiBaseUrl, DEFAULT_MULTIMODAL_SETTINGS.openaiBaseUrl),
    geminiBaseUrl: normalizeBaseUrl(object.geminiBaseUrl, DEFAULT_MULTIMODAL_SETTINGS.geminiBaseUrl),
    siliconflowBaseUrl: normalizeBaseUrl(object.siliconflowBaseUrl, DEFAULT_MULTIMODAL_SETTINGS.siliconflowBaseUrl),
  };
}

function definedPatch(patch: MultimodalSettingsPatch): Partial<MultimodalSettings> {
  const result: Partial<MultimodalSettings> = {};
  if (patch.openaiApiKey !== undefined) result.openaiApiKey = normalizeSecret(patch.openaiApiKey);
  if (patch.geminiApiKey !== undefined) result.geminiApiKey = normalizeSecret(patch.geminiApiKey);
  if (patch.siliconflowApiKey !== undefined) result.siliconflowApiKey = normalizeSecret(patch.siliconflowApiKey);
  if (patch.openaiImageModel !== undefined) result.openaiImageModel = patch.openaiImageModel;
  if (patch.geminiVideoModel !== undefined) result.geminiVideoModel = patch.geminiVideoModel;
  if (patch.siliconflowImageModel !== undefined) result.siliconflowImageModel = patch.siliconflowImageModel;
  if (patch.siliconflowVideoModel !== undefined) result.siliconflowVideoModel = patch.siliconflowVideoModel;
  if (patch.openaiBaseUrl !== undefined) result.openaiBaseUrl = patch.openaiBaseUrl;
  if (patch.geminiBaseUrl !== undefined) result.geminiBaseUrl = patch.geminiBaseUrl;
  if (patch.siliconflowBaseUrl !== undefined) result.siliconflowBaseUrl = patch.siliconflowBaseUrl;
  return result;
}

function normalizeSecret(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeModel(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

function normalizeBaseUrl(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim().replace(/\/+$/, '');
  return trimmed.length > 0 ? trimmed : fallback;
}

function validateHttpBaseUrl(value: string, label: string): void {
  try {
    const url = new URL(value);
    if (url.protocol === 'http:' || url.protocol === 'https:') return;
  } catch {}
  throw new Error(`${label} must be a valid http(s) URL`);
}
