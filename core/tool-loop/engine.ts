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

export interface ToolContinuationLoopInput<TTurn> {
  initialTurn: TTurn;
  maxDepth: number;
  getAssistantText: (turn: TTurn) => string;
  getParentMessageId: (turn: TTurn) => number | null;
  extractToolCalls: (assistantText: string) => ToolCall[];
  executeToolCall: (
    call: ToolCall,
    parentMessageId: number,
    position: { depth: number; callIndex: number },
  ) => Promise<ToolExecutionRecord>;
  buildContinuationPrompt: (executions: ToolExecutionRecord[]) => string;
  submitContinuation: (prompt: string, parentMessageId: number) => Promise<TTurn>;
  signal?: AbortSignal;
  assertActive?: () => void;
}

export async function runToolContinuationLoop<TTurn>(
  input: ToolContinuationLoopInput<TTurn>,
): Promise<{ turn: TTurn; executions: ToolExecutionRecord[] }> {
  let turn = input.initialTurn;
  let parentMessageId = input.getParentMessageId(turn);
  const executions: ToolExecutionRecord[] = [];

  for (let depth = 0; depth < input.maxDepth; depth++) {
    assertContinuationActive(input);
    if (parentMessageId === null) break;

    const calls = input.extractToolCalls(input.getAssistantText(turn));
    if (calls.length === 0) break;

    const stepExecutions: ToolExecutionRecord[] = [];
    for (let callIndex = 0; callIndex < calls.length; callIndex++) {
      assertContinuationActive(input);
      const execution = await input.executeToolCall(
        calls[callIndex],
        parentMessageId,
        { depth, callIndex },
      );
      assertContinuationActive(input);
      stepExecutions.push(execution);
      executions.push(execution);
    }

    assertContinuationActive(input);
    turn = await input.submitContinuation(
      input.buildContinuationPrompt(stepExecutions),
      parentMessageId,
    );
    assertContinuationActive(input);
    parentMessageId = input.getParentMessageId(turn);
  }

  return { turn, executions };
}

function assertContinuationActive<TTurn>(input: ToolContinuationLoopInput<TTurn>): void {
  input.assertActive?.();
  if (!input.signal?.aborted) return;
  const reason = input.signal.reason;
  if (reason instanceof Error) throw reason;
  throw new DOMException('Automation continuation was aborted.', 'AbortError');
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
