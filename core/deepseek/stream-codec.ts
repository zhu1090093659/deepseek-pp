import type { SSEEvent } from '../types';
import { normalizeDeepSeekMessageId } from './request-codec';

export type { SSEEvent } from '../types';

export interface ResponseStreamUsageStats {
  modelType?: string | null;
  insertedAt?: number | null;
  updatedAt?: number | null;
  accumulatedTokenUsage?: number | null;
}

export interface DeepSeekStreamSummary {
  assistantText: string;
  responseMessageId: number | null;
  requestMessageId: number | null;
  finished: boolean;
}

export interface DeepSeekSseByteDecoder {
  push(bytes: Uint8Array): SSEEvent[];
  finish(): SSEEvent[];
}

export interface DeepSeekSseTextDecoder {
  push(text: string): SSEEvent[];
  finish(): SSEEvent[];
}

export interface DeepSeekSseFrame {
  readonly block: string;
  readonly separator: string;
  readonly event: SSEEvent | null;
  readonly parsed: unknown | null;
}

export interface DeepSeekSseFrameDecoder {
  push(text: string): DeepSeekSseFrame[];
  finish(): DeepSeekSseFrame[];
}

export function createDeepSeekStreamSummary(): DeepSeekStreamSummary {
  return {
    assistantText: '',
    responseMessageId: null,
    requestMessageId: null,
    finished: false,
  };
}

export function createDeepSeekSseByteDecoder(): DeepSeekSseByteDecoder {
  const decoder = new TextDecoder();
  const textDecoder = createDeepSeekSseTextDecoder();

  return {
    push(bytes) {
      return textDecoder.push(decoder.decode(bytes, { stream: true }));
    },
    finish() {
      const decoded = decoder.decode();
      const events = decoded ? textDecoder.push(decoded) : [];
      return events.concat(textDecoder.finish());
    },
  };
}

export function createDeepSeekSseTextDecoder(): DeepSeekSseTextDecoder {
  const frameDecoder = createDeepSeekSseFrameDecoder();

  return {
    push(text) {
      return parseSSEFrames(frameDecoder.push(text));
    },
    finish() {
      return parseSSEFrames(frameDecoder.finish());
    },
  };
}

export function createDeepSeekSseFrameDecoder(): DeepSeekSseFrameDecoder {
  let buffer = '';
  let scanFrom = 0;

  const drain = (): DeepSeekSseFrame[] => {
    const frames: DeepSeekSseFrame[] = [];
    const boundaryPattern = /\r?\n\r?\n/g;
    boundaryPattern.lastIndex = scanFrom;
    let offset = 0;
    let match: RegExpExecArray | null;

    while ((match = boundaryPattern.exec(buffer)) !== null) {
      const separator = match[0];
      frames.push(createDeepSeekSseFrame(buffer.slice(offset, match.index), separator));
      offset = match.index + separator.length;
    }

    buffer = buffer.slice(offset);
    scanFrom = Math.max(0, buffer.length - 3);
    return frames;
  };

  return {
    push(text) {
      buffer += text;
      return drain();
    },
    finish() {
      const frames = drain();
      if (buffer) frames.push(createDeepSeekSseFrame(buffer, ''));
      buffer = '';
      scanFrom = 0;
      return frames;
    },
  };
}

export function consumeDeepSeekSseEvents(
  events: readonly SSEEvent[],
  summary: DeepSeekStreamSummary,
  options: {
    retainAssistantText?: boolean;
    onParsed?: (parsed: unknown, event: SSEEvent) => void;
  } = {},
): string {
  const appendedText: string[] = [];

  for (const event of events) {
    const parsed = parseSSEData(event.data);
    if (!parsed) continue;
    consumeParsedDeepSeekSseEvent(parsed, event, summary, options, appendedText);
  }

  return appendedText.join('');
}

export function consumeDeepSeekSseFrames(
  frames: readonly DeepSeekSseFrame[],
  summary: DeepSeekStreamSummary,
  options: {
    retainAssistantText?: boolean;
    onParsed?: (parsed: unknown, event: SSEEvent) => void;
  } = {},
): string {
  const appendedText: string[] = [];
  for (const frame of frames) {
    if (!frame.event || !frame.parsed) continue;
    consumeParsedDeepSeekSseEvent(frame.parsed, frame.event, summary, options, appendedText);
  }
  return appendedText.join('');
}

export function parseSSEChunk(chunk: string): SSEEvent[] {
  const decoder = createDeepSeekSseFrameDecoder();
  return parseSSEFrames(decoder.push(chunk).concat(decoder.finish()));
}

function parseSSEFrames(frames: readonly DeepSeekSseFrame[]): SSEEvent[] {
  const events: SSEEvent[] = [];
  for (const frame of frames) {
    if (frame.event) events.push(frame.event);
  }
  return events;
}

function createDeepSeekSseFrame(block: string, separator: string): DeepSeekSseFrame {
  const event = parseSSEBlock(block);
  let parsedResolved = false;
  let parsed: unknown | null = null;
  return {
    block,
    separator,
    event,
    get parsed() {
      if (!parsedResolved) {
        parsed = event ? parseSSEData(event.data) : null;
        parsedResolved = true;
      }
      return parsed;
    },
  };
}

function parseSSEBlock(block: string): SSEEvent | null {
  if (!block.trim()) return null;

  const event: Partial<SSEEvent> = {};
  for (const line of block.split(/\r\n|\r|\n/)) {
    if (line.startsWith('id:')) {
      event.id = line.slice(3).trim();
    } else if (line.startsWith('event:')) {
      event.type = line.slice(6).trim();
    } else if (line.startsWith('data:')) {
      const data = line.slice(5).trim();
      event.data = event.data != null ? `${event.data}\n${data}` : data;
    }
  }

  if (event.data === undefined) return null;
  return {
    type: event.type ?? 'message',
    data: event.data,
    id: event.id,
  };
}

function consumeParsedDeepSeekSseEvent(
  parsed: unknown,
  event: SSEEvent,
  summary: DeepSeekStreamSummary,
  options: {
    retainAssistantText?: boolean;
    onParsed?: (parsed: unknown, event: SSEEvent) => void;
  },
  appendedText: string[],
): void {
  collectDeepSeekMessageIds(parsed, summary);
  options.onParsed?.(parsed, event);

  const eventText = extractResponseTextFromParsed(parsed);
  if (eventText) {
    appendedText.push(eventText);
    if (options.retainAssistantText !== false) summary.assistantText += eventText;
  }
  if (isStreamFinishedFromParsed(parsed)) summary.finished = true;
}

export function parseSSEData(data: string): unknown | null {
  try {
    return JSON.parse(data);
  } catch {
    return null;
  }
}

export function replaceDeepSeekSseFrameData(
  frame: DeepSeekSseFrame,
  data: string,
): string {
  const parts = frame.block.split(/(\r\n|\r|\n)/);
  let replaced = false;
  let output = '';

  for (let index = 0; index < parts.length; index += 2) {
    const line = parts[index] ?? '';
    const lineEnding = parts[index + 1] ?? '';
    if (!line.startsWith('data:')) {
      output += line + lineEnding;
      continue;
    }
    if (!replaced) {
      output += `data: ${data}${lineEnding}`;
      replaced = true;
    }
  }

  return replaced ? output : frame.block;
}

export function extractResponseUsageStatsFromParsed(
  parsed: unknown,
  eventType?: string,
): ResponseStreamUsageStats | null {
  const stats = collectResponseUsageStats(parsed, eventType);
  return hasResponseUsageStats(stats) ? stats : null;
}

export function isResponseTextPatchPath(path: unknown): path is string {
  return isTextPatchPath(path) && isResponsePatchPath(path);
}

function isTextPatchPath(path: unknown): path is string {
  if (typeof path !== 'string') return false;
  const lastSegment = path.split('/').pop();
  return (
    lastSegment === 'content' ||
    lastSegment === 'text' ||
    lastSegment === 'markdown' ||
    lastSegment === 'delta'
  );
}

function isResponsePatchPath(path: unknown): path is string {
  return typeof path === 'string' && (path === 'response' || path.startsWith('response/'));
}

export function isThinkingPatchPath(path: unknown): path is string {
  if (typeof path !== 'string') return false;
  const lastSegment = path.split('/').pop();
  return lastSegment === 'reasoning_content' || lastSegment === 'thinking_content';
}

export function extractTextFromParsed(parsed: any): string | null {
  if (parsed?.o === 'BATCH' && Array.isArray(parsed.v)) {
    const text = parsed.v
      .map((item: unknown) => extractTextFromParsed(item))
      .filter((part: string | null): part is string => part !== null)
      .join('');
    return text.length > 0 ? text : null;
  }
  // Format 1: {"v":"text"} — shorthand text append (no path)
  if (!parsed.p && typeof parsed.v === 'string') {
    return parsed.v;
  }
  // Format 2: {"p":"...", "o":"APPEND", "v":"text"} — explicit append
  if (parsed.p && parsed.o === 'APPEND' && typeof parsed.v === 'string') {
    return parsed.v;
  }
  // Format 3: {"p":"response/fragments/-1/content", "v":"text"} — text/content patch (no "o" field)
  if (isTextPatchPath(parsed.p) && typeof parsed.v === 'string' && !parsed.o) {
    return parsed.v;
  }
  // Format 4: {"p":"response/fragments", "o":"APPEND", "v":[{content:"text",...}]} — new fragment with initial content
  if (isFragmentsAppendPatch(parsed)) {
    const text = parsed.v
      .map((frag: unknown) => extractFragmentText(frag))
      .filter((part: string | null): part is string => part !== null)
      .join('');
    return text.length > 0 ? text : null;
  }
  return null;
}

export function extractResponseTextFromParsed(parsed: any): string | null {
  if (parsed?.o === 'BATCH' && Array.isArray(parsed.v)) {
    const text = parsed.v
      .map((item: unknown) => extractResponseTextFromParsed(item))
      .filter((part: string | null): part is string => part !== null)
      .join('');
    return text.length > 0 ? text : null;
  }
  if (!parsed.p && typeof parsed.v === 'string') {
    return parsed.v;
  }
  if (isResponseTextPatchPath(parsed.p) && parsed.o === 'APPEND' && typeof parsed.v === 'string') {
    return parsed.v;
  }
  if (isResponseTextPatchPath(parsed.p) && typeof parsed.v === 'string' && !parsed.o) {
    return parsed.v;
  }
  if (isResponseFragmentsAppendPatch(parsed)) {
    const text = parsed.v
      .map((frag: unknown) => extractFragmentText(frag))
      .filter((part: string | null): part is string => part !== null)
      .join('');
    return text.length > 0 ? text : null;
  }
  return null;
}

export function extractResponseTextForTokenSpeed(parsed: unknown): string | null {
  const value = parsed as { o?: unknown; p?: unknown; v?: unknown } | null;
  if (value && typeof value === 'object' && value.o === 'BATCH' && Array.isArray(value.v)) {
    const text = value.v
      .map((item) => extractResponseTextForTokenSpeed(item))
      .filter((part: string | null): part is string => part !== null)
      .join('');
    return text.length > 0 ? text : null;
  }

  const responseText = extractResponseTextFromParsed(parsed as any);
  if (responseText) return responseText;

  if (!value || typeof value !== 'object') return null;

  if (Array.isArray(value.v)) {
    const text = value.v
      .map((item) => extractResponseTextForTokenSpeed(item))
      .filter((part: string | null): part is string => part !== null)
      .join('');
    return text.length > 0 ? text : null;
  }

  if (isThinkingPatchPath(value.p) && typeof value.v === 'string') {
    return value.v;
  }

  return null;
}

function isFragmentsAppendPatch(parsed: any): boolean {
  return typeof parsed?.p === 'string' &&
    parsed.p.endsWith('/fragments') &&
    parsed.o === 'APPEND' &&
    Array.isArray(parsed.v);
}

function isResponseFragmentsAppendPatch(parsed: any): boolean {
  return parsed?.p === 'response/fragments' && parsed.o === 'APPEND' && Array.isArray(parsed.v);
}

function extractFragmentText(fragment: unknown): string | null {
  if (!fragment || typeof fragment !== 'object') return null;
  const value = fragment as Record<string, unknown>;
  if (typeof value.content === 'string') return value.content;
  if (typeof value.text === 'string') return value.text;
  return null;
}

export function isStreamFinishedFromParsed(parsed: any): boolean {
  if (parsed.p === 'response/status' && parsed.v === 'FINISHED') return true;
  if (parsed.o === 'BATCH' && Array.isArray(parsed.v)) {
    return parsed.v.some(
      (item: { p: string; v: string }) => item.p === 'quasi_status' && item.v === 'FINISHED',
    );
  }
  return false;
}

function collectResponseUsageStats(
  parsed: unknown,
  eventType?: string,
): ResponseStreamUsageStats {
  if (!parsed || typeof parsed !== 'object') return {};

  const value = parsed as Record<string, unknown>;
  let stats: ResponseStreamUsageStats = {};

  if (eventType === 'ready' && typeof value.model_type === 'string') {
    stats.modelType = value.model_type;
  }

  if (eventType === 'update_session') {
    stats = mergeResponseUsageStats(stats, {
      updatedAt: readFiniteNumber(value.updated_at),
    });
  }

  if (value.o === 'BATCH' && Array.isArray(value.v)) {
    for (const item of value.v) {
      stats = mergeResponseUsageStats(stats, collectResponseUsageStats(item, eventType));
    }
  }

  if (typeof value.p === 'string') {
    stats = mergeResponseUsageStats(stats, collectPatchUsageStats(value));
  }

  if (value.response && typeof value.response === 'object') {
    stats = mergeResponseUsageStats(stats, collectResponseObjectUsageStats(value.response));
  }

  if (value.v && typeof value.v === 'object' && !Array.isArray(value.v)) {
    stats = mergeResponseUsageStats(stats, collectResponseUsageStats(value.v, eventType));
  }

  return stats;
}

function collectPatchUsageStats(value: Record<string, unknown>): ResponseStreamUsageStats {
  const path = value.p;
  if (typeof path !== 'string') return {};

  if (path === 'response/accumulated_token_usage' || path === 'accumulated_token_usage') {
    return { accumulatedTokenUsage: readNonNegativeNumber(value.v) };
  }
  if (path === 'response/inserted_at' || path === 'inserted_at') {
    return { insertedAt: readFiniteNumber(value.v) };
  }
  if (path === 'response/updated_at' || path === 'updated_at') {
    return { updatedAt: readFiniteNumber(value.v) };
  }
  if ((path === 'response/model_type' || path === 'model_type') && typeof value.v === 'string') {
    return { modelType: value.v };
  }
  if (path === 'response' && value.v && typeof value.v === 'object' && !Array.isArray(value.v)) {
    return collectResponseObjectUsageStats(value.v);
  }
  return {};
}

function collectResponseObjectUsageStats(value: unknown): ResponseStreamUsageStats {
  if (!value || typeof value !== 'object') return {};
  const response = value as Record<string, unknown>;
  const stats: ResponseStreamUsageStats = {};
  const insertedAt = readFiniteNumber(response.inserted_at);
  const accumulatedTokenUsage = readNonNegativeNumber(response.accumulated_token_usage);
  if (insertedAt !== null) stats.insertedAt = insertedAt;
  if (accumulatedTokenUsage !== null) stats.accumulatedTokenUsage = accumulatedTokenUsage;
  if (typeof response.model_type === 'string') {
    stats.modelType = response.model_type;
  }
  return stats;
}

function mergeResponseUsageStats(
  left: ResponseStreamUsageStats,
  right: ResponseStreamUsageStats,
): ResponseStreamUsageStats {
  const merged = { ...left };
  if ('modelType' in right && right.modelType !== null && right.modelType !== undefined) merged.modelType = right.modelType;
  if ('insertedAt' in right && right.insertedAt !== null && right.insertedAt !== undefined) merged.insertedAt = right.insertedAt;
  if ('updatedAt' in right && right.updatedAt !== null && right.updatedAt !== undefined) merged.updatedAt = right.updatedAt;
  if (
    'accumulatedTokenUsage' in right &&
    right.accumulatedTokenUsage !== null &&
    right.accumulatedTokenUsage !== undefined
  ) {
    merged.accumulatedTokenUsage = right.accumulatedTokenUsage;
  }
  return merged;
}

function hasResponseUsageStats(stats: ResponseStreamUsageStats): boolean {
  return stats.modelType !== undefined ||
    stats.insertedAt !== undefined ||
    stats.updatedAt !== undefined ||
    stats.accumulatedTokenUsage !== undefined;
}

function readFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readNonNegativeNumber(value: unknown): number | null {
  const number = readFiniteNumber(value);
  return number !== null && number >= 0 ? number : null;
}

function collectDeepSeekMessageIds(parsed: unknown, summary: DeepSeekStreamSummary): void {
  if (!parsed || typeof parsed !== 'object') return;
  const value = parsed as Record<string, unknown>;

  const responseId = firstMessageId(value.response_message_id, value.responseMessageId);
  if (responseId !== null) summary.responseMessageId = responseId;

  const requestId = firstMessageId(value.request_message_id, value.requestMessageId);
  if (requestId !== null) summary.requestMessageId = requestId;

  if (value.o === 'BATCH' && Array.isArray(value.v)) {
    for (const item of value.v) collectDeepSeekMessageIds(item, summary);
  }

  if (typeof value.p === 'string') {
    if (value.p.includes('response_message_id')) {
      const id = firstMessageId(value.v);
      if (id !== null) summary.responseMessageId = id;
    }
    if (value.p.includes('request_message_id')) {
      const id = firstMessageId(value.v);
      if (id !== null) summary.requestMessageId = id;
    }
  }

  if (Array.isArray(value.v)) {
    for (const item of value.v) collectDeepSeekMessageIds(item, summary);
  } else if (value.v && typeof value.v === 'object') {
    collectDeepSeekMessageIds(value.v, summary);
  }
}

function firstMessageId(...values: unknown[]): number | null {
  for (const value of values) {
    const id = normalizeDeepSeekMessageId(value);
    if (id !== null) return id;
  }
  return null;
}
