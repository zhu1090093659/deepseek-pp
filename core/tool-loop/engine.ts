import type { ToolCall, ToolExecutionRecord, ToolResult } from '../types';

export type ToolLoopExecuteTool = (call: ToolCall) => Promise<ToolExecutionRecord>;

export interface ExecuteToolCallsOptions {
  signal?: AbortSignal;
}

export async function executeToolCallsSequentially(
  calls: readonly ToolCall[],
  executeTool: ToolLoopExecuteTool,
  options?: ExecuteToolCallsOptions,
): Promise<ToolExecutionRecord[]> {
  const results: ToolExecutionRecord[] = [];
  for (const call of calls) {
    if (options?.signal?.aborted) break;
    results.push(await executeTool(call));
  }
  return results;
}

/**
 * Execute independent tool calls in parallel.
 * Only safe for READONLY tools with no side effects.
 * Write tools must still be executed sequentially.
 */
export async function executeToolCallsParallel(
  calls: readonly ToolCall[],
  executeTool: ToolLoopExecuteTool,
  options?: ExecuteToolCallsOptions,
): Promise<ToolExecutionRecord[]> {
  if (calls.length === 0) return [];
  if (calls.length === 1) {
    if (options?.signal?.aborted) return [];
    return [await executeTool(calls[0])];
  }

  const promises = calls.map(async (call) => {
    if (options?.signal?.aborted) return null;
    return executeTool(call);
  });

  const results = await Promise.all(promises);
  return results.filter((r): r is ToolExecutionRecord => r !== null);
}

/**
 * Classify tool names for parallel vs sequential execution planning.
 * Returns true if the tool is semantically readonly (safe to parallelize).
 */
const READONLY_TOOL_NAMES = new Set([
  'file_read', 'file_list', 'file_search',
  'code_search', 'code_symbol', 'code_structure', 'code_glob', 'code_batch_read',
  'git_status', 'git_diff', 'git_log', 'git_branch',
  'shell_status', 'python_status', 'local_skill_preview',
  'web_search', 'web_fetch',
  'browser_snapshot', 'browser_list_tabs',
]);

export function isReadonlyTool(toolName: string): boolean {
  return READONLY_TOOL_NAMES.has(toolName);
}

/**
 * Partition tool calls into readonly (parallel-safe) and write (sequential) groups.
 * Each group maintains call order within its category.
 */
export function partitionToolCalls(
  calls: readonly ToolCall[],
): { readonlyCalls: ToolCall[]; writeCalls: ToolCall[] } {
  const readonlyCalls: ToolCall[] = [];
  const writeCalls: ToolCall[] = [];
  for (const call of calls) {
    if (isReadonlyTool(call.name)) {
      readonlyCalls.push(call);
    } else {
      writeCalls.push(call);
    }
  }
  return { readonlyCalls, writeCalls };
}

export interface ToolContinuationLoopInput<TTurn> {
  initialTurn: TTurn;
  maxDepth: number;
  getAssistantText: (turn: TTurn) => string;
  getParentMessageId: (turn: TTurn) => number | null;
  extractToolCalls: (assistantText: string) => ToolCall[];
  executeToolCall: (call: ToolCall, parentMessageId: number) => Promise<ToolExecutionRecord>;
  buildContinuationPrompt: (executions: ToolExecutionRecord[]) => string;
  submitContinuation: (prompt: string, parentMessageId: number) => Promise<TTurn>;
}

export async function runToolContinuationLoop<TTurn>(
  input: ToolContinuationLoopInput<TTurn>,
): Promise<{ turn: TTurn; executions: ToolExecutionRecord[] }> {
  let turn = input.initialTurn;
  let parentMessageId = input.getParentMessageId(turn);
  const executions: ToolExecutionRecord[] = [];

  for (let depth = 0; depth < input.maxDepth; depth++) {
    if (parentMessageId === null) break;

    const calls = input.extractToolCalls(input.getAssistantText(turn));
    if (calls.length === 0) break;

    const stepExecutions: ToolExecutionRecord[] = [];
    for (const call of calls) {
      const execution = await input.executeToolCall(call, parentMessageId);
      stepExecutions.push(execution);
      executions.push(execution);
    }

    turn = await input.submitContinuation(
      input.buildContinuationPrompt(stepExecutions),
      parentMessageId,
    );
    parentMessageId = input.getParentMessageId(turn);
  }

  return { turn, executions };
}

export function createToolExecutionRecord(
  call: ToolCall,
  result: ToolResult,
  limits: { detailMaxLength: number; outputMaxLength: number },
): ToolExecutionRecord {
  return {
    name: call.name,
    provider: call.provider,
    descriptorId: call.descriptorId,
    result: {
      ok: result.ok,
      summary: result.summary,
      detail: clampText(result.detail, limits.detailMaxLength),
      output: result.output === undefined
        ? undefined
        : clampText(JSON.stringify(result.output), limits.outputMaxLength),
      truncated: result.truncated,
      error: result.error,
    },
  };
}

export function clampText(value: string | undefined, maxLength: number): string | undefined {
  if (!value) return value;
  return value.length > maxLength ? `${value.slice(0, maxLength)}\n...[truncated]` : value;
}
