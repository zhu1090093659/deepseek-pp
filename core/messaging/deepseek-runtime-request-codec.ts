import { normalizeOfficialApiChatConfig } from '../chat/official-api-config';
import { DEEPSEEK_IMAGE_UPLOAD_MAX_BYTES } from '../deepseek/upload-limits';
import { normalizeConversationExportRequest } from '../export/schema';
import { normalizeMultimodalMediaAnalyzeRequest } from '../multimodal/media';
import type { MultimodalSettingsPatch } from '../multimodal/settings-contracts';
import type {
  DeepSeekRuntimeCommandContracts,
  NormalizedConversationExportCommand,
} from './deepseek-runtime-contracts';
import type { OfficialApiChatConfig } from '../chat/official-api-config-contract';
import type { MultimodalMediaAnalyzeRequest } from '../multimodal/media';
import { isPlainRuntimeRecord } from './runtime-boundary';

type DeepSeekRuntimeCommandType = keyof DeepSeekRuntimeCommandContracts;

export interface EncodedDeepSeekImageUploadRequest {
  isPlainObject: boolean;
  dataUrl: unknown;
  name: unknown;
  mimeType: unknown;
  alternateMimeType: unknown;
  sizeBytes: unknown;
  alternateSizeBytes: unknown;
}

export interface MaterializedDeepSeekImageUploadRequest {
  file: Blob;
  name: string;
  mimeType: string;
  sizeBytes: number;
}

export type DecodedMultimodalAnalyzeRequest =
  | { ok: true; request: MultimodalMediaAnalyzeRequest }
  | { ok: false; error: string };

interface DecodedDeepSeekRuntimePayloads {
  SAVE_DEEPSEEK_API_KEY: { apiKey: string };
  SAVE_MULTIMODAL_SETTINGS: MultimodalSettingsPatch;
  ANALYZE_MULTIMODAL_MEDIA: DecodedMultimodalAnalyzeRequest;
  CHAT_SUBMIT_PROMPT: {
    text: string;
    config?: OfficialApiChatConfig;
    refFileIds: string[];
  };
  UPLOAD_DEEPSEEK_IMAGE: EncodedDeepSeekImageUploadRequest;
  SAVE_OFFICIAL_API_CHAT_CONFIG: OfficialApiChatConfig;
  EXPORT_DEEPSEEK_CONVERSATIONS: NormalizedConversationExportCommand;
  CANCEL_DEEPSEEK_EXPORT: { exportId?: string };
}

export type DeepSeekRuntimePayloadCommandType = keyof DecodedDeepSeekRuntimePayloads;

export type DeepSeekRuntimeDecodedPayload<
  TType extends DeepSeekRuntimePayloadCommandType,
> = DecodedDeepSeekRuntimePayloads[TType];

type DeepSeekRuntimePayloadDecoderMap = {
  [TType in DeepSeekRuntimePayloadCommandType]: (
    value: unknown,
  ) => DeepSeekRuntimeDecodedPayload<TType>;
};

export const DEEPSEEK_RUNTIME_PAYLOAD_DECODERS: DeepSeekRuntimePayloadDecoderMap = {
  SAVE_DEEPSEEK_API_KEY(value) {
    const payload = recordValue(value, 'SAVE_DEEPSEEK_API_KEY.payload');
    if (typeof payload.apiKey !== 'string') {
      throw new Error('SAVE_DEEPSEEK_API_KEY.payload.apiKey must be a string.');
    }
    return { apiKey: payload.apiKey };
  },
  SAVE_MULTIMODAL_SETTINGS(value) {
    const payload = recordValue(value, 'SAVE_MULTIMODAL_SETTINGS.payload');
    const patch: MultimodalSettingsPatch = {};
    for (const field of MULTIMODAL_SETTINGS_FIELDS) {
      const fieldValue = payload[field];
      if (fieldValue === undefined) continue;
      if (typeof fieldValue !== 'string') {
        throw new Error(`SAVE_MULTIMODAL_SETTINGS.payload.${field} must be a string.`);
      }
      patch[field] = fieldValue;
    }
    return patch;
  },
  ANALYZE_MULTIMODAL_MEDIA(value) {
    try {
      return { ok: true, request: normalizeMultimodalMediaAnalyzeRequest(value) };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
  CHAT_SUBMIT_PROMPT(value) {
    const payload = recordValue(value, 'CHAT_SUBMIT_PROMPT.payload');
    if (typeof payload.text !== 'string') {
      throw new Error('CHAT_SUBMIT_PROMPT.payload.text must be a string.');
    }
    return {
      text: payload.text,
      ...(payload.config === undefined
        ? {}
        : { config: normalizeOfficialApiChatConfig(payload.config) }),
      refFileIds: coerceRefFileIds(payload.refFileIds),
    };
  },
  UPLOAD_DEEPSEEK_IMAGE(value) {
    // Preserve the released chat-disabled precedence and avoid allocating the
    // decoded image body until the feature gate has passed in the handler.
    return stageDeepSeekImageUpload(value);
  },
  SAVE_OFFICIAL_API_CHAT_CONFIG(value) {
    return normalizeOfficialApiChatConfig(value);
  },
  EXPORT_DEEPSEEK_CONVERSATIONS(value) {
    const payload = isPlainRuntimeRecord(value) ? value : {};
    const exportId = typeof payload.exportId === 'string' && payload.exportId.trim()
      ? payload.exportId.trim()
      : undefined;
    return {
      ...(exportId ? { exportId } : {}),
      request: normalizeConversationExportRequest(payload.request),
    };
  },
  CANCEL_DEEPSEEK_EXPORT(value) {
    const payload = recordValue(value, 'CANCEL_DEEPSEEK_EXPORT.payload');
    return {
      exportId: typeof payload.exportId === 'string' ? payload.exportId : undefined,
    };
  },
};

export function decodeDeepSeekRuntimePayload<
  TType extends DeepSeekRuntimePayloadCommandType,
>(
  type: TType,
  value: unknown,
): DeepSeekRuntimeDecodedPayload<TType> {
  return DEEPSEEK_RUNTIME_PAYLOAD_DECODERS[type](value);
}

export function materializeDeepSeekImageUpload(
  staged: EncodedDeepSeekImageUploadRequest,
): MaterializedDeepSeekImageUploadRequest {
  if (!staged.isPlainObject) {
    throw new Error('UPLOAD_DEEPSEEK_IMAGE.payload must be a plain object.');
  }
  const dataUrl = typeof staged.dataUrl === 'string' ? staged.dataUrl : '';
  const name = typeof staged.name === 'string' && staged.name.trim()
    ? staged.name.trim()
    : 'image';
  const mimeType = typeof staged.mimeType === 'string' && staged.mimeType.trim()
    ? staged.mimeType.trim()
    : typeof staged.alternateMimeType === 'string' && staged.alternateMimeType.trim()
      ? staged.alternateMimeType.trim()
      : '';
  const sizeBytes = typeof staged.sizeBytes === 'number' && Number.isFinite(staged.sizeBytes)
    ? staged.sizeBytes
    : typeof staged.alternateSizeBytes === 'number' && Number.isFinite(staged.alternateSizeBytes)
      ? staged.alternateSizeBytes
      : 0;

  if (!dataUrl.startsWith('data:')) {
    throw new Error('Image upload payload must include a data URL.');
  }
  if (!mimeType.startsWith('image/')) {
    throw new Error(`${name} is not an image file.`);
  }
  if (sizeBytes <= 0) throw new Error(`${name} is empty.`);
  if (sizeBytes > DEEPSEEK_IMAGE_UPLOAD_MAX_BYTES) {
    throw new Error(
      `${name} exceeds the ${formatUploadBytes(DEEPSEEK_IMAGE_UPLOAD_MAX_BYTES)} image upload limit.`,
    );
  }

  const prefix = `data:${mimeType};base64,`;
  if (!dataUrl.startsWith(prefix)) {
    const separator = dataUrl.indexOf(',');
    const actualMimeType = /^data:([^;,]+)/.exec(dataUrl.slice(0, Math.max(separator, 0)))?.[1];
    if (actualMimeType && actualMimeType !== mimeType) {
      throw new Error(`Image MIME type changed from ${mimeType} to ${actualMimeType}.`);
    }
    throw new Error('Image upload payload must be base64 encoded.');
  }

  const base64 = dataUrl.slice(prefix.length);
  const maxEncodedLength = Math.ceil(DEEPSEEK_IMAGE_UPLOAD_MAX_BYTES / 3) * 4;
  if (base64.length > maxEncodedLength) {
    throw new Error(
      `${name} exceeds the ${formatUploadBytes(DEEPSEEK_IMAGE_UPLOAD_MAX_BYTES)} image upload limit.`,
    );
  }
  const expectedEncodedLength = Math.ceil(sizeBytes / 3) * 4;
  if (base64.length !== expectedEncodedLength) {
    throw new Error('Image upload payload size changed during transfer.');
  }
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64)) {
    throw new Error('Image upload payload must be base64 encoded.');
  }

  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  const actualBytes = (base64.length / 4) * 3 - padding;
  if (actualBytes !== sizeBytes) {
    throw new Error('Image upload payload size changed during transfer.');
  }

  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index);
  }
  return {
    file: new Blob([bytes], { type: mimeType }),
    name,
    mimeType,
    sizeBytes,
  };
}

export function stageDeepSeekImageUpload(value: unknown): EncodedDeepSeekImageUploadRequest {
  if (!isPlainRuntimeRecord(value)) {
    return {
      isPlainObject: false,
      dataUrl: undefined,
      name: undefined,
      mimeType: undefined,
      alternateMimeType: undefined,
      sizeBytes: undefined,
      alternateSizeBytes: undefined,
    };
  }
  return {
    isPlainObject: true,
    dataUrl: value.dataUrl,
    name: value.name,
    mimeType: value.mimeType,
    alternateMimeType: value.type,
    sizeBytes: value.sizeBytes,
    alternateSizeBytes: value.size,
  };
}

function coerceRefFileIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean);
}

function recordValue(value: unknown, label: string): Record<string, unknown> {
  if (!isPlainRuntimeRecord(value)) throw new Error(`${label} must be a plain object.`);
  return value;
}

function formatUploadBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${Math.round(bytes / 1024 / 1024)}MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${bytes}B`;
}

const MULTIMODAL_SETTINGS_FIELDS = [
  'openaiApiKey',
  'geminiApiKey',
  'openaiImageModel',
  'geminiVideoModel',
  'openaiBaseUrl',
  'geminiBaseUrl',
] as const satisfies readonly (keyof MultimodalSettingsPatch)[];

type _AllDeepSeekRuntimePayloadCommandsAreDecoded = Exclude<
  DeepSeekRuntimePayloadCommandType,
  DeepSeekRuntimeCommandType
> extends never ? true : never;

const _allDeepSeekRuntimePayloadCommandsAreDecoded: _AllDeepSeekRuntimePayloadCommandsAreDecoded = true;
void _allDeepSeekRuntimePayloadCommandsAreDecoded;
