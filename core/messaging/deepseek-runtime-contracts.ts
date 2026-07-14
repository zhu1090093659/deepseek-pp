import type { OfficialApiChatConfig } from '../chat/official-api-config-contract';
import type { DeepSeekUploadedFile } from '../deepseek/contracts';
import type {
  ConversationExportErrorResult,
  ConversationExportRequest,
  ConversationExportResult,
} from '../export/types';
import type {
  MultimodalMediaAnalyzeResponse,
} from '../multimodal/media';
import type { MultimodalSettingsStatus } from '../multimodal/settings-contracts';
import type { MessageAction } from '../types';

type DeclaredRuntimeRequest<TType extends MessageAction['type']> = Extract<
  MessageAction,
  { type: TType }
>;

type Ack = { ok: true };
type DomainFailure = { ok: false; error: string };

export interface ChatAuthStatus {
  ok: true;
  available: boolean;
  provider: 'official-api' | 'deepseek-web' | null;
  hasApiKey: boolean;
  hasToken: boolean;
}

export interface ChatSubmitPromptPayload {
  text: string;
  config?: Partial<OfficialApiChatConfig>;
  refFileIds?: unknown;
}

export interface DeepSeekImageUploadPayload {
  dataUrl: string;
  name?: string;
  mimeType?: string;
  type?: string;
  sizeBytes?: number;
  size?: number;
}

export type DeepSeekImageUploadResponse =
  | { ok: true; file: DeepSeekUploadedFile }
  | DomainFailure;

export interface ConversationExportCommandPayload {
  exportId?: string;
  request?: unknown;
}

export interface NormalizedConversationExportCommand {
  exportId?: string;
  request: ConversationExportRequest;
}

export interface DeepSeekRuntimeCommandContracts {
  GET_DEEPSEEK_API_KEY_STATUS: {
    request: { type: 'GET_DEEPSEEK_API_KEY_STATUS' };
    response: { ok: true; configured: boolean };
  };
  SAVE_DEEPSEEK_API_KEY: {
    request: { type: 'SAVE_DEEPSEEK_API_KEY'; payload: { apiKey: string } };
    response: { ok: true; configured: true };
  };
  CLEAR_DEEPSEEK_API_KEY: {
    request: { type: 'CLEAR_DEEPSEEK_API_KEY' };
    response: { ok: true; configured: false };
  };
  GET_MULTIMODAL_SETTINGS_STATUS: {
    request: DeclaredRuntimeRequest<'GET_MULTIMODAL_SETTINGS_STATUS'>;
    response: { ok: true } & MultimodalSettingsStatus;
  };
  SAVE_MULTIMODAL_SETTINGS: {
    request: DeclaredRuntimeRequest<'SAVE_MULTIMODAL_SETTINGS'>;
    response: { ok: true } & MultimodalSettingsStatus;
  };
  CLEAR_MULTIMODAL_SETTINGS: {
    request: DeclaredRuntimeRequest<'CLEAR_MULTIMODAL_SETTINGS'>;
    response: { ok: true } & MultimodalSettingsStatus;
  };
  ANALYZE_MULTIMODAL_MEDIA: {
    request: DeclaredRuntimeRequest<'ANALYZE_MULTIMODAL_MEDIA'>;
    response: MultimodalMediaAnalyzeResponse;
  };
  CHAT_SUBMIT_PROMPT: {
    request: { type: 'CHAT_SUBMIT_PROMPT'; payload: ChatSubmitPromptPayload };
    response: Ack | DomainFailure;
  };
  UPLOAD_DEEPSEEK_IMAGE: {
    request: { type: 'UPLOAD_DEEPSEEK_IMAGE'; payload: DeepSeekImageUploadPayload };
    response: DeepSeekImageUploadResponse;
  };
  CHAT_NEW_SESSION: {
    request: { type: 'CHAT_NEW_SESSION' };
    response: Ack;
  };
  GET_AUTH_STATUS: {
    request: { type: 'GET_AUTH_STATUS' };
    response: ChatAuthStatus;
  };
  GET_OFFICIAL_API_CHAT_CONFIG: {
    request: DeclaredRuntimeRequest<'GET_OFFICIAL_API_CHAT_CONFIG'>;
    response: OfficialApiChatConfig;
  };
  SAVE_OFFICIAL_API_CHAT_CONFIG: {
    request: DeclaredRuntimeRequest<'SAVE_OFFICIAL_API_CHAT_CONFIG'>;
    response: OfficialApiChatConfig;
  };
  EXPORT_DEEPSEEK_CONVERSATIONS: {
    request: { type: 'EXPORT_DEEPSEEK_CONVERSATIONS'; payload?: ConversationExportCommandPayload };
    response: ConversationExportResult | ConversationExportErrorResult;
  };
  CANCEL_DEEPSEEK_EXPORT: {
    request: { type: 'CANCEL_DEEPSEEK_EXPORT'; payload: { exportId?: string } };
    response: Ack | DomainFailure;
  };
  AUTH_STATUS_CHANGED: {
    request: { type: 'AUTH_STATUS_CHANGED' };
    response: Ack;
  };
}
