import type {
  ConversationExportFailure,
  ExportedAttachmentRef,
  ExportedContentFragment,
  ExportedMessage,
  ExportedMessageRole,
  ExportedSession,
} from './types';

export interface DeepSeekSessionSummary {
  id: string;
  title: string;
  pinned: boolean;
  titleType: string | null;
  modelType: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  raw?: unknown;
}

export interface NormalizeHistoryOptions {
  includeRaw: boolean;
}

export function normalizeDeepSeekSessionSummary(raw: unknown, index: number, includeRaw: boolean): DeepSeekSessionSummary {
  const value = asRecord(raw);
  const id = firstString(value.id, value.chat_session_id, value.chatSessionId);
  if (!id) {
    throw new Error(`DeepSeek session at index ${index} is missing id.`);
  }

  return {
    id,
    title: firstString(value.title, value.name) ?? '未命名对话',
    pinned: Boolean(value.pinned),
    titleType: firstString(value.title_type, value.titleType),
    modelType: firstString(value.model_type, value.modelType),
    createdAt: coerceIsoTimestamp(value.created_at, value.createdAt, value.inserted_at),
    updatedAt: coerceIsoTimestamp(value.updated_at, value.updatedAt),
    ...(includeRaw ? { raw } : {}),
  };
}

export function normalizeDeepSeekHistory(
  summary: DeepSeekSessionSummary,
  rawHistory: unknown,
  options: NormalizeHistoryOptions,
): ExportedSession {
  const history = asRecord(rawHistory);
  const bizData = extractBizData(history);
  const rawMessages = extractMessages(bizData);
  if (!rawMessages) {
    throw new Error(`DeepSeek history for session ${summary.id} did not include chat_messages.`);
  }

  const failures: ConversationExportFailure[] = [];
  const messages = rawMessages.map((message, index) =>
    normalizeMessage(summary.id, message, index, options.includeRaw, failures)
  );

  const sessionFromHistory = asRecord(bizData.chat_session);
  return {
    ...summary,
    title: firstString(sessionFromHistory.title) ?? summary.title,
    pinned: typeof sessionFromHistory.pinned === 'boolean' ? sessionFromHistory.pinned : summary.pinned,
    titleType: firstString(sessionFromHistory.title_type, sessionFromHistory.titleType) ?? summary.titleType,
    modelType: firstString(sessionFromHistory.model_type, sessionFromHistory.modelType) ?? summary.modelType,
    createdAt: coerceIsoTimestamp(sessionFromHistory.created_at, sessionFromHistory.createdAt) ?? summary.createdAt,
    updatedAt: coerceIsoTimestamp(sessionFromHistory.updated_at, sessionFromHistory.updatedAt) ?? summary.updatedAt,
    messages,
    failures,
    ...(options.includeRaw ? { raw: rawHistory } : {}),
  };
}

export function extractBizData(raw: unknown): Record<string, unknown> {
  const value = asRecord(raw);
  const data = asRecordOrNull(value.data);
  return asRecordOrNull(data?.biz_data) ?? asRecordOrNull(value.biz_data) ?? data ?? value;
}

function normalizeMessage(
  sessionId: string,
  raw: unknown,
  index: number,
  includeRaw: boolean,
  failures: ConversationExportFailure[],
): ExportedMessage {
  const value = asRecord(raw);
  const explicitId = firstString(value.id, value.message_id, value.messageId, value.uuid);
  const id = explicitId ?? `${sessionId}:message:${index}`;
  if (!explicitId) {
    failures.push({
      code: 'message_id_missing',
      message: `Session ${sessionId} message at index ${index} did not include an official id; a deterministic export id was generated.`,
      sessionId,
      retryable: false,
    });
  }

  const contentFragments = extractContentFragments(value);
  const content = contentFragments.map((fragment) => fragment.text).filter(Boolean).join('\n\n').trim();

  return {
    id,
    parentId: firstString(value.parent_id, value.parent_message_id, value.parentMessageId),
    role: normalizeRole(firstString(value.message_role, value.role, value.type)),
    content,
    contentFragments,
    createdAt: coerceIsoTimestamp(value.created_at, value.createdAt, value.inserted_at),
    updatedAt: coerceIsoTimestamp(value.updated_at, value.updatedAt),
    modelType: firstString(value.model_type, value.modelType),
    searchEnabled: coerceNullableBoolean(value.search_enabled, value.searchEnabled),
    thinkingEnabled: coerceNullableBoolean(value.thinking_enabled, value.thinkingEnabled),
    attachmentRefs: extractAttachmentRefs(value),
    ...(includeRaw ? { raw } : {}),
  };
}

function extractMessages(bizData: Record<string, unknown>): unknown[] | null {
  if (Array.isArray(bizData.chat_messages)) return bizData.chat_messages;
  if (Array.isArray(bizData.messages)) return bizData.messages;
  return null;
}

function extractContentFragments(value: Record<string, unknown>): ExportedContentFragment[] {
  const fragments: ExportedContentFragment[] = [];
  const primary = firstString(
    value.content,
    value.content_text,
    value.contentText,
    value.text,
    value.prompt,
    value.answer,
  );
  if (primary) fragments.push({ kind: 'text', text: primary });

  if (Array.isArray(value.content)) {
    for (const part of value.content) {
      const fragment = normalizeContentPart(part);
      if (fragment) fragments.push(fragment);
    }
  }

  const reasoning = firstString(value.reasoning_content, value.reasoningContent, value.thinking_content);
  if (reasoning) fragments.push({ kind: 'reasoning', text: reasoning });

  const toolText = firstString(value.tool_result, value.toolResult);
  if (toolText) fragments.push({ kind: 'tool', text: toolText });

  return fragments;
}

function normalizeContentPart(part: unknown): ExportedContentFragment | null {
  if (typeof part === 'string' && part.trim()) return { kind: 'text', text: part };
  const value = asRecord(part);
  const text = firstString(value.text, value.content, value.value);
  if (!text) return null;
  const rawKind = firstString(value.type, value.kind);
  const kind: ExportedContentFragment['kind'] =
    rawKind === 'reasoning' || rawKind === 'thinking'
      ? 'reasoning'
      : rawKind === 'tool'
        ? 'tool'
        : rawKind === 'text'
          ? 'text'
          : 'unknown';
  return { kind, text };
}

function extractAttachmentRefs(value: Record<string, unknown>): ExportedAttachmentRef[] {
  const ids = new Set<string>();
  for (const id of coerceStringArray(value.ref_file_ids, value.refFileIds, value.file_ids, value.fileIds)) {
    ids.add(id);
  }
  for (const file of coerceRecordArray(value.files, value.attachments, value.ref_files, value.refFiles)) {
    const id = firstString(file.id, file.file_id, file.fileId);
    if (id) ids.add(id);
  }

  return [...ids].sort().map((id) => ({ id, role: 'referenced' }));
}

function normalizeRole(role: string | null): ExportedMessageRole {
  const lower = role?.toLowerCase();
  if (!lower) return 'unknown';
  if (lower === 'user' || lower === 'human') return 'user';
  if (lower === 'assistant' || lower === 'ai' || lower === 'bot') return 'assistant';
  if (lower === 'system') return 'system';
  if (lower === 'tool') return 'tool';
  return 'unknown';
}

function coerceIsoTimestamp(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      const numeric = Number(value);
      if (Number.isFinite(numeric) && value.trim().length >= 10) {
        const parsedNumeric = timestampNumberToIso(numeric);
        if (parsedNumeric) return parsedNumeric;
      }
      const parsed = new Date(value);
      if (!Number.isNaN(parsed.valueOf())) return parsed.toISOString();
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      const parsed = timestampNumberToIso(value);
      if (parsed) return parsed;
    }
  }
  return null;
}

function timestampNumberToIso(value: number): string | null {
  const millis = value > 1_000_000_000_000 ? value : value * 1000;
  const parsed = new Date(millis);
  return Number.isNaN(parsed.valueOf()) ? null : parsed.toISOString();
}

function coerceNullableBoolean(...values: unknown[]): boolean | null {
  for (const value of values) {
    if (typeof value === 'boolean') return value;
    if (value === 0 || value === 'false') return false;
    if (value === 1 || value === 'true') return true;
  }
  return null;
}

function coerceStringArray(...values: unknown[]): string[] {
  const result: string[] = [];
  for (const value of values) {
    if (Array.isArray(value)) {
      for (const item of value) {
        const text = firstString(item);
        if (text) result.push(text);
      }
    } else if (typeof value === 'string' && value.trim()) {
      for (const item of value.split(',')) {
        const text = item.trim();
        if (text) result.push(text);
      }
    }
  }
  return result;
}

function coerceRecordArray(...values: unknown[]): Record<string, unknown>[] {
  const result: Record<string, unknown>[] = [];
  for (const value of values) {
    if (Array.isArray(value)) {
      for (const item of value) {
        const record = asRecord(item);
        if (record) result.push(record);
      }
    }
  }
  return result;
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function asRecordOrNull(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
