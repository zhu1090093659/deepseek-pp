import { DPP_MANAGED_AGENT_PROMPT_MARKER } from '../constants';
import {
  INLINE_AGENT_CONTINUATION_PLACEHOLDER,
  isInlineAgentContinuationPrompt,
  replaceTaskCompleteBlocks,
} from '../inline-agent/prompt';
import { sanitizeInternalPromptText } from '../prompt';
import type { ToolCall, ToolCallRestoreRecord, ToolDescriptor } from '../types';
import {
  createToolCallFromInvocation,
  createToolInvocationCatalog,
  getToolCloseTag,
  getToolOpenTag,
  type ToolInvocationCatalog,
} from '../tool';
import {
  extractToolCalls,
  LEGACY_TOOL_CALLS_CLOSE_TAG,
  LEGACY_TOOL_CALLS_OPEN_TAG,
  stripToolCalls,
} from './tool-parser';

const RESTORE_FULL_PARSE_MAX_LENGTH = 120_000;
const RESTORE_CONTENT_MAX_LENGTH = 8000;
const RESTORE_RAW_MAX_LENGTH = 512;
const RESTORE_PAYLOAD_STRING_MAX_LENGTH = 2048;
const RESTORE_PAYLOAD_STRING_PREVIEW_LENGTH = 240;
const RESTORE_PAYLOAD_ARRAY_MAX_ITEMS = 20;
const RESTORE_PAYLOAD_OBJECT_MAX_KEYS = 40;
const RESTORE_PAYLOAD_MAX_DEPTH = 6;
const RESTORE_OMITTED_PAYLOAD_RAW = '...[restore payload omitted]';

interface LightweightToolBlock {
  start: number;
  end: number;
  invocationNames: string[];
}

export interface HistoryCleanupOptions {
  toolDescriptors: readonly ToolDescriptor[];
  onToolCallsRestored: (records: ToolCallRestoreRecord[]) => void;
}

export function stripToolCallsFromHistory(json: any, options: HistoryCleanupOptions) {
  if (!json || !json.data) return;
  const data = json.data.biz_data || json.data;
  const messages = data.chat_messages;
  if (!Array.isArray(messages)) return;

  const restoredRecords: ToolCallRestoreRecord[] = [];
  stripMessageToolCalls(messages, restoredRecords, options.toolDescriptors);

  if (restoredRecords.length > 0) {
    options.onToolCallsRestored(restoredRecords);
  }
}

export function stripToolCallsFromIDBResult(result: any, options: HistoryCleanupOptions) {
  const restoredRecords: ToolCallRestoreRecord[] = [];

  if (Array.isArray(result)) {
    for (const item of result) {
      stripSingleIDBRecord(item, restoredRecords, options.toolDescriptors);
    }
  } else {
    stripSingleIDBRecord(result, restoredRecords, options.toolDescriptors);
  }

  if (restoredRecords.length > 0) {
    options.onToolCallsRestored(restoredRecords);
  }
}

function stripSingleIDBRecord(
  record: any,
  restoredRecords: ToolCallRestoreRecord[],
  toolDescriptors: readonly ToolDescriptor[],
) {
  if (!record || !record.data) return;
  const data = record.data;
  const messages = data.chat_messages;
  if (!Array.isArray(messages)) return;

  stripMessageToolCalls(messages, restoredRecords, toolDescriptors);
}

function stripMessageToolCalls(
  messages: any[],
  restoredRecords: ToolCallRestoreRecord[],
  toolDescriptors: readonly ToolDescriptor[],
) {
  const visibleMessages = messages.filter((msg: any) => !isRemovableInternalManagedAgentMessage(msg));
  if (visibleMessages.length !== messages.length) {
    messages.splice(0, messages.length, ...visibleMessages);
  }

  let assistantMessageIndex = 0;
  const inlineAgentContinuationMessageIds = collectInlineAgentContinuationMessageIds(visibleMessages);
  visibleMessages.forEach((msg: any, index: number) => {
    const replaceTaskComplete = shouldReplaceStoredTaskCompleteBlocks(msg, inlineAgentContinuationMessageIds);
    const shouldRestoreToolCalls = !replaceTaskComplete;
    sanitizeInlineAgentContinuationMessage(msg);
    sanitizeStoredMessageInternalPrompt(msg, { replaceTaskComplete });
    const hasStoredToolCall = storedMessageHasToolCallMarker(msg, toolDescriptors);
    const isAssistant = isAssistantStoredMessage(msg) || hasStoredToolCall;
    const currentAssistantMessageIndex = isAssistant ? assistantMessageIndex++ : null;
    const metadata = createMessageRestoreMetadata(msg, index, currentAssistantMessageIndex);
    const messageKey = getMessageRestoreKey(msg, index);
    if (typeof msg.content === 'string' && hasToolCallMarker(msg.content, toolDescriptors)) {
      if (shouldRestoreToolCalls) {
        const record = collectToolCallRestoreRecord(msg.content, `${messageKey}:content`, toolDescriptors, metadata);
        if (record) restoredRecords.push(record);
      }
      msg.content = stripToolCallsForHistoryText(msg.content, toolDescriptors);
    }
    if (msg.fragments && Array.isArray(msg.fragments)) {
      msg.fragments.forEach((frag: any, fragIndex: number) => {
        if (typeof frag.content === 'string' && hasToolCallMarker(frag.content, toolDescriptors)) {
          if (shouldRestoreToolCalls) {
            const record = collectToolCallRestoreRecord(
              frag.content,
              `${messageKey}:fragment:${fragIndex}`,
              toolDescriptors,
              metadata,
            );
            if (record) restoredRecords.push(record);
          }
          frag.content = stripToolCallsForHistoryText(frag.content, toolDescriptors);
        }
      });
    }
  });
}

function hasToolCallMarker(text: string, toolDescriptors: readonly ToolDescriptor[]): boolean {
  if (!text.includes('<')) return false;
  if (text.includes('｜DSML｜')) return true;
  const catalog = createToolInvocationCatalog(toolDescriptors);
  return hasXmlToolMarkerInText(text, catalog);
}

function hashString(value: string): string {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(36);
}

function getMessageRestoreKey(msg: any, index: number): string {
  return String(msg?.id ?? msg?.message_id ?? msg?.uuid ?? msg?.parent_message_id ?? index);
}

function createMessageRestoreMetadata(
  msg: any,
  messageIndex: number,
  assistantMessageIndex: number | null,
): Record<string, unknown> {
  return {
    messageId: msg?.id ?? msg?.message_id ?? msg?.messageId ?? msg?.uuid ?? null,
    parentMessageId: msg?.parent_id ?? msg?.parent_message_id ?? msg?.parentMessageId ?? null,
    messageIndex,
    assistantMessageIndex,
    role: firstString(msg?.message_role, msg?.role, msg?.type),
  };
}

function storedMessageHasToolCallMarker(msg: any, toolDescriptors: readonly ToolDescriptor[]): boolean {
  if (typeof msg?.content === 'string' && hasToolCallMarker(msg.content, toolDescriptors)) return true;
  if (!Array.isArray(msg?.fragments)) return false;
  return msg.fragments.some((frag: any) => typeof frag?.content === 'string' && hasToolCallMarker(frag.content, toolDescriptors));
}

function collectInlineAgentContinuationMessageIds(messages: any[]): Set<string> {
  const ids = new Set<string>();
  for (const msg of messages) {
    if (!isInlineAgentContinuationMessage(msg)) continue;
    const id = getStoredMessageId(msg);
    if (id !== null) ids.add(id);
  }
  return ids;
}

function shouldReplaceStoredTaskCompleteBlocks(msg: any, inlineAgentContinuationMessageIds: Set<string>): boolean {
  if (!isAssistantStoredMessage(msg)) return false;
  const parentId = getStoredMessageParentId(msg);
  return parentId !== null && inlineAgentContinuationMessageIds.has(parentId);
}

function isAssistantStoredMessage(msg: any): boolean {
  return firstString(msg?.message_role, msg?.role, msg?.type)?.toLowerCase() === 'assistant';
}

function getStoredMessageId(msg: any): string | null {
  return firstStoredMessageId(msg?.id, msg?.message_id, msg?.messageId, msg?.uuid);
}

function getStoredMessageParentId(msg: any): string | null {
  return firstStoredMessageId(msg?.parent_id, msg?.parent_message_id, msg?.parentMessageId);
}

function firstStoredMessageId(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value;
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return null;
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value;
  }
  return null;
}

function collectToolCallRestoreRecord(
  text: string,
  key: string,
  toolDescriptors: readonly ToolDescriptor[],
  metadata: Record<string, unknown>,
): ToolCallRestoreRecord | null {
  if (!hasToolCallMarker(text, toolDescriptors)) return null;

  let calls: ToolCall[];
  let content: string;
  if (text.length > RESTORE_FULL_PARSE_MAX_LENGTH) {
    const catalog = createToolInvocationCatalog(toolDescriptors);
    const blocks = findLightweightToolBlocks(text, catalog);
    calls = createLightweightToolCalls(blocks, catalog);
    content = stripToolBlocksFromText(text, blocks);
  } else {
    calls = extractToolCalls(text, { descriptors: toolDescriptors });
    content = stripToolCalls(text, { descriptors: toolDescriptors });
  }
  if (calls.length === 0) return null;

  const restoreCalls = calls.map(sanitizeToolCallForRestoreRecord);
  const id = hashString([
    key,
    hashString(content),
    restoreCalls.map(createToolCallRestoreSignature).join('\n'),
  ].join('\n'));
  return {
    id,
    calls: restoreCalls,
    content: clampText(content, RESTORE_CONTENT_MAX_LENGTH),
    source: 'history',
    metadata,
  };
}

function createLightweightToolCalls(
  blocks: readonly LightweightToolBlock[],
  catalog: ToolInvocationCatalog,
): ToolCall[] {
  const calls: ToolCall[] = [];

  for (const block of blocks) {
    for (const invocationName of block.invocationNames) {
      calls.push(createToolCallFromInvocation(
        invocationName,
        {},
        createOmittedToolCallRaw(invocationName),
        catalog,
      ));
    }
  }

  return calls;
}

function stripToolCallsForHistoryText(
  text: string,
  toolDescriptors: readonly ToolDescriptor[],
): string {
  if (text.length <= RESTORE_FULL_PARSE_MAX_LENGTH) {
    return stripToolCalls(text, { descriptors: toolDescriptors });
  }

  const catalog = createToolInvocationCatalog(toolDescriptors);
  const blocks = findLightweightToolBlocks(text, catalog);
  return stripToolBlocksFromText(text, blocks);
}

function stripToolBlocksFromText(
  text: string,
  blocks: readonly LightweightToolBlock[],
): string {
  if (blocks.length === 0) return text.trim();

  const parts: string[] = [];
  let cursor = 0;
  for (const block of blocks) {
    parts.push(text.slice(cursor, block.start));
    cursor = block.end;
  }
  parts.push(text.slice(cursor));

  return parts.join('').trim();
}

function findLightweightToolBlocks(
  text: string,
  catalog: ToolInvocationCatalog,
): LightweightToolBlock[] {
  const blocks = [
    ...findXmlToolBlocks(text, catalog),
    ...findLegacyToolBlocks(text, catalog),
  ].sort((a, b) => a.start - b.start || b.end - a.end);

  const nonOverlapping: LightweightToolBlock[] = [];
  let cursor = 0;
  for (const block of blocks) {
    if (block.start < cursor) continue;
    nonOverlapping.push(block);
    cursor = block.end;
  }
  return nonOverlapping;
}

function findXmlToolBlocks(
  text: string,
  catalog: ToolInvocationCatalog,
): LightweightToolBlock[] {
  const blocks: LightweightToolBlock[] = [];
  let searchFrom = 0;

  while (searchFrom < text.length) {
    const openIndex = text.indexOf('<', searchFrom);
    if (openIndex === -1) break;

    const tagEnd = text.indexOf('>', openIndex + 1);
    if (tagEnd === -1) break;
    const invocationName = text.slice(openIndex + 1, tagEnd);
    if (!catalog.descriptorByInvocationName.has(invocationName)) {
      searchFrom = invocationName.includes('<') ? openIndex + 1 : tagEnd + 1;
      continue;
    }

    const closeTag = getToolCloseTag(invocationName);
    const closeIndex = text.indexOf(closeTag, tagEnd + 1);
    if (closeIndex === -1) {
      searchFrom = tagEnd + 1;
      continue;
    }

    blocks.push({
      start: openIndex,
      end: closeIndex + closeTag.length,
      invocationNames: [invocationName],
    });
    searchFrom = closeIndex + closeTag.length;
  }

  return blocks;
}

function hasXmlToolMarkerInText(
  text: string,
  catalog: ToolInvocationCatalog,
): boolean {
  let searchFrom = 0;

  while (searchFrom < text.length) {
    const openIndex = text.indexOf('<', searchFrom);
    if (openIndex === -1) return false;

    const tagEnd = text.indexOf('>', openIndex + 1);
    if (tagEnd === -1) return false;
    const nameStart = text[openIndex + 1] === '/' ? openIndex + 2 : openIndex + 1;
    const invocationName = text.slice(nameStart, tagEnd);
    if (catalog.descriptorByInvocationName.has(invocationName)) return true;

    searchFrom = invocationName.includes('<') ? openIndex + 1 : tagEnd + 1;
  }

  return false;
}

function findLegacyToolBlocks(
  text: string,
  catalog: ToolInvocationCatalog,
): LightweightToolBlock[] {
  const blocks: LightweightToolBlock[] = [];
  let searchFrom = 0;

  while (searchFrom < text.length) {
    const openIndex = text.indexOf(LEGACY_TOOL_CALLS_OPEN_TAG, searchFrom);
    if (openIndex === -1) break;

    const closeIndex = text.indexOf(
      LEGACY_TOOL_CALLS_CLOSE_TAG,
      openIndex + LEGACY_TOOL_CALLS_OPEN_TAG.length,
    );
    if (closeIndex === -1) break;

    const end = closeIndex + LEGACY_TOOL_CALLS_CLOSE_TAG.length;
    blocks.push({
      start: openIndex,
      end,
      invocationNames: findLegacyInvocationNames(text, openIndex, end, catalog),
    });
    searchFrom = end;
  }

  return blocks;
}

function findLegacyInvocationNames(
  text: string,
  start: number,
  end: number,
  catalog: ToolInvocationCatalog,
): string[] {
  const names: string[] = [];
  const invokePrefix = '<｜DSML｜invoke name="';
  let searchFrom = start;

  while (searchFrom < end) {
    const invokeIndex = text.indexOf(invokePrefix, searchFrom);
    if (invokeIndex === -1 || invokeIndex >= end) break;

    const nameStart = invokeIndex + invokePrefix.length;
    const nameEnd = text.indexOf('"', nameStart);
    if (nameEnd === -1 || nameEnd >= end) break;

    const invocationName = text.slice(nameStart, nameEnd);
    if (catalog.descriptorByInvocationName.has(invocationName)) {
      names.push(invocationName);
    }
    searchFrom = nameEnd + 1;
  }

  return names;
}

function createOmittedToolCallRaw(invocationName: string): string {
  return [
    getToolOpenTag(invocationName),
    RESTORE_OMITTED_PAYLOAD_RAW,
    getToolCloseTag(invocationName),
  ].join('\n');
}

function sanitizeToolCallForRestoreRecord(call: ToolCall): ToolCall {
  return {
    ...call,
    raw: clampText(call.raw, RESTORE_RAW_MAX_LENGTH) ?? '',
    payload: sanitizeRestorePayload(call.payload),
  };
}

function sanitizeRestorePayload(payload: Record<string, unknown>): Record<string, unknown> {
  const sanitized = sanitizeRestoreValue(payload, 0);
  return sanitized && typeof sanitized === 'object' && !Array.isArray(sanitized)
    ? sanitized as Record<string, unknown>
    : {};
}

function sanitizeRestoreValue(value: unknown, depth: number): unknown {
  if (typeof value === 'string') return sanitizeRestoreString(value);
  if (value === null || typeof value !== 'object') return value;
  if (depth >= RESTORE_PAYLOAD_MAX_DEPTH) return { __dppRestoreMaxDepth: true };

  if (Array.isArray(value)) {
    const items = value
      .slice(0, RESTORE_PAYLOAD_ARRAY_MAX_ITEMS)
      .map((item) => sanitizeRestoreValue(item, depth + 1));
    if (value.length <= RESTORE_PAYLOAD_ARRAY_MAX_ITEMS) return items;
    return [
      ...items,
      {
        __dppRestoreOmittedItems: value.length - RESTORE_PAYLOAD_ARRAY_MAX_ITEMS,
      },
    ];
  }

  const entries = Object.entries(value as Record<string, unknown>);
  const keptEntries = entries
    .slice(0, RESTORE_PAYLOAD_OBJECT_MAX_KEYS)
    .map(([entryKey, entryValue]) => [entryKey, sanitizeRestoreValue(entryValue, depth + 1)]);

  if (entries.length > RESTORE_PAYLOAD_OBJECT_MAX_KEYS) {
    keptEntries.push([
      '__dppRestoreOmittedKeys',
      entries.length - RESTORE_PAYLOAD_OBJECT_MAX_KEYS,
    ]);
  }

  return Object.fromEntries(keptEntries);
}

function sanitizeRestoreString(value: string): unknown {
  if (value.length <= RESTORE_PAYLOAD_STRING_MAX_LENGTH) return value;
  return {
    __dppRestoreTruncatedText: true,
    length: value.length,
    hash: hashString(value),
    preview: value.slice(0, RESTORE_PAYLOAD_STRING_PREVIEW_LENGTH),
  };
}

function createToolCallRestoreSignature(call: ToolCall): string {
  return `${call.provider?.id ?? ''}:${call.name}:${call.invocationName ?? ''}:${JSON.stringify(call.payload)}`;
}

function clampText(value: string | undefined, maxLength: number): string | undefined {
  if (!value) return value;
  return value.length > maxLength ? `${value.slice(0, maxLength)}\n...[truncated]` : value;
}

function sanitizeStoredMessageInternalPrompt(msg: any, options: { replaceTaskComplete: boolean }) {
  if (!msg || typeof msg !== 'object') return;

  if (typeof msg.content === 'string') {
    msg.content = sanitizeStoredControlText(msg.content, options);
  }

  if (!Array.isArray(msg.fragments)) return;

  const textFragments = msg.fragments
    .filter((frag: any) => frag && typeof frag.content === 'string');

  if (textFragments.length === 0) return;

  const joined = textFragments.map((frag: any) => frag.content).join('');
  const sanitizedJoined = sanitizeStoredControlText(joined, options);
  if (sanitizedJoined !== joined) {
    textFragments.forEach((frag: any, index: number) => {
      frag.content = index === 0 ? sanitizedJoined : '';
    });
    return;
  }

  for (const frag of textFragments) {
    frag.content = sanitizeStoredControlText(frag.content, options);
  }
}

function sanitizeStoredControlText(text: string, options: { replaceTaskComplete: boolean }): string {
  const sanitized = sanitizeInternalPromptText(text);
  return options.replaceTaskComplete ? replaceTaskCompleteBlocks(sanitized) : sanitized;
}

function isInternalManagedAgentMessage(msg: any): boolean {
  if (!msg || typeof msg !== 'object') return false;
  if (typeof msg.content === 'string' && isInternalManagedAgentContent(msg.content)) return true;
  if (!Array.isArray(msg.fragments)) return false;
  return msg.fragments.some((frag: any) => typeof frag?.content === 'string' && isInternalManagedAgentContent(frag.content));
}

function isRemovableInternalManagedAgentMessage(msg: any): boolean {
  return isInternalManagedAgentMessage(msg) && !isInlineAgentContinuationMessage(msg);
}

function isInlineAgentContinuationMessage(msg: any): boolean {
  if (!msg || typeof msg !== 'object') return false;
  if (typeof msg.content === 'string' && isInlineAgentContinuationPrompt(msg.content)) return true;
  if (!Array.isArray(msg.fragments)) return false;
  return msg.fragments.some((frag: any) => typeof frag?.content === 'string' && isInlineAgentContinuationPrompt(frag.content));
}

function sanitizeInlineAgentContinuationMessage(msg: any) {
  if (!isInlineAgentContinuationMessage(msg)) return;

  if (typeof msg.content === 'string' && isInlineAgentContinuationPrompt(msg.content)) {
    msg.content = INLINE_AGENT_CONTINUATION_PLACEHOLDER;
  }

  if (!Array.isArray(msg.fragments)) return;

  let replaced = false;
  for (const frag of msg.fragments) {
    if (!frag || typeof frag.content !== 'string' || !isInlineAgentContinuationPrompt(frag.content)) continue;
    frag.content = replaced ? '' : INLINE_AGENT_CONTINUATION_PLACEHOLDER;
    replaced = true;
  }
}

function isInternalManagedAgentContent(content: string): boolean {
  if (content.includes(DPP_MANAGED_AGENT_PROMPT_MARKER)) return true;
  if (content.includes('DeepSeek++ 托管 Agent Runner') && content.includes('<tool_results>')) return true;
  if (isInlineAgentContinuationPrompt(content)) return true;
  return content.includes('Tool call format reminder:') &&
    content.includes('Available tool tag names:') &&
    content.includes('<original_user_task>') &&
    content.includes('</original_user_task>');
}
