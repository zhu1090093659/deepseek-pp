export const RUNTIME_BOUNDARY_ERROR_CODES = {
  invalidMessage: 'runtime_message_invalid',
  unauthorizedSender: 'runtime_message_unauthorized',
} as const;

export type RuntimeBoundaryErrorCode =
  typeof RUNTIME_BOUNDARY_ERROR_CODES[keyof typeof RUNTIME_BOUNDARY_ERROR_CODES];

export interface RuntimeMessageEnvelope {
  type: string;
  payload?: unknown;
  [key: string]: unknown;
}

export interface RuntimeMessageSenderLike {
  id?: string;
  url?: string;
  origin?: string;
  nativeApplication?: string;
  frameId?: number;
  documentId?: string;
  documentLifecycle?: string;
  tab?: {
    id?: number | null;
    url?: string;
  };
}

export type RuntimeMessageSurface = 'extension_context' | 'deepseek_content';

export interface RuntimeMessageContext {
  runtimeId: string;
  surface: RuntimeMessageSurface;
  senderUrl: string;
  senderOrigin: string;
  tabId?: number;
  tabUrl?: string;
  frameId?: number;
  documentId?: string;
  documentLifecycle?: string;
  documentSessionId: string;
  chatSessionId?: string;
}

export interface RuntimeTrustPolicy {
  runtimeId: string;
  extensionOrigin: string;
  deepSeekOrigin?: string;
}

export const DEEPSEEK_CONTENT_RUNTIME_COMMANDS: ReadonlySet<string> = new Set([
  'ADD_CONVERSATION_TO_PROJECT',
  'ANALYZE_MULTIMODAL_MEDIA',
  'APPEND_EXTERNAL_TOOL_PAYLOAD_CHUNK',
  'AUTH_STATUS_CHANGED',
  'CLOSE_TOOL_AUTHORIZATION',
  'CREATE_TOOL_AUTHORIZATION',
  'EXECUTE_TOOL_CALL',
  'EXPORT_DEEPSEEK_CONVERSATIONS',
  'GET_ACTIVE_PRESET',
  'GET_ARTIFACT',
  'GET_BACKGROUND',
  'GET_MCP_SERVERS',
  'GET_MEMORIES',
  'GET_MODEL_TYPE',
  'GET_PET',
  'GET_PROJECT_CONTEXT_FOR_CONVERSATION',
  'GET_PROJECT_CONTEXT_STATE',
  'GET_PROMPT_INJECTION_SETTINGS',
  'GET_SKILLS',
  'GET_TOOL_DESCRIPTORS',
  'IMPORT_MEMORY_DRAFTS',
  'RECORD_USAGE_TURN',
  'REMOVE_CONVERSATION_FROM_PROJECT',
  'REQUEST_HOST_PERMISSION',
  'RUN_ARTIFACT_CODE',
  'SAVE_PET',
  'SAVE_SKILL',
  'SET_DEEPSEEK_THEME',
  'SET_PENDING_PROJECT_CONTEXT',
  'TOUCH_MEMORIES',
]);

export const BACKGROUND_RUNTIME_PATHNAMES = [
  '/background.js',
  '/_generated_background_page.html',
] as const;

export class RuntimeBoundaryError extends Error {
  readonly code: RuntimeBoundaryErrorCode;

  constructor(code: RuntimeBoundaryErrorCode, message: string) {
    super(message);
    this.name = 'RuntimeBoundaryError';
    this.code = code;
  }
}

export function decodeRuntimeMessageEnvelope(value: unknown): RuntimeMessageEnvelope {
  if (!isPlainRuntimeRecord(value) || typeof value.type !== 'string' || value.type.length === 0) {
    throw new RuntimeBoundaryError(
      RUNTIME_BOUNDARY_ERROR_CODES.invalidMessage,
      'Runtime message must be a plain object with a non-empty type.',
    );
  }
  return value as RuntimeMessageEnvelope;
}

export function createRuntimeMessageContext(
  sender: RuntimeMessageSenderLike,
  policy: RuntimeTrustPolicy,
): RuntimeMessageContext {
  if (sender.id !== policy.runtimeId || sender.nativeApplication) {
    throwUnauthorized('Runtime sender does not belong to this extension.');
  }
  if (sender.documentLifecycle && sender.documentLifecycle !== 'active') {
    throwUnauthorized('Runtime sender document is not active.');
  }

  const senderUrl = requiredUrl(sender.url);
  const senderOrigin = readUrlOrigin(senderUrl);
  const tabUrl = sender.tab?.url ? requiredUrl(sender.tab.url) : undefined;
  if (sender.origin && sender.origin !== senderOrigin) {
    throwUnauthorized('Runtime sender origin does not match its URL.');
  }

  const extensionOrigin = normalizeOrigin(policy.extensionOrigin);
  if (senderOrigin === extensionOrigin) {
    const frameId = validOptionalFrameId(sender.frameId);
    return {
      runtimeId: policy.runtimeId,
      surface: 'extension_context',
      senderUrl,
      senderOrigin,
      tabId: validTabId(sender.tab?.id),
      tabUrl,
      frameId,
      documentId: validDocumentId(sender.documentId),
      documentLifecycle: sender.documentLifecycle,
      documentSessionId: createDocumentSessionId('extension_context', sender, senderUrl, frameId),
    };
  }

  if (!policy.deepSeekOrigin) {
    throwUnauthorized('Runtime sender is not an extension context.');
  }
  const deepSeekOrigin = normalizeOrigin(policy.deepSeekOrigin);
  const tabId = validTabId(sender.tab?.id);
  const frameId = validOptionalFrameId(sender.frameId);
  if (senderOrigin !== deepSeekOrigin || tabId === undefined || (frameId !== undefined && frameId !== 0)) {
    throwUnauthorized('Runtime content sender is not the DeepSeek top-level frame.');
  }
  if (tabUrl && (readUrlOrigin(tabUrl) !== deepSeekOrigin || tabUrl !== senderUrl)) {
    throwUnauthorized('Runtime sender tab does not match the DeepSeek top-level document.');
  }
  if (frameId === undefined && tabUrl === undefined) {
    throwUnauthorized('Runtime content sender has no top-level frame evidence.');
  }

  return {
    runtimeId: policy.runtimeId,
    surface: 'deepseek_content',
    senderUrl,
    senderOrigin,
    tabId,
    tabUrl,
    frameId: frameId ?? 0,
    documentId: validDocumentId(sender.documentId),
    documentLifecycle: sender.documentLifecycle,
    documentSessionId: createDocumentSessionId('deepseek_content', sender, senderUrl, frameId ?? 0),
    chatSessionId: readDeepSeekChatSessionId(senderUrl),
  };
}

export function createExtensionRuntimeMessageContext(
  sender: RuntimeMessageSenderLike,
  policy: Pick<RuntimeTrustPolicy, 'runtimeId' | 'extensionOrigin'> & {
    allowedPathnames?: readonly string[];
  },
): RuntimeMessageContext {
  const context = createRuntimeMessageContext(sender, policy);
  if (context.surface !== 'extension_context') {
    throwUnauthorized('Runtime sender is not an extension context.');
  }
  if (
    policy.allowedPathnames &&
    !policy.allowedPathnames.includes(new URL(context.senderUrl).pathname)
  ) {
    throwUnauthorized('Runtime extension sender path is not authorized.');
  }
  return context;
}

export function authorizeRuntimeMessage(
  envelope: RuntimeMessageEnvelope,
  context: RuntimeMessageContext,
): void {
  if (context.surface === 'extension_context') return;
  if (DEEPSEEK_CONTENT_RUNTIME_COMMANDS.has(envelope.type)) return;
  throwUnauthorized(`Runtime command ${envelope.type} is not authorized for DeepSeek content.`);
}

export function createRuntimeBoundaryErrorResponse(
  error: unknown,
  envelope?: RuntimeMessageEnvelope,
): Record<string, unknown> {
  const code = error instanceof RuntimeBoundaryError
    ? error.code
    : RUNTIME_BOUNDARY_ERROR_CODES.invalidMessage;
  const message = error instanceof Error ? error.message : 'Runtime message rejected.';
  if (envelope?.type === 'EXECUTE_TOOL_CALL' || envelope?.type === 'RUN_ARTIFACT_CODE') {
    return {
      ok: false,
      summary: 'Runtime request rejected',
      detail: message,
      error: { code, message, retryable: false },
    };
  }
  return {
    ok: false,
    error: code,
  };
}

function createDocumentSessionId(
  surface: RuntimeMessageSurface,
  sender: RuntimeMessageSenderLike,
  senderUrl: string,
  frameId: number | undefined,
): string {
  const documentId = validDocumentId(sender.documentId);
  if (documentId) return documentId;
  return [surface, validTabId(sender.tab?.id) ?? 'extension', frameId, senderUrl].join(':');
}

function requiredUrl(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) {
    throwUnauthorized('Runtime sender URL is missing.');
  }
  try {
    return new URL(value).href;
  } catch {
    throwUnauthorized('Runtime sender URL is invalid.');
  }
}

function normalizeOrigin(value: string): string {
  try {
    return readUrlOrigin(new URL(value).href);
  } catch {
    throwUnauthorized('Runtime trust policy contains an invalid origin.');
  }
}

function readUrlOrigin(value: string): string {
  const url = new URL(value);
  if (url.protocol === 'chrome-extension:' || url.protocol === 'moz-extension:') {
    return `${url.protocol}//${url.host}`;
  }
  return url.origin;
}

function validTabId(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) return value;
  throwUnauthorized('Runtime sender tab is invalid.');
}

function validOptionalFrameId(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) return value;
  throwUnauthorized('Runtime sender frame is invalid.');
}

function readDeepSeekChatSessionId(senderUrl: string): string | undefined {
  const match = new URL(senderUrl).pathname.match(/^\/(?:a\/)?chat\/s\/([^/]+)/);
  if (!match) return undefined;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return undefined;
  }
}

function validDocumentId(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'string' && value.length > 0) return value;
  throwUnauthorized('Runtime sender document ID is invalid.');
}

function throwUnauthorized(message: string): never {
  throw new RuntimeBoundaryError(RUNTIME_BOUNDARY_ERROR_CODES.unauthorizedSender, message);
}

export function isPlainRuntimeRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
