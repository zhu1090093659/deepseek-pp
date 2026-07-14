import {
  DEFAULT_MULTIMODAL_SETTINGS,
  type MultimodalSettings,
  type MultimodalSettingsPatch,
  type MultimodalSettingsStatus,
} from './settings-contracts';

export { DEFAULT_MULTIMODAL_SETTINGS } from './settings-contracts';
export type {
  MultimodalSettings,
  MultimodalSettingsPatch,
  MultimodalSettingsStatus,
} from './settings-contracts';

export const MULTIMODAL_SETTINGS_STORAGE_KEY = 'deepseek_pp_multimodal_settings';

export async function getMultimodalSettings(): Promise<MultimodalSettings> {
  const data = await chrome.storage.local.get(MULTIMODAL_SETTINGS_STORAGE_KEY) as Record<string, unknown>;
  return normalizeMultimodalSettings(data[MULTIMODAL_SETTINGS_STORAGE_KEY]);
}

export async function getMultimodalSettingsStatus(): Promise<MultimodalSettingsStatus> {
  const settings = await getMultimodalSettings();
  return {
    openaiConfigured: Boolean(settings.openaiApiKey),
    geminiConfigured: Boolean(settings.geminiApiKey),
    openaiImageModel: settings.openaiImageModel,
    geminiVideoModel: settings.geminiVideoModel,
    openaiBaseUrl: settings.openaiBaseUrl,
    geminiBaseUrl: settings.geminiBaseUrl,
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
    OPENAI_BASE_URL: settings.openaiBaseUrl,
    GEMINI_BASE_URL: settings.geminiBaseUrl,
  };
  if (settings.openaiApiKey) env.OPENAI_API_KEY = settings.openaiApiKey;
  if (settings.geminiApiKey) env.GEMINI_API_KEY = settings.geminiApiKey;
  return env;
}

export function normalizeMultimodalSettings(value: unknown): MultimodalSettings {
  const object = value && typeof value === 'object' ? value as Partial<MultimodalSettings> : {};
  return {
    openaiApiKey: normalizeSecret(object.openaiApiKey),
    geminiApiKey: normalizeSecret(object.geminiApiKey),
    openaiImageModel: normalizeModel(object.openaiImageModel, DEFAULT_MULTIMODAL_SETTINGS.openaiImageModel),
    geminiVideoModel: normalizeModel(object.geminiVideoModel, DEFAULT_MULTIMODAL_SETTINGS.geminiVideoModel),
    openaiBaseUrl: normalizeBaseUrl(object.openaiBaseUrl, DEFAULT_MULTIMODAL_SETTINGS.openaiBaseUrl),
    geminiBaseUrl: normalizeBaseUrl(object.geminiBaseUrl, DEFAULT_MULTIMODAL_SETTINGS.geminiBaseUrl),
  };
}

function definedPatch(patch: MultimodalSettingsPatch): Partial<MultimodalSettings> {
  const result: Partial<MultimodalSettings> = {};
  if (patch.openaiApiKey !== undefined) result.openaiApiKey = normalizeSecret(patch.openaiApiKey);
  if (patch.geminiApiKey !== undefined) result.geminiApiKey = normalizeSecret(patch.geminiApiKey);
  if (patch.openaiImageModel !== undefined) result.openaiImageModel = patch.openaiImageModel;
  if (patch.geminiVideoModel !== undefined) result.geminiVideoModel = patch.geminiVideoModel;
  if (patch.openaiBaseUrl !== undefined) result.openaiBaseUrl = patch.openaiBaseUrl;
  if (patch.geminiBaseUrl !== undefined) result.geminiBaseUrl = patch.geminiBaseUrl;
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
