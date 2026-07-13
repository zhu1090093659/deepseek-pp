import {
  DEEPSEEK_BYPASS_HOOK_HEADER,
  isDeepSeekChatStreamUrl,
  isDeepSeekHistoryUrl,
} from '../deepseek/contracts';
import type { ToolCall, ToolCallRestoreRecord, ToolCallSource, ToolDescriptor } from '../types';
import { isInlineAgentContinuationRequest } from '../inline-agent/prompt';
import { sanitizeInternalPromptText } from '../prompt';
import {
  DEFAULT_TOOL_DESCRIPTORS,
  createToolInvocationCatalog,
} from '../tool';
import {
  findFirstXmlToolTag,
  getPartialXmlToolTagTailLength,
} from '../tool/xml-tags';
import { stripToolCallsFromHistory, stripToolCallsFromIDBResult } from './history-cleanup';
import {
  extractResponseTextForTokenSpeed,
  extractResponseTextFromParsed,
  extractResponseUsageStatsFromParsed,
  isResponseTextPatchPath,
  isStreamFinishedFromParsed,
  parseSSEChunk,
  parseSSEData,
} from './sse-parser';
import { createResponseTokenSpeedTracker, type ResponseTokenSpeedPayload } from './token-speed';
import { createStreamingToolTextAccumulator } from './streaming-tool-text';
import { createStreamingToolCallParser, type ToolCallPayloadChunk } from './streaming-tool-call-parser';
import { extractToolCalls } from './tool-parser';

const BYPASS_HOOK_HEADER = DEEPSEEK_BYPASS_HOOK_HEADER;
const TOKEN_SPEED_EMIT_INTERVAL_MS = 250;
const INITIAL_HOOK_STATE_WAIT_MS = 1_500;
const DEFAULT_APP_VERSION = '2.0.0';
const DEEPSEEK_CLIENT_PLATFORM = 'web';
const RESPONSE_TOOL_FALLBACK_PARSE_MAX_CHARS = 120_000;

let originalFetch: typeof window.fetch;
let initialHookStateWaitComplete = false;
let initialHookStateReadyResolved = false;
let resolveInitialHookState: (() => void) | null = null;
const initialHookStateReady = new Promise<void>((resolve) => {
  resolveInitialHookState = resolve;
});

interface HookState {
  toolDescriptors: ToolDescriptor[];
  onRequestBody: (body: string, requestId: string) => Promise<RequestBodyModification | null>;
  onHeadersCaptured: (headers: Record<string, string> | null) => void;
  onToolCallStarted: (call: ToolCall) => void;
  onToolCall: (call: ToolCall) => void;
  onToolCallChunk: (chunk: ToolCallPayloadChunk) => void;
  onToolCallsRestored: (records: ToolCallRestoreRecord[]) => void;
  onResponseTokenSpeed: (progress: ResponseTokenSpeedPayload) => void;
  onResponseComplete: (complete: ResponseCompletePayload) => void;
  onRequestTerminal: (terminal: RequestTerminalPayload) => void;
  onMemoriesUsed: (ids: number[]) => void;
}

let hookState: HookState = {
  toolDescriptors: [...DEFAULT_TOOL_DESCRIPTORS],
  onRequestBody: async () => null,
  onHeadersCaptured: () => {},
  onToolCallStarted: () => {},
  onToolCall: () => {},
  onToolCallChunk: () => {},
  onToolCallsRestored: () => {},
  onResponseTokenSpeed: () => {},
  onResponseComplete: () => {},
  onRequestTerminal: () => {},
  onMemoriesUsed: () => {},
};

export function updateHookState(partial: Partial<HookState>) {
  hookState = { ...hookState, ...partial };
  if (Object.prototype.hasOwnProperty.call(partial, 'toolDescriptors')) {
    markInitialHookStateReady();
  }
}

export function installFetchHook() {
  hookFetch();
  hookXHR();
  hookIndexedDB();
}

export interface ResponseCompletePayload {
  requestId: string;
  text: string;
  originalPrompt: string;
  agentTaskPrompt: string;
  chatSessionId: string | null;
  parentMessageId: number | null;
  assistantMessageId: number | null;
  promptOptions: {
    modelType: string | null;
    searchEnabled: boolean;
    thinkingEnabled: boolean;
    refFileIds: string[];
  };
}

export interface RequestTerminalPayload {
  requestId: string;
}

export type { ResponseTokenSpeedPayload } from './token-speed';

export interface RequestContext {
  requestId: string;
  originalPrompt: string;
  agentTaskPrompt: string;
  chatSessionId: string | null;
  parentMessageId: number | null;
  promptOptions: ResponseCompletePayload['promptOptions'];
  suppressPageEvents: boolean;
  toolDescriptors: ToolDescriptor[];
}

interface RequestContextOverrides {
  requestId?: string;
  originalPrompt?: string;
  agentTaskPrompt?: string;
  toolDescriptors?: ToolDescriptor[];
}

export interface RequestBodyModification {
  body: string;
  agentTaskPrompt: string;
  requestId?: string;
  toolDescriptors?: ToolDescriptor[];
}

function hookFetch() {
  originalFetch = window.fetch;

  window.fetch = async function (input: RequestInfo | URL, init?: RequestInit) {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;

    if (isDeepSeekHistoryUrl(url)) {
      return interceptHistoryResponse(originalFetch.call(this, input, init));
    }

    if (!isChatStreamURL(url) || typeof init?.body !== 'string') {
      return originalFetch.call(this, input, init);
    }

    if (hasBypassHookHeader(init.headers)) {
      return originalFetch.call(this, input, { ...init, headers: stripBypassHookHeader(init.headers) });
    }

    await waitForInitialHookState();
    hookState.onHeadersCaptured(captureDeepSeekClientHeaders(init.headers));
    const originalContext = createRequestContext(init.body);
    const fallbackToolDescriptors = [...hookState.toolDescriptors];
    let modified: RequestBodyModification | null;
    try {
      modified = await hookState.onRequestBody(init.body, originalContext.requestId);
    } catch (error) {
      hookState.onRequestTerminal({ requestId: originalContext.requestId });
      throw error;
    }
    const requestBody = modified?.body ?? init.body;
    const requestContext = createRequestContext(requestBody, {
      requestId: originalContext.requestId,
      ...(modified?.requestId ? { requestId: modified.requestId } : {}),
      originalPrompt: originalContext.originalPrompt,
      agentTaskPrompt: modified?.agentTaskPrompt ?? originalContext.agentTaskPrompt,
      toolDescriptors: modified?.toolDescriptors ?? fallbackToolDescriptors,
    });
    const requestInit = modified ? { ...init, body: modified.body } : init;
    return interceptFetchResponse(originalFetch.call(this, input, requestInit), requestContext);
  };
}

function hookXHR() {
  const xhrUrls = new WeakMap<XMLHttpRequest, string>();
  const xhrHeaders = new WeakMap<XMLHttpRequest, Record<string, string>>();
  const origOpen = XMLHttpRequest.prototype.open;
  const origSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;
  const origSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method: string, url: string | URL, ...rest: any[]) {
    xhrUrls.set(this, typeof url === 'string' ? url : url.href);
    xhrHeaders.set(this, {});
    return origOpen.apply(this, [method, url, ...rest] as any);
  };

  XMLHttpRequest.prototype.setRequestHeader = function (name: string, value: string) {
    const headers = xhrHeaders.get(this);
    if (headers) headers[name] = value;
    return origSetRequestHeader.call(this, name, value);
  };

  XMLHttpRequest.prototype.send = function (body?: Document | XMLHttpRequestBodyInit | null) {
    const url = xhrUrls.get(this);
    if (url && isChatStreamURL(url) && typeof body === 'string') {
      const xhr = this;
      const sendChatRequest = async () => {
        const originalContext = createRequestContext(body);
        try {
          hookState.onHeadersCaptured(captureDeepSeekClientHeaders(xhrHeaders.get(xhr)));
          const fallbackToolDescriptors = [...hookState.toolDescriptors];
          const modified = await hookState.onRequestBody(body, originalContext.requestId);
          const requestBody = modified?.body ?? body;
          setupXHRResponseInterceptor(xhr, createRequestContext(requestBody, {
            requestId: originalContext.requestId,
            ...(modified?.requestId ? { requestId: modified.requestId } : {}),
            originalPrompt: originalContext.originalPrompt,
            agentTaskPrompt: modified?.agentTaskPrompt ?? originalContext.agentTaskPrompt,
            toolDescriptors: modified?.toolDescriptors ?? fallbackToolDescriptors,
          }));
          return origSend.call(xhr, requestBody);
        } catch (error) {
          hookState.onRequestTerminal({ requestId: originalContext.requestId });
          throw error;
        }
      };
      const reportSendFailure = (error: unknown) => {
        console.error('[DeepSeek++] intercepted XHR request failed', error);
      };
      if (initialHookStateWaitComplete) {
        void sendChatRequest().catch(reportSendFailure);
        return;
      }
      void waitForInitialHookState().then(sendChatRequest).catch(reportSendFailure);
      return;
    }
    if (url && isDeepSeekHistoryUrl(url)) {
      setupXHRHistoryInterceptor(this);
    }
    return origSend.call(this, body);
  };
}

function captureDeepSeekClientHeaders(headersInit: HeadersInit | undefined): Record<string, string> | null {
  const headers = normalizeHeaders(headersInit);
  if (!headers) return null;

  const authorization = headers.get('authorization');
  if (!authorization) return null;

  return {
    Authorization: authorization,
    'X-App-Version': headers.get('x-app-version') || DEFAULT_APP_VERSION,
    'x-client-platform': headers.get('x-client-platform') || DEEPSEEK_CLIENT_PLATFORM,
    'x-client-version': headers.get('x-client-version') || DEFAULT_APP_VERSION,
    'x-client-locale': headers.get('x-client-locale') || getDeepSeekLocale(),
    'x-client-timezone-offset': headers.get('x-client-timezone-offset') || String(-new Date().getTimezoneOffset() * 60),
  };
}

function normalizeHeaders(headersInit: HeadersInit | undefined): Headers | null {
  if (!headersInit) return null;
  try {
    return new Headers(headersInit);
  } catch {
    return null;
  }
}

function getDeepSeekLocale(): string {
  return document.documentElement.lang || navigator.language || 'en-US';
}

function markInitialHookStateReady() {
  initialHookStateWaitComplete = true;
  if (!initialHookStateReadyResolved) {
    initialHookStateReadyResolved = true;
    resolveInitialHookState?.();
  }
}

async function waitForInitialHookState(): Promise<void> {
  if (initialHookStateWaitComplete) return;

  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    initialHookStateReady,
    new Promise<void>((resolve) => {
      timeoutId = setTimeout(resolve, INITIAL_HOOK_STATE_WAIT_MS);
    }),
  ]);
  if (timeoutId) clearTimeout(timeoutId);
  initialHookStateWaitComplete = true;
}

export function createRequestContext(bodyStr: string, overrides: RequestContextOverrides = {}): RequestContext {
  const requestId = overrides.requestId ?? crypto.randomUUID();
  try {
    const body = JSON.parse(bodyStr) as Record<string, unknown>;
    const bodyPrompt = typeof body.prompt === 'string' ? body.prompt : '';
    const originalPrompt = typeof overrides.originalPrompt === 'string'
      ? overrides.originalPrompt
      : typeof body.prompt === 'string'
        ? body.prompt
        : '';
    return {
      requestId,
      originalPrompt,
      agentTaskPrompt: overrides.agentTaskPrompt ?? bodyPrompt,
      chatSessionId: typeof body.chat_session_id === 'string' ? body.chat_session_id : null,
      parentMessageId: normalizeMessageId(body.parent_message_id),
      promptOptions: {
        modelType: typeof body.model_type === 'string' ? body.model_type : null,
        searchEnabled: body.search_enabled === true,
        thinkingEnabled: body.thinking_enabled === true,
        refFileIds: Array.isArray(body.ref_file_ids) ? body.ref_file_ids.filter((item): item is string => typeof item === 'string') : [],
      },
      suppressPageEvents: isInlineAgentContinuationRequest(originalPrompt, overrides.agentTaskPrompt ?? bodyPrompt),
      toolDescriptors: overrides.toolDescriptors ?? [...hookState.toolDescriptors],
    };
  } catch {
    return {
      requestId,
      originalPrompt: overrides.originalPrompt ?? '',
      agentTaskPrompt: overrides.agentTaskPrompt ?? overrides.originalPrompt ?? '',
      chatSessionId: null,
      parentMessageId: null,
      promptOptions: {
        modelType: null,
        searchEnabled: false,
        thinkingEnabled: false,
        refFileIds: [],
      },
      suppressPageEvents: isInlineAgentContinuationRequest(overrides.originalPrompt ?? '', overrides.agentTaskPrompt ?? ''),
      toolDescriptors: overrides.toolDescriptors ?? [...hookState.toolDescriptors],
    };
  }
}

function isChatStreamURL(url: string): boolean {
  return isDeepSeekChatStreamUrl(url);
}

function hasBypassHookHeader(headers: HeadersInit | undefined): boolean {
  if (!headers) return false;
  return new Headers(headers).has(BYPASS_HOOK_HEADER);
}

function stripBypassHookHeader(headers: HeadersInit | undefined): HeadersInit | undefined {
  if (!headers) return headers;
  const next = new Headers(headers);
  next.delete(BYPASS_HOOK_HEADER);
  return next;
}

function normalizeMessageId(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function createStreamingResponseToolState(
  descriptors: readonly ToolDescriptor[],
  getSource: () => ToolCallSource,
  options: { suppressEvents?: boolean } = {},
) {
  // Internal inline-agent continuation requests suppress all page-facing
  // events, so the streaming tool parsers' output is never consumed (the
  // suppressed path returns before reading getVisibleText). Skip building and
  // feeding the accumulators/parsers entirely.
  if (options.suppressEvents) {
    return {
      append() {},
      finish() {},
      getVisibleText() { return ''; },
    };
  }

  const toolText = createStreamingToolTextAccumulator(descriptors);
  const toolCalls = createStreamingToolCallParser(descriptors);
  const notifiedToolSignatures = new Set<string>();
  let fallbackText = '';
  let fallbackTextTruncated = false;
  let legacyCallIndex = 0;

  const emitStarted = (call: ToolCall) => {
    const callWithSource = { ...call, source: getSource() };
    if (shouldRenderStreamingToolStart(callWithSource)) {
      hookState.onToolCallStarted(callWithSource);
    }
  };

  const emitCompleted = (call: ToolCall) => {
    const callWithSource = { ...call, source: getSource() };
    notifiedToolSignatures.add(createToolCallNotificationSignature(callWithSource));
    hookState.onToolCall(callWithSource);
  };

  const emitChunk = (chunk: ToolCallPayloadChunk) => {
    hookState.onToolCallChunk({ ...chunk, requestId: getSource().requestId });
  };

  return {
    append(text: string) {
      toolText.append(text);
      appendFallbackText(text);
      const event = toolCalls.append(text);
      event.started.forEach(emitStarted);
      event.streamed.forEach(emitChunk);
      event.completed.forEach(emitCompleted);
    },
    finish() {
      toolText.flush();
      toolCalls.flush();
      notifyLegacyFallbackToolCalls();
    },
    getVisibleText() {
      return toolText.getVisibleText();
    },
  };

  function appendFallbackText(text: string) {
    if (fallbackTextTruncated) return;
    if (fallbackText.length + text.length > RESPONSE_TOOL_FALLBACK_PARSE_MAX_CHARS) {
      fallbackTextTruncated = true;
      fallbackText = '';
      return;
    }
    fallbackText += text;
  }

  function notifyLegacyFallbackToolCalls() {
    if (fallbackTextTruncated || !fallbackText.includes('｜DSML｜')) return;
    for (const call of extractToolCalls(fallbackText, { descriptors })) {
      const source = getSource();
      const callWithSource = {
        ...call,
        id: call.id ?? `legacy:${source.requestId ?? 'request'}:${legacyCallIndex++}`,
        source,
      };
      const signature = createToolCallNotificationSignature(callWithSource);
      if (notifiedToolSignatures.has(signature)) continue;
      notifiedToolSignatures.add(signature);
      hookState.onToolCall(callWithSource);
    }
  }
}

function shouldRenderStreamingToolStart(call: ToolCall): boolean {
  return call.name === 'artifact_create' || call.name === 'artifact_bundle_create';
}

function createToolCallNotificationSignature(call: ToolCall): string {
  return call.id
    ? `id:${call.id}`
    : `${call.provider?.id ?? ''}:${call.name}:${call.invocationName ?? ''}:${call.raw}`;
}

function createManualChatToolCallSource(
  requestContext: RequestContext,
  assistantMessageId: number | null,
): ToolCallSource {
  return {
    trigger: 'manual_chat',
    requestId: requestContext.requestId,
    chatSessionId: requestContext.chatSessionId,
    parentMessageId: requestContext.parentMessageId,
    messageId: assistantMessageId,
  };
}

// --- SSE stream interception: strip XML tool-call blocks from text events ---

function isBatchPatch(parsed: any): boolean {
  return parsed?.o === 'BATCH' && Array.isArray(parsed.v);
}

function isFragmentCreationPatch(parsed: any): boolean {
  return parsed?.p === 'response/fragments' && parsed.o === 'APPEND' && Array.isArray(parsed.v);
}

function getDirectPatchText(parsed: any): string | null {
  if (!parsed?.p && typeof parsed?.v === 'string') return parsed.v;
  if (isResponseTextPatchPath(parsed?.p) && parsed.o === 'APPEND' && typeof parsed.v === 'string') return parsed.v;
  if (isResponseTextPatchPath(parsed?.p) && typeof parsed.v === 'string' && !parsed.o) {
    return parsed.v;
  }
  if (isFragmentCreationPatch(parsed)) {
    const parts: string[] = [];
    for (const frag of parsed.v) {
      if (frag && typeof frag.content === 'string') parts.push(frag.content);
      else if (frag && typeof frag.text === 'string') parts.push(frag.text);
    }
    return parts.length > 0 ? parts.join('') : null;
  }
  return null;
}

function setDirectPatchText(parsed: any, value: string) {
  if (!parsed?.p && typeof parsed?.v === 'string') {
    parsed.v = value;
    return;
  }
  if (isResponseTextPatchPath(parsed?.p) && parsed.o === 'APPEND' && typeof parsed.v === 'string') {
    parsed.v = value;
    return;
  }
  if (isResponseTextPatchPath(parsed?.p) && typeof parsed.v === 'string' && !parsed.o) {
    parsed.v = value;
    return;
  }
  if (isFragmentCreationPatch(parsed)) {
    let remaining = value;
    for (let i = 0; i < parsed.v.length; i++) {
      const frag = parsed.v[i];
      if (!frag) continue;
      if (typeof frag.content === 'string') {
        if (i === parsed.v.length - 1) {
          frag.content = remaining;
        } else {
          const portion = remaining.slice(0, frag.content.length);
          remaining = remaining.slice(frag.content.length);
          frag.content = portion;
        }
      } else if (typeof frag.text === 'string') {
        if (i === parsed.v.length - 1) {
          frag.text = remaining;
        } else {
          const portion = remaining.slice(0, frag.text.length);
          remaining = remaining.slice(frag.text.length);
          frag.text = portion;
        }
      }
    }
  }
}

function shouldEmitSanitizedTextPatch(parsed: any): boolean {
  return isBatchPatch(parsed) || isFragmentCreationPatch(parsed);
}

function isAnyFragmentCreationPatch(parsed: any): boolean {
  return typeof parsed?.p === 'string' &&
    parsed.p.endsWith('/fragments') &&
    parsed.o === 'APPEND' &&
    Array.isArray(parsed.v);
}

function isResponsePatch(parsed: any): boolean {
  if (!parsed || typeof parsed !== 'object') return false;
  if (!parsed.p) return true;
  return typeof parsed.p === 'string' && (parsed.p === 'response' || parsed.p.startsWith('response/'));
}

function getAnyDirectPatchText(parsed: any): string | null {
  if (!parsed?.p && typeof parsed?.v === 'string') return parsed.v;
  if (parsed?.p && parsed.o === 'APPEND' && typeof parsed.v === 'string') return parsed.v;
  if (typeof parsed?.p === 'string' && typeof parsed.v === 'string' && !parsed.o) {
    const lastSegment = parsed.p.split('/').pop();
    if (lastSegment === 'content' || lastSegment === 'text' || lastSegment === 'markdown' || lastSegment === 'delta') {
      return parsed.v;
    }
  }
  if (isAnyFragmentCreationPatch(parsed)) {
    const parts: string[] = [];
    for (const frag of parsed.v) {
      if (frag && typeof frag.content === 'string') parts.push(frag.content);
      else if (frag && typeof frag.text === 'string') parts.push(frag.text);
    }
    return parts.length > 0 ? parts.join('') : null;
  }
  return null;
}

function setAnyDirectPatchText(parsed: any, value: string) {
  if (!parsed?.p && typeof parsed?.v === 'string') {
    parsed.v = value;
    return;
  }
  if (parsed?.p && parsed.o === 'APPEND' && typeof parsed.v === 'string') {
    parsed.v = value;
    return;
  }
  if (typeof parsed?.p === 'string' && typeof parsed.v === 'string' && !parsed.o) {
    parsed.v = value;
    return;
  }
  if (isAnyFragmentCreationPatch(parsed)) {
    let remaining = value;
    for (let i = 0; i < parsed.v.length; i++) {
      const frag = parsed.v[i];
      if (!frag) continue;
      if (typeof frag.content === 'string') {
        if (i === parsed.v.length - 1) {
          frag.content = remaining;
        } else {
          const portion = remaining.slice(0, frag.content.length);
          remaining = remaining.slice(frag.content.length);
          frag.content = portion;
        }
      } else if (typeof frag.text === 'string') {
        if (i === parsed.v.length - 1) {
          frag.text = remaining;
        } else {
          const portion = remaining.slice(0, frag.text.length);
          remaining = remaining.slice(frag.text.length);
          frag.text = portion;
        }
      }
    }
  }
}

function cloneParsedWithSanitizedInternalPrompt(parsed: any, visiblePrompt: string): any | null {
  const cloned = JSON.parse(JSON.stringify(parsed));
  let changed = false;

  const apply = (node: any) => {
    if (!node || typeof node !== 'object') return;

    if (isBatchPatch(node)) {
      for (const item of node.v) {
        apply(item);
      }
      return;
    }

    const text = getAnyDirectPatchText(node);
    if (text === null) return;

    const isResponseText = isResponsePatch(node);
    const sanitized = sanitizeInternalPromptText(text, isResponseText ? undefined : visiblePrompt);
    if (sanitized === text) return;

    setAnyDirectPatchText(node, isResponseText ? '' : sanitized);
    changed = true;
  };

  apply(cloned);

  return changed ? cloned : null;
}

function extractCleanResponseTextForParsing(parsed: unknown): string | null {
  const text = extractResponseTextFromParsed(parsed);
  if (!text) return text;

  const sanitized = sanitizeInternalPromptText(text);
  return sanitized === text ? text : '';
}

function collectAssistantMessageId(parsed: unknown, current: number | null): number | null {
  if (!parsed || typeof parsed !== 'object') return current;
  const value = parsed as Record<string, unknown>;
  const direct = normalizeMessageId(value.response_message_id) ?? normalizeMessageId(value.responseMessageId);
  if (direct !== null) return direct;

  if (typeof value.p === 'string' && value.p.includes('response_message_id')) {
    const id = normalizeMessageId(value.v);
    if (id !== null) return id;
  }

  if (value.o === 'BATCH' && Array.isArray(value.v)) {
    return value.v.reduce((next, item) => collectAssistantMessageId(item, next), current);
  }

  if (Array.isArray(value.v)) {
    return value.v.reduce((next, item) => collectAssistantMessageId(item, next), current);
  }

  if (value.v && typeof value.v === 'object') {
    return collectAssistantMessageId(value.v, current);
  }

  return current;
}

function cloneParsedWithTextPrefix(parsed: any, keepChars: number): any | null {
  const cloned = JSON.parse(JSON.stringify(parsed));
  let remaining = Math.max(0, keepChars);
  let touchedText = false;

  const apply = (node: any) => {
    if (!node || typeof node !== 'object') return;

    if (isBatchPatch(node)) {
      for (const item of node.v) {
        apply(item);
      }
      return;
    }

    const text = getDirectPatchText(node);
    if (text === null) return;

    touchedText = true;
    const nextText = remaining > 0 ? text.slice(0, remaining) : '';
    remaining = Math.max(0, remaining - text.length);
    setDirectPatchText(node, nextText);
  };

  apply(cloned);

  if (!touchedText) return null;
  if (keepChars <= 0 && !shouldEmitSanitizedTextPatch(cloned)) return null;
  return cloned;
}

function cloneParsedWithTextSuffix(parsed: any, skipChars: number): any | null {
  const cloned = JSON.parse(JSON.stringify(parsed));
  let remainingSkip = Math.max(0, skipChars);
  let touchedText = false;
  let keptText = false;

  const apply = (node: any) => {
    if (!node || typeof node !== 'object') return;

    if (isBatchPatch(node)) {
      for (const item of node.v) {
        apply(item);
      }
      return;
    }

    const text = getDirectPatchText(node);
    if (text === null) return;

    touchedText = true;
    if (remainingSkip >= text.length) {
      remainingSkip -= text.length;
      setDirectPatchText(node, '');
      return;
    }

    const nextText = text.slice(remainingSkip);
    remainingSkip = 0;
    if (nextText.length > 0) keptText = true;
    setDirectPatchText(node, nextText);
  };

  apply(cloned);

  if (!touchedText || !keptText) return null;
  return cloned;
}

export class XmlToolStreamFilter {
  private toolInvocationNameSet: ReadonlySet<string>;
  private visiblePrompt: string;
  private state: 'NORMAL' | 'SUPPRESSING' = 'NORMAL';
  private currentTool: string | null = null;
  private pendingText = '';
  private pendingBlocks: Array<{ block: string; isFragmentCreation: boolean; parsed: any }> = [];
  private chunkBuffer = '';
  private encoder = new TextEncoder();

  constructor(descriptors: readonly ToolDescriptor[] = DEFAULT_TOOL_DESCRIPTORS, visiblePrompt: string = '') {
    this.visiblePrompt = visiblePrompt;
    this.toolInvocationNameSet = new Set(createToolInvocationCatalog(descriptors).invocationNames);
  }

  processChunk(chunk: string, controller: ReadableStreamDefaultController<Uint8Array>) {
    this.chunkBuffer += chunk;

    // Find last complete event boundary
    const lastBoundary = this.chunkBuffer.lastIndexOf('\n\n');
    if (lastBoundary === -1) {
      // No complete events yet — buffer until we have one
      return;
    }

    // Extract complete events; keep partial remainder for next chunk
    const completePart = this.chunkBuffer.slice(0, lastBoundary);
    this.chunkBuffer = this.chunkBuffer.slice(lastBoundary + 2);

    this.processBlocks(completePart, controller);
  }

  private processBlocks(text: string, controller: ReadableStreamDefaultController<Uint8Array>) {
    const blocks = text.split('\n\n');

    for (const block of blocks) {
      if (!block.trim()) continue;

      const dataLine = block.split('\n').find(l => l.startsWith('data:'));
      if (!dataLine) {
        this.emit(controller, block);
        continue;
      }

      const jsonStr = dataLine.slice(5).trim();
      const parsed = parseSSEData(jsonStr);
      if (!parsed) {
        this.emit(controller, block);
        continue;
      }

      const sanitizedParsed = cloneParsedWithSanitizedInternalPrompt(parsed, this.visiblePrompt);
      const effectiveParsed = sanitizedParsed ?? parsed;
      const effectiveBlock = sanitizedParsed ? 'data: ' + JSON.stringify(sanitizedParsed) : block;
      const text = extractResponseTextFromParsed(effectiveParsed);
      if (text === null) {
        // Non-response events, including request-message echoes, pass through after prompt cleanup.
        this.emit(controller, effectiveBlock);
        continue;
      }

      // Determine if this event is a "structural" one (fragment creation) that must pass through
      const isFragmentCreation = isFragmentCreationPatch(effectiveParsed);

      // Text event — apply state machine
      if (this.state === 'SUPPRESSING') {
        const previousPendingLength = this.pendingText.length;
        const searchText = this.pendingText + text;
        const closeTag = this.findFirstToolClose(searchText, this.currentTool!);
        if (closeTag) {
          const tailStart = closeTag.endIndex;
          const tailOffsetInCurrentText = tailStart - previousPendingLength;
          const toolTail = this.getCurrentToolTail(effectiveParsed, text, isFragmentCreation, tailOffsetInCurrentText);
          this.state = 'NORMAL';
          this.pendingText = '';
          this.currentTool = null;
          if (toolTail) {
            this.processNormalTextBlock(controller, toolTail.block, toolTail.parsed, toolTail.text, toolTail.isFragmentCreation);
          }
          continue;
        }
        this.pendingText = this.getCloseSearchTail(searchText, this.currentTool!);
        if (isFragmentCreation || isBatchPatch(effectiveParsed)) {
          const modified = cloneParsedWithTextPrefix(effectiveParsed, 0);
          if (modified) {
            this.emit(controller, 'data: ' + JSON.stringify(modified));
          }
        }
        continue;
      }

      // State: NORMAL
      this.processNormalTextBlock(controller, effectiveBlock, effectiveParsed, text, isFragmentCreation);
    }
  }

  private processNormalTextBlock(
    controller: ReadableStreamDefaultController<Uint8Array>,
    block: string,
    parsed: any,
    text: string,
    isFragmentCreation: boolean,
  ) {
    const previousPendingLength = this.pendingText.length;
    this.pendingText += text;
    this.pendingBlocks.push({ block, isFragmentCreation, parsed });

    const found = this.findFirstToolOpen(this.pendingText);
    if (found) {
      const closeTag = this.findFirstToolClose(this.pendingText, found.tool, found.endIndex);
      const tailStart = closeTag ? closeTag.endIndex : -1;
      const tailOffsetInCurrentText = tailStart - previousPendingLength;

      this.emitBlocksBeforeOpen(controller, found.idx);
      this.pendingBlocks = [];

      if (!closeTag) {
        this.state = 'SUPPRESSING';
        this.currentTool = found.tool;
        this.pendingText = this.getCloseSearchTail(this.pendingText.slice(found.idx), found.tool);
        return;
      }

      this.state = 'NORMAL';
      this.currentTool = null;
      this.pendingText = '';
      const toolTail = this.getCurrentToolTail(parsed, text, isFragmentCreation, tailOffsetInCurrentText);
      if (toolTail) {
        this.processNormalTextBlock(controller, toolTail.block, toolTail.parsed, toolTail.text, toolTail.isFragmentCreation);
      }
      return;
    }

    if (this.couldBePartialToolOpen(this.pendingText)) {
      return;
    }

    // Safe — flush all pending
    for (const b of this.pendingBlocks) {
      this.emit(controller, b.block);
    }
    this.pendingBlocks = [];
    this.pendingText = '';
  }

  private getCurrentToolTail(
    parsed: any,
    text: string,
    isFragmentCreation: boolean,
    tailOffsetInCurrentText: number,
  ): { block: string; parsed: any; text: string; isFragmentCreation: boolean } | null {
    if (tailOffsetInCurrentText >= text.length) return null;

    const modified = cloneParsedWithTextSuffix(parsed, Math.max(0, tailOffsetInCurrentText));
    if (!modified) return null;

    const modifiedText = extractResponseTextFromParsed(modified);
    if (!modifiedText) return null;

    return {
      block: 'data: ' + JSON.stringify(modified),
      parsed: modified,
      text: modifiedText,
      isFragmentCreation: isFragmentCreation || isFragmentCreationPatch(modified),
    };
  }

  private getCloseSearchTail(text: string, tool: string): string {
    const tailLength = getPartialXmlToolTagTailLength(text, new Set([tool]), { closing: true });
    return tailLength > 0 ? text.slice(-tailLength) : '';
  }

  flush(controller: ReadableStreamDefaultController<Uint8Array>) {
    // Process any remaining buffered chunk data
    if (this.chunkBuffer.trim()) {
      this.processBlocks(this.chunkBuffer, controller);
      this.chunkBuffer = '';
    }
    // Flush any unsent pending blocks (they were buffered as potential tool start but never confirmed)
    for (const b of this.pendingBlocks) {
      this.emit(controller, b.block);
    }
    this.pendingBlocks = [];
    this.pendingText = '';
  }

  private emit(controller: ReadableStreamDefaultController<Uint8Array>, block: string) {
    controller.enqueue(this.encoder.encode(block + '\n\n'));
  }

  private findFirstToolOpen(text: string): { idx: number; endIndex: number; tool: string } | null {
    const match = findFirstXmlToolTag(text, this.toolInvocationNameSet, { closing: false });
    return match ? { idx: match.index, endIndex: match.endIndex, tool: match.name } : null;
  }

  private findFirstToolClose(text: string, tool: string, fromIndex = 0): { index: number; endIndex: number } | null {
    const match = findFirstXmlToolTag(text, new Set([tool]), { closing: true, fromIndex });
    return match ? { index: match.index, endIndex: match.endIndex } : null;
  }

  private couldBePartialToolOpen(text: string): boolean {
    return getPartialXmlToolTagTailLength(text, this.toolInvocationNameSet, { closing: false }) > 0;
  }

  private emitBlocksBeforeOpen(controller: ReadableStreamDefaultController<Uint8Array>, idx: number) {
    let charsSeen = 0;

    for (const entry of this.pendingBlocks) {
      const text = extractResponseTextFromParsed(entry.parsed);
      if (text === null) {
        this.emit(controller, entry.block);
        continue;
      }
      if (charsSeen + text.length <= idx) {
        this.emit(controller, entry.block);
        charsSeen += text.length;
      } else {
        const keepChars = idx - charsSeen;
        if (keepChars > 0 || entry.isFragmentCreation || isBatchPatch(entry.parsed)) {
          const modified = cloneParsedWithTextPrefix(entry.parsed, keepChars);
          if (modified) {
            this.emit(controller, 'data: ' + JSON.stringify(modified));
          }
        }
        break;
      }
    }
  }
}

function processCompleteSSEBlocks(
  text: string,
  onParsed: (parsed: unknown, event: ReturnType<typeof parseSSEChunk>[number]) => void,
): void {
  const events = parseSSEChunk(text);
  for (const event of events) {
    const parsed = parseSSEData(event.data);
    if (parsed) onParsed(parsed, event);
  }
}

export function createBufferedSSEParser(
  onParsed: (parsed: unknown, event: ReturnType<typeof parseSSEChunk>[number]) => void,
): { append(text: string): void; flush(): void } {
  let buffer = '';

  return {
    append(text: string) {
      buffer += text;
      const lastBoundary = buffer.lastIndexOf('\n\n');
      if (lastBoundary === -1) return;

      const completePart = buffer.slice(0, lastBoundary + 2);
      buffer = buffer.slice(lastBoundary + 2);
      processCompleteSSEBlocks(completePart, onParsed);
    },
    flush() {
      if (buffer.trim()) processCompleteSSEBlocks(buffer, onParsed);
      buffer = '';
    },
  };
}

export async function interceptFetchResponse(
  responsePromise: Promise<Response>,
  requestContext: RequestContext,
): Promise<Response> {
  let terminalSent = false;
  const notifyTerminal = () => {
    if (terminalSent) return;
    terminalSent = true;
    hookState.onRequestTerminal({ requestId: requestContext.requestId });
  };
  let response: Response;
  try {
    response = await responsePromise;
  } catch (error) {
    notifyTerminal();
    throw error;
  }
  if (!response.body) {
    notifyTerminal();
    return response;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const toolDescriptors = requestContext.toolDescriptors;
  const filter = new XmlToolStreamFilter(toolDescriptors, requestContext.originalPrompt);
  let assistantMessageId: number | null = null;
  const responseToolState = createStreamingResponseToolState(
    toolDescriptors,
    () => createManualChatToolCallSource(requestContext, assistantMessageId),
    { suppressEvents: requestContext.suppressPageEvents },
  );
  const speedTracker = createResponseTokenSpeedTracker(
    (progress) => {
      if (!requestContext.suppressPageEvents) {
        hookState.onResponseTokenSpeed(
          attachResponseContextToTokenSpeedProgress(progress, requestContext, assistantMessageId),
        );
      }
    },
    TOKEN_SPEED_EMIT_INTERVAL_MS,
  );
  const fullTextParser = createBufferedSSEParser((parsed, event) => {
    assistantMessageId = collectAssistantMessageId(parsed, assistantMessageId);
    speedTracker.updateServerStats(extractResponseUsageStatsFromParsed(parsed, event.type));
    const tokenSpeedText = extractResponseTextForTokenSpeed(parsed);
    if (tokenSpeedText) {
      speedTracker.append(tokenSpeedText);
    }
    const eventText = extractCleanResponseTextForParsing(parsed);
    if (eventText) {
      responseToolState.append(eventText);
    }
    if (isStreamFinishedFromParsed(parsed)) {
      speedTracker.finish();
    }
  });

  let cancelled = false;

  const stream = new ReadableStream({
    async start(controller) {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            fullTextParser.flush();
            filter.flush(controller);
            break;
          }

          const chunk = decoder.decode(value, { stream: true });
          fullTextParser.append(chunk);
          filter.processChunk(chunk, controller);
        }
        if (cancelled) return;
        responseToolState.finish();

        if (!requestContext.suppressPageEvents) {
          hookState.onResponseComplete({
            requestId: requestContext.requestId,
            text: responseToolState.getVisibleText(),
            originalPrompt: requestContext.originalPrompt,
            agentTaskPrompt: requestContext.agentTaskPrompt,
            chatSessionId: requestContext.chatSessionId,
            parentMessageId: requestContext.parentMessageId,
            assistantMessageId,
            promptOptions: requestContext.promptOptions,
          });
        }
        controller.close();
      } finally {
        speedTracker.finish();
        notifyTerminal();
      }
    },
    cancel() {
      cancelled = true;
      speedTracker.finish();
      notifyTerminal();
      reader.cancel().catch(() => {});
    },
  });

  return new Response(stream, {
    headers: response.headers,
    status: response.status,
    statusText: response.statusText,
  });
}

function attachResponseContextToTokenSpeedProgress(
  progress: ResponseTokenSpeedPayload,
  requestContext: RequestContext,
  assistantMessageId: number | null,
): ResponseTokenSpeedPayload {
  return {
    ...progress,
    requestId: requestContext.requestId,
    chatSessionId: requestContext.chatSessionId,
    assistantMessageId,
    modelType: progress.modelType ?? requestContext.promptOptions.modelType,
  };
}

function setupXHRResponseInterceptor(xhr: XMLHttpRequest, requestContext: RequestContext) {
  let lastLen = 0;
  let completed = false;
  let filteredResponse = '';
  let assistantMessageId: number | null = null;
  const toolDescriptors = requestContext.toolDescriptors;
  const filter = new XmlToolStreamFilter(toolDescriptors, requestContext.originalPrompt);
  const responseToolState = createStreamingResponseToolState(
    toolDescriptors,
    () => createManualChatToolCallSource(requestContext, assistantMessageId),
    { suppressEvents: requestContext.suppressPageEvents },
  );
  const speedTracker = createResponseTokenSpeedTracker(
    (progress) => {
      if (!requestContext.suppressPageEvents) {
        hookState.onResponseTokenSpeed(
          attachResponseContextToTokenSpeedProgress(progress, requestContext, assistantMessageId),
        );
      }
    },
    TOKEN_SPEED_EMIT_INTERVAL_MS,
  );

  let terminalSent = false;
  const notifyTerminal = () => {
    if (terminalSent) return;
    terminalSent = true;
    hookState.onRequestTerminal({ requestId: requestContext.requestId });
  };

  const finalizeIfNeeded = () => {
    if (completed) return;
    completed = true;
    responseToolState.finish();
    speedTracker.finish();
    try {
      if (!requestContext.suppressPageEvents) {
        hookState.onResponseComplete({
          requestId: requestContext.requestId,
          text: responseToolState.getVisibleText(),
          originalPrompt: requestContext.originalPrompt,
          agentTaskPrompt: requestContext.agentTaskPrompt,
          chatSessionId: requestContext.chatSessionId,
          parentMessageId: requestContext.parentMessageId,
          assistantMessageId,
          promptOptions: requestContext.promptOptions,
        });
      }
    } finally {
      notifyTerminal();
    }
  };

  const origResponseTextDesc = Object.getOwnPropertyDescriptor(XMLHttpRequest.prototype, 'responseText') ||
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(XMLHttpRequest.prototype), 'responseText');

  // Create a fake controller that accumulates filtered text
  const fakeController = {
    enqueue(data: Uint8Array) {
      filteredResponse += new TextDecoder().decode(data);
    },
  } as unknown as ReadableStreamDefaultController<Uint8Array>;
  const fullTextParser = createBufferedSSEParser((parsed, event) => {
    assistantMessageId = collectAssistantMessageId(parsed, assistantMessageId);
    speedTracker.updateServerStats(extractResponseUsageStatsFromParsed(parsed, event.type));
    const tokenSpeedText = extractResponseTextForTokenSpeed(parsed);
    if (tokenSpeedText) {
      speedTracker.append(tokenSpeedText);
    }
    const text = extractCleanResponseTextForParsing(parsed);
    if (text) {
      responseToolState.append(text);
    }
    if (isStreamFinishedFromParsed(parsed)) {
      speedTracker.finish();
    }
  });

  xhr.addEventListener('readystatechange', function () {
    if (xhr.readyState === 3 || xhr.readyState === 4) {
      const raw = origResponseTextDesc?.get?.call(xhr) || '';
      const newData = raw.slice(lastLen);
      lastLen = raw.length;
      if (newData) {
        fullTextParser.append(newData);
        // Filter for frontend
        filter.processChunk(newData, fakeController);
      }
    }
    if (xhr.readyState === 4) {
      fullTextParser.flush();
      filter.flush(fakeController);
      finalizeIfNeeded();
    }
  });
  xhr.addEventListener('abort', notifyTerminal, { once: true });
  xhr.addEventListener('error', notifyTerminal, { once: true });
  xhr.addEventListener('timeout', notifyTerminal, { once: true });

  Object.defineProperty(xhr, 'responseText', {
    get() { return filteredResponse; },
    configurable: true,
  });
  Object.defineProperty(xhr, 'response', {
    get() {
      if (xhr.responseType === '' || xhr.responseType === 'text') {
        return filteredResponse;
      }
      return undefined;
    },
    configurable: true,
  });
}

// --- History API interception: strip tool-call blocks from saved messages ---

async function interceptHistoryResponse(responsePromise: Promise<Response>): Promise<Response> {
  const response = await responsePromise;
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('json')) return response;

  try {
    const json = await response.json();
    stripToolCallsFromHistory(json, getHistoryCleanupOptions());
    return new Response(JSON.stringify(json), {
      headers: response.headers,
      status: response.status,
      statusText: response.statusText,
    });
  } catch {
    return response;
  }
}

function setupXHRHistoryInterceptor(xhr: XMLHttpRequest) {
  const origResponseTextDesc = Object.getOwnPropertyDescriptor(XMLHttpRequest.prototype, 'responseText') ||
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(XMLHttpRequest.prototype), 'responseText');
  const origResponseDesc = Object.getOwnPropertyDescriptor(XMLHttpRequest.prototype, 'response') ||
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(XMLHttpRequest.prototype), 'response');

  let cachedFiltered: string | null = null;

  Object.defineProperty(xhr, 'responseText', {
    get() {
      const raw = origResponseTextDesc?.get?.call(xhr) || '';
      if (xhr.readyState < 4) return raw;
      if (cachedFiltered !== null) return cachedFiltered;
      try {
        const json = JSON.parse(raw);
        stripToolCallsFromHistory(json, getHistoryCleanupOptions());
        cachedFiltered = JSON.stringify(json);
      } catch {
        cachedFiltered = raw;
      }
      return cachedFiltered;
    },
  });

  // Also override response for XHR response getter
  Object.defineProperty(xhr, 'response', {
    get() {
      if (xhr.responseType === '' || xhr.responseType === 'text') {
        const raw = origResponseTextDesc?.get?.call(xhr) || '';
        if (xhr.readyState < 4) return raw;
        if (cachedFiltered !== null) return cachedFiltered;
        try {
          const json = JSON.parse(raw);
          stripToolCallsFromHistory(json, getHistoryCleanupOptions());
          cachedFiltered = JSON.stringify(json);
        } catch {
          cachedFiltered = raw;
        }
        return cachedFiltered;
      }
      // Non-text response types: read from the native getter. Reading
      // `xhr.response` here would re-enter this overridden getter and overflow
      // the stack.
      return origResponseDesc?.get?.call(xhr);
    },
  });
}

function getHistoryCleanupOptions() {
  return {
    toolDescriptors: hookState.toolDescriptors,
    onToolCallsRestored: hookState.onToolCallsRestored,
  };
}

// --- IndexedDB interception: strip tool-call blocks from cached messages ---

function hookIndexedDB() {
  const origGet = IDBObjectStore.prototype.get;
  const origGetAll = IDBObjectStore.prototype.getAll;

  IDBObjectStore.prototype.get = function (...args) {
    const request = origGet.apply(this, args);
    if (this.name === 'history-message') {
      patchIDBRequest(request);
    }
    return request;
  };

  IDBObjectStore.prototype.getAll = function (...args) {
    const request = origGetAll.apply(this, args);
    if (this.name === 'history-message') {
      patchIDBRequest(request);
    }
    return request;
  };
}

function patchIDBRequest(request: IDBRequest) {
  const origResultDesc = Object.getOwnPropertyDescriptor(IDBRequest.prototype, 'result');
  if (!origResultDesc) return;

  let cleaned = false;

  Object.defineProperty(request, 'result', {
    get() {
      const result = origResultDesc.get!.call(this);
      if (result && !cleaned) {
        cleaned = true;
        stripToolCallsFromIDBResult(result, getHistoryCleanupOptions());
      }
      return result;
    },
  });
}
