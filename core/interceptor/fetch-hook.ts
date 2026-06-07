import { DEEPSEEK_API_URL } from '../constants';
import type { ToolCall, ToolCallRestoreRecord, ToolDescriptor } from '../types';
import { sanitizeInternalPromptText } from '../prompt';
import {
  DEFAULT_TOOL_DESCRIPTORS,
  createToolInvocationCatalog,
  getToolCloseTag,
  getToolOpenTag,
  type ToolInvocationCatalog,
} from '../tool';
import { stripToolCallsFromHistory, stripToolCallsFromIDBResult } from './history-cleanup';
import { extractResponseTextFromParsed, isResponseTextPatchPath, isStreamFinishedFromParsed, isThinkingPatchPath, parseSSEChunk, parseSSEData } from './sse-parser';
import { createResponseTokenSpeedTracker, type ResponseTokenSpeedPayload } from './token-speed';
import { extractToolCalls } from './tool-parser';

const COMPLETION_PATH = new URL(DEEPSEEK_API_URL).pathname;
const REGENERATE_PATH = '/api/v0/chat/regenerate';
const CHAT_STREAM_PATHS = [COMPLETION_PATH, REGENERATE_PATH];
const HISTORY_PATH = '/api/v0/chat/history_messages';
const BYPASS_HOOK_HEADER = 'X-DPP-Bypass-Hook';
const TOKEN_SPEED_EMIT_INTERVAL_MS = 250;
const INITIAL_HOOK_STATE_WAIT_MS = 1_500;
const DEFAULT_APP_VERSION = '2.0.0';
const DEEPSEEK_CLIENT_PLATFORM = 'web';

let originalFetch: typeof window.fetch;
let initialHookStateWaitComplete = false;
let initialHookStateReadyResolved = false;
let resolveInitialHookState: (() => void) | null = null;
const initialHookStateReady = new Promise<void>((resolve) => {
  resolveInitialHookState = resolve;
});

interface HookState {
  toolDescriptors: ToolDescriptor[];
  onRequestBody: (body: string) => Promise<RequestBodyModification | null>;
  onHeadersCaptured: (headers: Record<string, string> | null) => void;
  onToolCall: (call: ToolCall) => void;
  onToolCallsRestored: (records: ToolCallRestoreRecord[]) => void;
  onResponseTokenSpeed: (progress: ResponseTokenSpeedPayload) => void;
  onResponseComplete: (complete: ResponseCompletePayload) => void;
  onMemoriesUsed: (ids: number[]) => void;
}

let hookState: HookState = {
  toolDescriptors: [...DEFAULT_TOOL_DESCRIPTORS],
  onRequestBody: async () => null,
  onHeadersCaptured: () => {},
  onToolCall: () => {},
  onToolCallsRestored: () => {},
  onResponseTokenSpeed: () => {},
  onResponseComplete: () => {},
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

export type { ResponseTokenSpeedPayload } from './token-speed';

interface RequestContext {
  originalPrompt: string;
  agentTaskPrompt: string;
  chatSessionId: string | null;
  parentMessageId: number | null;
  promptOptions: ResponseCompletePayload['promptOptions'];
}

interface RequestContextOverrides {
  originalPrompt?: string;
  agentTaskPrompt?: string;
}

export interface RequestBodyModification {
  body: string;
  agentTaskPrompt: string;
}

function hookFetch() {
  originalFetch = window.fetch;

  window.fetch = async function (input: RequestInfo | URL, init?: RequestInit) {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;

    if (url.includes(HISTORY_PATH)) {
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
    const modified = await hookState.onRequestBody(init.body);
    const requestBody = modified?.body ?? init.body;
    const requestContext = createRequestContext(requestBody, {
      originalPrompt: originalContext.originalPrompt,
      agentTaskPrompt: modified?.agentTaskPrompt ?? originalContext.agentTaskPrompt,
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
        hookState.onHeadersCaptured(captureDeepSeekClientHeaders(xhrHeaders.get(xhr)));
        const originalContext = createRequestContext(body);
        const modified = await hookState.onRequestBody(body);
        const requestBody = modified?.body ?? body;
        setupXHRResponseInterceptor(xhr, createRequestContext(requestBody, {
          originalPrompt: originalContext.originalPrompt,
          agentTaskPrompt: modified?.agentTaskPrompt ?? originalContext.agentTaskPrompt,
        }));
        return origSend.call(xhr, requestBody);
      };
      if (initialHookStateWaitComplete) {
        void sendChatRequest();
        return;
      }
      void waitForInitialHookState().then(sendChatRequest);
      return;
    }
    if (url && url.includes(HISTORY_PATH)) {
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

function createRequestContext(bodyStr: string, overrides: RequestContextOverrides = {}): RequestContext {
  try {
    const body = JSON.parse(bodyStr) as Record<string, unknown>;
    const bodyPrompt = typeof body.prompt === 'string' ? body.prompt : '';
    const originalPrompt = typeof overrides.originalPrompt === 'string'
      ? overrides.originalPrompt
      : typeof body.prompt === 'string'
        ? body.prompt
        : '';
    return {
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
    };
  } catch {
    return {
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
    };
  }
}

function isChatStreamURL(url: string): boolean {
  return CHAT_STREAM_PATHS.some((path) => url.includes(path));
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

function notifyNewToolCalls(
  fullText: string,
  alreadyNotified: number,
  descriptors: readonly ToolDescriptor[] = hookState.toolDescriptors,
): number {
  const calls = extractToolCalls(fullText, { descriptors });
  for (let i = alreadyNotified; i < calls.length; i++) {
    hookState.onToolCall(calls[i]);
  }
  return calls.length;
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

class XmlToolStreamFilter {
  private catalog: ToolInvocationCatalog;
  private toolInvocationNames: string[];
  private toolOpenTags: string[];
  private visiblePrompt: string;
  private state: 'NORMAL' | 'SUPPRESSING' = 'NORMAL';
  private currentTool: string | null = null;
  private pendingText = '';
  private pendingBlocks: Array<{ block: string; isFragmentCreation: boolean; parsed: any }> = [];
  private chunkBuffer = '';
  private encoder = new TextEncoder();

  constructor(descriptors: readonly ToolDescriptor[] = DEFAULT_TOOL_DESCRIPTORS, visiblePrompt: string = '') {
    this.catalog = createToolInvocationCatalog(descriptors);
    this.visiblePrompt = visiblePrompt;
    this.toolInvocationNames = [...this.catalog.invocationNames];
    this.toolOpenTags = this.toolInvocationNames.map(getToolOpenTag);
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
        this.pendingText += text;
        const closeTag = getToolCloseTag(this.currentTool!);
        const closeIdx = this.pendingText.indexOf(closeTag);
        if (closeIdx !== -1) {
          const tailStart = closeIdx + closeTag.length;
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
      const closeTag = getToolCloseTag(found.tool);
      const closeIdx = this.pendingText.indexOf(closeTag, found.idx + getToolOpenTag(found.tool).length);
      const tailStart = closeIdx === -1 ? -1 : closeIdx + closeTag.length;
      const tailOffsetInCurrentText = tailStart - previousPendingLength;

      this.emitBlocksBeforeOpen(controller, found.idx);
      this.pendingBlocks = [];

      if (closeIdx === -1) {
        this.state = 'SUPPRESSING';
        this.currentTool = found.tool;
        this.pendingText = this.pendingText.slice(found.idx);
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

  private findFirstToolOpen(text: string): { idx: number; tool: string } | null {
    let best: { idx: number; tool: string } | null = null;
    for (const tool of this.toolInvocationNames) {
      const open = getToolOpenTag(tool);
      const idx = text.indexOf(open);
      if (idx >= 0 && (best === null || idx < best.idx)) {
        best = { idx, tool };
      }
    }
    return best;
  }

  private couldBePartialToolOpen(text: string): boolean {
    for (const open of this.toolOpenTags) {
      const maxLen = Math.min(text.length, open.length - 1);
      for (let len = maxLen; len > 0; len--) {
        if (open.startsWith(text.slice(-len))) {
          return true;
        }
      }
    }
    return false;
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

async function interceptFetchResponse(
  responsePromise: Promise<Response>,
  requestContext: RequestContext,
): Promise<Response> {
  const response = await responsePromise;
  if (!response.body) return response;

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const toolDescriptors = hookState.toolDescriptors;
  const filter = new XmlToolStreamFilter(toolDescriptors, requestContext.originalPrompt);
  let fullText = '';
  let notifiedCount = 0;
  let textAccBuffer = '';
  let assistantMessageId: number | null = null;
  const speedTracker = createResponseTokenSpeedTracker(
    hookState.onResponseTokenSpeed,
    TOKEN_SPEED_EMIT_INTERVAL_MS,
  );

  const processForFullText = (text: string) => {
    textAccBuffer += text;
    const lastBoundary = textAccBuffer.lastIndexOf('\n\n');
    if (lastBoundary === -1) return;
    const completePart = textAccBuffer.slice(0, lastBoundary + 2);
    textAccBuffer = textAccBuffer.slice(lastBoundary + 2);

    const events = parseSSEChunk(completePart);
    for (const event of events) {
      const parsed = parseSSEData(event.data);
      if (!parsed) continue;
      const eventText = extractCleanResponseTextForParsing(parsed);
      if (eventText) {
        fullText += eventText;
        speedTracker.append(eventText);
        notifiedCount = notifyNewToolCalls(fullText, notifiedCount, toolDescriptors);
      } else if (isThinkingPatchPath((parsed as any)?.p) && typeof (parsed as any)?.v === 'string') {
        speedTracker.append((parsed as any).v);
      }
      if (isStreamFinishedFromParsed(parsed)) {
        speedTracker.finish();
      }
      assistantMessageId = collectAssistantMessageId(parsed, assistantMessageId);
    }
  };

  let cancelled = false;

  const stream = new ReadableStream({
    async start(controller) {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            // Drain any remaining buffered events for fullText
            if (textAccBuffer.trim()) {
              const events = parseSSEChunk(textAccBuffer);
              for (const event of events) {
                const parsed = parseSSEData(event.data);
                if (!parsed) continue;
                const eventText = extractCleanResponseTextForParsing(parsed);
                if (eventText) {
                  fullText += eventText;
                  speedTracker.append(eventText);
                  notifiedCount = notifyNewToolCalls(fullText, notifiedCount, toolDescriptors);
                } else if (isThinkingPatchPath((parsed as any)?.p) && typeof (parsed as any)?.v === 'string') {
                  speedTracker.append((parsed as any).v);
                }
                assistantMessageId = collectAssistantMessageId(parsed, assistantMessageId);
              }
              textAccBuffer = '';
            }
            filter.flush(controller);
            break;
          }

          const chunk = decoder.decode(value, { stream: true });
          processForFullText(chunk);
          filter.processChunk(chunk, controller);
        }
      } finally {
        speedTracker.finish();
      }

      if (cancelled) return;

      // Stream ended — execute any detected tool calls
      try {
        const calls = extractToolCalls(fullText, { descriptors: toolDescriptors });
        if (calls.length > 0) {
          for (const call of calls.slice(notifiedCount)) {
            if (cancelled) break;
            hookState.onToolCall(call);
          }
        }

        if (!cancelled) {
          hookState.onResponseComplete({
            text: fullText,
            originalPrompt: requestContext.originalPrompt,
            agentTaskPrompt: requestContext.agentTaskPrompt,
            chatSessionId: requestContext.chatSessionId,
            parentMessageId: requestContext.parentMessageId,
            assistantMessageId,
            promptOptions: requestContext.promptOptions,
          });
        }
      } finally {
        if (!cancelled) controller.close();
      }
    },
    cancel() {
      cancelled = true;
      speedTracker.finish();
      reader.cancel().catch(() => {});
    },
  });

  return new Response(stream, {
    headers: response.headers,
    status: response.status,
    statusText: response.statusText,
  });
}

function setupXHRResponseInterceptor(xhr: XMLHttpRequest, requestContext: RequestContext) {
  let fullText = '';
  let lastLen = 0;
  let notifiedCount = 0;
  let completed = false;
  let filteredResponse = '';
  let assistantMessageId: number | null = null;
  const toolDescriptors = hookState.toolDescriptors;
  const filter = new XmlToolStreamFilter(toolDescriptors, requestContext.originalPrompt);
  const speedTracker = createResponseTokenSpeedTracker(
    hookState.onResponseTokenSpeed,
    TOKEN_SPEED_EMIT_INTERVAL_MS,
  );

  const finalizeIfNeeded = () => {
    if (completed) return;
    completed = true;
    notifiedCount = notifyNewToolCalls(fullText, notifiedCount, toolDescriptors);
    speedTracker.finish();
    hookState.onResponseComplete({
      text: fullText,
      originalPrompt: requestContext.originalPrompt,
      agentTaskPrompt: requestContext.agentTaskPrompt,
      chatSessionId: requestContext.chatSessionId,
      parentMessageId: requestContext.parentMessageId,
      assistantMessageId,
      promptOptions: requestContext.promptOptions,
    });
  };

  const origResponseTextDesc = Object.getOwnPropertyDescriptor(XMLHttpRequest.prototype, 'responseText') ||
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(XMLHttpRequest.prototype), 'responseText');

  // Create a fake controller that accumulates filtered text
  const fakeController = {
    enqueue(data: Uint8Array) {
      filteredResponse += new TextDecoder().decode(data);
    },
  } as unknown as ReadableStreamDefaultController<Uint8Array>;

  xhr.addEventListener('readystatechange', function () {
    if (xhr.readyState === 3 || xhr.readyState === 4) {
      const raw = origResponseTextDesc?.get?.call(xhr) || '';
      const newData = raw.slice(lastLen);
      lastLen = raw.length;
      if (newData) {
        // Track full text
        const events = parseSSEChunk(newData);
        for (const event of events) {
          const parsed = parseSSEData(event.data);
          if (!parsed) continue;
          const text = extractCleanResponseTextForParsing(parsed);
          if (text) {
            fullText += text;
            speedTracker.append(text);
            notifiedCount = notifyNewToolCalls(fullText, notifiedCount, toolDescriptors);
          }
          if (isStreamFinishedFromParsed(parsed)) {
            speedTracker.finish();
          }
          assistantMessageId = collectAssistantMessageId(parsed, assistantMessageId);
        }
        // Filter for frontend
        filter.processChunk(newData, fakeController);
      }
    }
    if (xhr.readyState === 4) {
      filter.flush(fakeController);
      finalizeIfNeeded();
    }
  });

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
      return xhr.response;
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
