import type { ToolResult } from '../tool/types';

export type MultimodalMediaKind = 'image' | 'video';

export const MULTIMODAL_MEDIA_IMAGE_MAX_BYTES = 8 * 1024 * 1024;
export const MULTIMODAL_MEDIA_VIDEO_INLINE_MAX_BYTES = 20 * 1024 * 1024;
export const MULTIMODAL_MEDIA_MAX_ITEMS_PER_TURN = 8;
export const MULTIMODAL_MEDIA_PREFLIGHT_PROMPT_START = '[DeepSeek++ automatic multimodal MCP analysis]';
export const MULTIMODAL_MEDIA_PREFLIGHT_PROMPT_END = '[/DeepSeek++ automatic multimodal MCP analysis]';

export interface MultimodalMediaInput {
  id: string;
  kind: MultimodalMediaKind;
  name: string;
  mimeType: string;
  sizeBytes: number;
  dataUrl?: string;
  base64Data?: string;
}

export interface MultimodalMediaAnalysisSubject {
  id: string;
  kind: MultimodalMediaKind;
  name: string;
  mimeType: string;
  sizeBytes: number;
}

export interface MultimodalMediaAnalyzeRequest {
  prompt: string;
  media: MultimodalMediaInput[];
  chatSessionId?: string | null;
  parentMessageId?: number | null;
}

export interface MultimodalMediaAnalysisItem {
  id: string;
  kind: MultimodalMediaKind;
  media: MultimodalMediaAnalysisSubject[];
  result: ToolResult;
}

export interface MultimodalMediaAnalyzeResponse {
  ok: boolean;
  analyses: MultimodalMediaAnalysisItem[];
  error?: string;
}

export interface MultimodalPendingRouteItem {
  id: string;
  routeKey: string;
  createdAt: number;
}

export interface MultimodalMediaRouteRequest {
  parentMessageId?: number | string | null;
}

export function normalizeMultimodalMediaAnalyzeRequest(
  value: unknown,
): MultimodalMediaAnalyzeRequest {
  const request = recordValue(value, 'ANALYZE_MULTIMODAL_MEDIA.payload');
  const prompt = typeof request.prompt === 'string' && request.prompt.trim()
    ? request.prompt.trim()
    : 'Analyze the attached media.';
  const media = normalizeMultimodalMediaInputs(request.media);

  const chatSessionId = optionalNullableString(
    request.chatSessionId,
    'ANALYZE_MULTIMODAL_MEDIA.payload.chatSessionId',
  );
  const parentMessageId = optionalNullableMessageId(
    request.parentMessageId,
    'ANALYZE_MULTIMODAL_MEDIA.payload.parentMessageId',
  );

  return {
    prompt,
    media,
    ...(chatSessionId === undefined ? {} : { chatSessionId }),
    ...(parentMessageId === undefined ? {} : { parentMessageId }),
  };
}

export function assertSupportedMultimodalMedia(
  input: Pick<MultimodalMediaInput, 'kind' | 'mimeType' | 'sizeBytes' | 'name'>,
): void {
  if (input.kind === 'image') {
    if (!input.mimeType.startsWith('image/')) {
      throw new Error(`${input.name} is not an image file.`);
    }
    if (input.sizeBytes > MULTIMODAL_MEDIA_IMAGE_MAX_BYTES) {
      throw new Error(
        `${input.name} is larger than the ${formatLimit(MULTIMODAL_MEDIA_IMAGE_MAX_BYTES)} image limit.`,
      );
    }
    return;
  }

  if (!input.mimeType.startsWith('video/')) {
    throw new Error(`${input.name} is not a video file.`);
  }
  if (input.sizeBytes > MULTIMODAL_MEDIA_VIDEO_INLINE_MAX_BYTES) {
    throw new Error(
      `${input.name} is larger than the ${formatLimit(MULTIMODAL_MEDIA_VIDEO_INLINE_MAX_BYTES)} inline video limit. Use a public video URL or a future local-path picker for large videos.`,
    );
  }
}

function normalizeMultimodalMediaInputs(value: unknown): MultimodalMediaInput[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error('No multimodal media was provided.');
  }
  if (value.length > MULTIMODAL_MEDIA_MAX_ITEMS_PER_TURN) {
    throw new Error(`Attach at most ${MULTIMODAL_MEDIA_MAX_ITEMS_PER_TURN} media files per turn.`);
  }

  const normalized: MultimodalMediaInput[] = [];
  for (let index = 0; index < value.length; index++) {
    if (!Object.prototype.hasOwnProperty.call(value, index)) {
      throw new Error(`media[${index}] must be provided.`);
    }
    const item = value[index];
    const input = recordValue(item, `media[${index}]`);
    const kind = input.kind;
    if (kind !== 'image' && kind !== 'video') {
      throw new Error(`media[${index}].kind must be image or video.`);
    }
    const normalizedItem: MultimodalMediaInput = {
      id: nonEmptyString(input.id, `media[${index}].id`),
      kind,
      name: nonEmptyString(input.name, `media[${index}].name`),
      mimeType: nonEmptyString(input.mimeType, `media[${index}].mimeType`),
      sizeBytes: finiteNonNegativeNumber(input.sizeBytes, `media[${index}].sizeBytes`),
      dataUrl: typeof input.dataUrl === 'string' && input.dataUrl ? input.dataUrl : undefined,
      base64Data: typeof input.base64Data === 'string' && input.base64Data
        ? input.base64Data
        : undefined,
    };
    assertSupportedMultimodalMedia(normalizedItem);
    assertMultimodalMediaBody(normalizedItem);
    normalized.push(normalizedItem);
  }
  return normalized;
}

function assertMultimodalMediaBody(input: MultimodalMediaInput): void {
  if (input.kind === 'image') {
    if (!input.dataUrl) throw new Error(`${input.name} is missing image data.`);
    const separator = input.dataUrl.indexOf(',');
    const header = separator >= 0 ? input.dataUrl.slice(0, separator) : '';
    const headerMatch = /^data:([^;,]+);base64$/.exec(header);
    if (!headerMatch) throw new Error(`${input.name} image data must be a base64 data URL.`);
    if (headerMatch[1] !== input.mimeType) {
      throw new Error(`Image MIME type changed from ${input.mimeType} to ${headerMatch[1]}.`);
    }
    assertBase64Size(input.dataUrl.slice(separator + 1), input.sizeBytes, input.name);
    return;
  }

  if (!input.base64Data) throw new Error(`${input.name} is missing video data.`);
  assertBase64Size(input.base64Data, input.sizeBytes, input.name);
}

function assertBase64Size(value: string, expectedBytes: number, name: string): void {
  const expectedEncodedLength = Math.ceil(expectedBytes / 3) * 4;
  if (value.length !== expectedEncodedLength) {
    throw new Error(`${name} payload size changed during transfer.`);
  }
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new Error(`${name} contains invalid base64 data.`);
  }
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  const actualBytes = (value.length / 4) * 3 - padding;
  if (actualBytes !== expectedBytes) {
    throw new Error(`${name} payload size changed during transfer.`);
  }
}

function recordValue(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be a plain object.`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error(`${label} must be a plain object.`);
  }
  return value as Record<string, unknown>;
}

function nonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value.trim();
}

function finiteNonNegativeNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a non-negative number.`);
  }
  return value;
}

function optionalNullableString(value: unknown, label: string): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== 'string') throw new Error(`${label} must be a string or null.`);
  return value;
}

function optionalNullableMessageId(value: unknown, label: string): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (!Number.isInteger(value) || (value as number) < 0) {
    throw new Error(`${label} must be a non-negative integer or null.`);
  }
  return value as number;
}

export function buildMultimodalAnalysisPrompt(
  userPrompt: string,
  analyses: readonly MultimodalMediaAnalysisItem[],
): string {
  if (analyses.length === 0) return userPrompt;

  const mediaText = analyses.map((item, index) => {
    const text = toolResultText(item.result);
    const subjects = item.media.map((media) =>
      `- ${media.name} (${media.mimeType}, ${media.sizeBytes} bytes)`,
    ).join('\n');
    return [
      `Media analysis ${index + 1}: ${item.kind}`,
      subjects,
      text,
    ].filter(Boolean).join('\n');
  }).join('\n\n');

  return [
    MULTIMODAL_MEDIA_PREFLIGHT_PROMPT_START,
    mediaText,
    MULTIMODAL_MEDIA_PREFLIGHT_PROMPT_END,
    '',
    userPrompt,
  ].join('\n');
}

export function hasDeepSeekChatSessionRoute(routeKey: string): boolean {
  const pathname = routeKey.split('?')[0] ?? routeKey;
  return /\/(?:a\/)?chat\/s\/[^/?#]+/.test(pathname);
}

export function shouldPreserveInitialMultimodalMediaRoute(
  previousRouteKey: string,
  nextRouteKey: string,
): boolean {
  return previousRouteKey !== nextRouteKey &&
    !hasDeepSeekChatSessionRoute(previousRouteKey) &&
    hasDeepSeekChatSessionRoute(nextRouteKey);
}

export function selectMultimodalMediaRouteKeyForRequest(
  pending: readonly MultimodalPendingRouteItem[],
  currentRouteKey: string,
  request: MultimodalMediaRouteRequest,
): string | null {
  if (pending.some((item) => item.routeKey === currentRouteKey)) return currentRouteKey;
  if (!isInitialMultimodalRequest(request)) return null;

  let selected: MultimodalPendingRouteItem | null = null;
  for (const item of pending) {
    if (hasDeepSeekChatSessionRoute(item.routeKey)) continue;
    if (!selected || item.createdAt > selected.createdAt) selected = item;
  }
  return selected?.routeKey ?? null;
}

function isInitialMultimodalRequest(request: MultimodalMediaRouteRequest): boolean {
  return request.parentMessageId == null;
}

function toolResultText(result: ToolResult): string {
  const outputText = extractOutputText(result.output);
  if (outputText) return outputText;
  return result.detail || result.summary;
}

function extractOutputText(output: unknown): string {
  if (!output || typeof output !== 'object') return '';
  const text = (output as { text?: unknown }).text;
  return typeof text === 'string' ? text.trim() : '';
}

function formatLimit(bytes: number): string {
  return `${Math.floor(bytes / 1024 / 1024)} MB`;
}
