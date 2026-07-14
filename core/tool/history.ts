import type { ToolCall, ToolCallHistoryRecord, ToolExecutionTrigger, ToolResult } from './types';
import { decodeToolCallHistory, encodeToolCallHistory } from './history-codec';
import { createCoalescingMutationQueue } from '../persistence/coalescing-mutation-queue';

export const TOOL_HISTORY_STORAGE_KEY = 'deepseek_pp_tool_history';
// Lowered from 200 → 100. Each record carries detail/output snapshots, and each
// persisted burst replaces the whole key. 200 records of untrimmed MCP output
// easily pushed the serialized payload past chrome.storage.local's QUOTA_BYTES
// (10 MB), which then failed on every subsequent write (issue #297). 100
// trimmed records keep the working set well under quota.
const MAX_HISTORY = 100;
// Reserve headroom so other storage keys (memories, skills, settings) are not
// evicted when tool history grows. 0.75 of the per-key budget.
const HISTORY_BUDGET_RATIO = 0.75;
type ToolHistoryMutation = {
  call: ToolCall;
  result: ToolResult;
  source: ToolExecutionTrigger;
};
const toolHistoryOperations = createCoalescingMutationQueue<
  ToolHistoryMutation,
  ToolCallHistoryRecord
>(persistToolHistoryBurst);

export async function appendToolCallHistory(
  call: ToolCall,
  result: ToolResult,
  source: ToolExecutionTrigger,
): Promise<ToolCallHistoryRecord> {
  return toolHistoryOperations.mutate({ call, result, source });
}

async function persistToolHistoryBurst(
  mutations: readonly ToolHistoryMutation[],
): Promise<ToolCallHistoryRecord[]> {
  let history = orderToolCallHistory(await readToolCallHistoryAlreadyOwned());
  const results: ToolCallHistoryRecord[] = [];
  const budgetBytes = getHistoryBudgetBytes();
  for (const { call, result, source } of mutations) {
    const record: ToolCallHistoryRecord = {
      id: crypto.randomUUID(),
      call: sanitizeCall(call),
      result: sanitizeResult(result),
      source,
      createdAt: Date.now(),
    };
    history = trimToFit([record, ...history.slice(0, MAX_HISTORY)], budgetBytes)
      .slice(0, MAX_HISTORY);
    results.push(record);
  }
  await chrome.storage.local.set({
    [TOOL_HISTORY_STORAGE_KEY]: encodeToolCallHistory(history),
  });
  return results;
}

export async function getToolCallHistory(limit: number = MAX_HISTORY): Promise<ToolCallHistoryRecord[]> {
  return toolHistoryOperations.barrier(async () => {
    const history = orderToolCallHistory(await readToolCallHistoryAlreadyOwned());
    return history.slice(0, limit);
  });
}

export async function clearToolCallHistory(): Promise<void> {
  await toolHistoryOperations.barrier(async () => {
    await readToolCallHistoryAlreadyOwned();
    await chrome.storage.local.remove(TOOL_HISTORY_STORAGE_KEY);
  });
}

async function readToolCallHistoryAlreadyOwned(): Promise<ToolCallHistoryRecord[]> {
  const data = await chrome.storage.local.get(TOOL_HISTORY_STORAGE_KEY) as Record<string, unknown>;
  return decodeToolCallHistory(data[TOOL_HISTORY_STORAGE_KEY]);
}

function orderToolCallHistory(
  history: readonly ToolCallHistoryRecord[],
): ToolCallHistoryRecord[] {
  return [...history].sort((a, b) => b.createdAt - a.createdAt);
}

function sanitizeCall(call: ToolCall): ToolCall {
  return {
    ...call,
    payload: truncateRecord(call.payload, 4_000),
    raw: call.raw.length > 4_000 ? `${call.raw.slice(0, 4_000)}\n...[truncated]` : call.raw,
  };
}

function sanitizeResult(result: ToolResult): ToolResult {
  return {
    ...result,
    detail: truncateString(result.detail, 4_000),
    output: result.output === undefined ? undefined : truncateString(JSON.stringify(result.output), 8_000),
    error: result.error
      ? {
        ...result.error,
        message: truncateString(result.error.message, 2_000) ?? '',
        details: result.error.details ? truncateRecord(result.error.details, 2_000) : undefined,
      }
      : undefined,
  };
}

function truncateRecord(value: Record<string, unknown>, maxLength: number): Record<string, unknown> {
  const json = JSON.stringify(value);
  if (json.length <= maxLength) return value;
  return { truncated: true, preview: json.slice(0, maxLength) };
}

function truncateString(value: string | undefined, maxLength: number): string | undefined {
  if (!value || value.length <= maxLength) return value;
  return `${value.slice(0, maxLength)}\n...[truncated]`;
}

/**
 * Drop the oldest records until the serialized history fits within the budget.
 * Prevents the chrome.storage.local.set() call from throwing QUOTA_BYTES on
 * every tool call once the key fills up (issue #297). The newest record is
 * always retained so the current execution is never lost.
 */
function trimToFit(records: ToolCallHistoryRecord[], budgetBytes: number): ToolCallHistoryRecord[] {
  let candidate = records;
  while (candidate.length > 1) {
    const serialized = JSON.stringify(candidate);
    if (new Blob([serialized]).size <= budgetBytes) return candidate;
    // Drop oldest (highest index after we prepended the newest at index 0).
    candidate = candidate.slice(0, -1);
  }
  return candidate;
}

function getHistoryBudgetBytes(): number {
  // chrome.storage.local.QUOTA_BYTES is 10 MB (10,485,760) for unpacked/packed
  // extensions; fall back to that constant if the runtime does not expose it.
  const quota = (chrome.storage.local.QUOTA_BYTES as number | undefined) ?? 10_485_760;
  return Math.floor(quota * HISTORY_BUDGET_RATIO);
}
