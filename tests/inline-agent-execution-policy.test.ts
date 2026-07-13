import { describe, expect, it } from 'vitest';
import {
  INCOMPLETE_TOOL_CALL_ERROR_CODE,
  selectContinuableToolExecutions,
} from '../core/inline-agent/execution-policy';
import type { ToolExecutionRecord } from '../core/types';

describe('inline agent execution policy', () => {
  it('excludes pending and response-interrupted tool starts', () => {
    const completed = makeExecution();
    const pending = makeExecution({ pending: true });
    const interrupted = makeExecution({
      result: {
        ok: false,
        summary: 'failed',
        error: {
          code: INCOMPLETE_TOOL_CALL_ERROR_CODE,
          message: 'incomplete',
          retryable: false,
        },
      },
    });

    expect(selectContinuableToolExecutions([pending, interrupted, completed])).toEqual([completed]);
  });

  it('preserves released continuation for completed failures and supported providers', () => {
    const failed = makeExecution({
      result: {
        ok: false,
        summary: 'provider failed',
        error: { code: 'provider_failed', message: 'failed', retryable: false },
      },
    });
    const unsupported = makeExecution({
      name: 'memory_save',
      provider: { kind: 'local', id: 'memory', displayName: 'Memory', transport: 'in_process' },
    });

    expect(selectContinuableToolExecutions([failed, unsupported])).toEqual([failed]);
  });
});

function makeExecution(overrides: Partial<ToolExecutionRecord> = {}): ToolExecutionRecord {
  return {
    callId: 'call-1',
    name: 'web_fetch',
    provider: { kind: 'local', id: 'web', displayName: 'Web', transport: 'in_process' },
    result: { ok: true, summary: 'done' },
    ...overrides,
  };
}
