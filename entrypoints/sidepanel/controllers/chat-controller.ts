import {
  DEFAULT_OFFICIAL_API_CHAT_CONFIG,
  normalizeOfficialApiChatConfig,
  type OfficialApiChatConfig,
} from '../../../core/chat/official-api-config';
import type { DeepSeekUploadedFile } from '../../../core/deepseek/contracts';
import type { ModelType } from '../../../core/types';
import {
  DEFAULT_VOICE_SETTINGS,
  normalizeVoiceSettings,
  type VoiceSettings,
} from '../../../core/voice/settings';
import {
  sidepanelRuntimeClient,
  type SidepanelRuntimeClient,
} from '../runtime-client';

export type ChatProvider = 'official-api' | 'deepseek-web' | null;

export interface ChatAuthStatus {
  available: boolean;
  provider: ChatProvider;
  hasApiKey: boolean;
  hasToken: boolean;
}

export interface ChatRuntimeSnapshot {
  authStatus: ChatAuthStatus;
  chatConfig: OfficialApiChatConfig;
  webModelType: ModelType;
  voiceSettings: VoiceSettings;
  loadErrors: readonly unknown[];
}

export interface ChatProviderCapabilities {
  apiControlsEnabled: boolean;
  webControlsEnabled: boolean;
  visionAttachmentsEnabled: boolean;
}

export interface ChatController {
  load(): Promise<ChatRuntimeSnapshot>;
  saveConfig(config: OfficialApiChatConfig): Promise<OfficialApiChatConfig>;
  submitPrompt(options: {
    text: string;
    authStatus: ChatAuthStatus | null;
    config: OfficialApiChatConfig;
    refFileIds: string[];
  }): Promise<void>;
  newSession(): Promise<void>;
  setWebModelType(modelType: ModelType): Promise<void>;
  uploadImage(payload: {
    dataUrl: string;
    name: string;
    mimeType: string;
    sizeBytes: number;
  }): Promise<DeepSeekUploadedFile>;
}

export function createChatController(
  runtimeClient: SidepanelRuntimeClient = sidepanelRuntimeClient,
): ChatController {
  const controller: ChatController = {
    async load() {
      const loadErrors: unknown[] = [];
      const [authStatus, chatConfig, webModelType, voiceSettings] = await Promise.all([
        loadOrReport(
          runtimeClient.request(
            { type: 'GET_AUTH_STATUS' },
            { decode: normalizeChatAuthStatus },
          ),
          { available: false, provider: null, hasApiKey: false, hasToken: false },
          loadErrors,
        ),
        loadOrReport(
          runtimeClient.request(
            { type: 'GET_OFFICIAL_API_CHAT_CONFIG' },
            { decode: normalizeOfficialApiChatConfig },
          ),
          DEFAULT_OFFICIAL_API_CHAT_CONFIG,
          loadErrors,
        ),
        loadOrReport(
          runtimeClient.request(
            { type: 'GET_MODEL_TYPE' },
            { decode: normalizeChatWebModelType },
          ),
          null,
          loadErrors,
        ),
        loadOrReport(
          runtimeClient.request(
            { type: 'GET_VOICE_SETTINGS' },
            { decode: normalizeVoiceSettings },
          ),
          DEFAULT_VOICE_SETTINGS,
          loadErrors,
        ),
      ]);
      return { authStatus, chatConfig, webModelType, voiceSettings, loadErrors };
    },
    saveConfig: (config) => runtimeClient.request(
      { type: 'SAVE_OFFICIAL_API_CHAT_CONFIG', payload: config },
      { decode: normalizeOfficialApiChatConfig },
    ),
    async submitPrompt({ text, authStatus, config, refFileIds }) {
      const capabilities = getChatProviderCapabilities(authStatus, null);
      await runtimeClient.request(
        {
          type: 'CHAT_SUBMIT_PROMPT',
          payload: {
            text,
            ...(capabilities.apiControlsEnabled ? { config } : {}),
            ...(capabilities.webControlsEnabled && refFileIds.length > 0 ? { refFileIds } : {}),
          },
        },
        { decode: decodeAck },
      );
    },
    async newSession() {
      await runtimeClient.request(
        { type: 'CHAT_NEW_SESSION' },
        { decode: decodeAck },
      );
    },
    async setWebModelType(modelType) {
      await runtimeClient.request(
        { type: 'SET_MODEL_TYPE', payload: modelType },
        { decode: decodeAck },
      );
    },
    uploadImage: (payload) => runtimeClient.request(
      { type: 'UPLOAD_DEEPSEEK_IMAGE', payload },
      { decode: decodeImageUploadResponse },
    ),
  };
  return Object.freeze(controller);
}

export const chatController = createChatController();

async function loadOrReport<T>(
  operation: Promise<T>,
  fallback: T,
  errors: unknown[],
): Promise<T> {
  try {
    return await operation;
  } catch (error) {
    errors.push(error);
    return fallback;
  }
}

export function normalizeChatAuthStatus(value: unknown): ChatAuthStatus {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid GET_AUTH_STATUS response.');
  }
  const response = value as Record<string, unknown>;
  const provider = response.provider;
  if (provider !== undefined
    && provider !== null
    && provider !== 'official-api'
    && provider !== 'deepseek-web') {
    throw new Error('GET_AUTH_STATUS response.provider is invalid.');
  }
  const hasToken = response.hasToken === true;
  return {
    available: typeof response.available === 'boolean' ? response.available : hasToken,
    provider: provider === 'official-api' || provider === 'deepseek-web'
      ? provider
      : hasToken ? 'deepseek-web' : null,
    hasApiKey: response.hasApiKey === true,
    hasToken,
  };
}

export function normalizeChatWebModelType(value: unknown): ModelType {
  return value === 'expert' || value === 'vision' ? value : null;
}

export function getChatProviderCapabilities(
  authStatus: ChatAuthStatus | null,
  modelType: ModelType,
): ChatProviderCapabilities {
  const apiControlsEnabled = authStatus?.provider === 'official-api';
  const webControlsEnabled = authStatus?.provider === 'deepseek-web';
  return {
    apiControlsEnabled,
    webControlsEnabled,
    visionAttachmentsEnabled: webControlsEnabled && modelType === 'vision',
  };
}

function decodeAck(value: unknown): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || (value as { ok?: unknown }).ok !== true) {
    throw new Error('Invalid chat runtime acknowledgement.');
  }
}

function decodeImageUploadResponse(value: unknown): DeepSeekUploadedFile {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid UPLOAD_DEEPSEEK_IMAGE response.');
  }
  const response = value as Record<string, unknown>;
  if (response.ok !== true || !response.file || typeof response.file !== 'object') {
    throw new Error('Invalid UPLOAD_DEEPSEEK_IMAGE response.');
  }
  const file = response.file as Record<string, unknown>;
  if (typeof file.id !== 'string' || file.id.length === 0) {
    throw new Error('UPLOAD_DEEPSEEK_IMAGE response.file.id is missing.');
  }
  return response.file as DeepSeekUploadedFile;
}
