import { describe, expect, it } from 'vitest';
import { closeInterruptedTrace } from '../core/inline-agent/trace-status';
import type { InlineAgentTraceRecord } from '../core/inline-agent/types';

function trace(
  overrides: Partial<InlineAgentTraceRecord> = {},
): InlineAgentTraceRecord {
  return {
    id: 'trace-1',
    loopId: 'loop-1',
    chatSessionId: 'session-1',
    anchorMessageId: 10,
    url: 'https://chat.deepseek.com/a/chat/s/session-1',
    originalPrompt: 'task',
    agentTaskPrompt: 'task',
    status: 'running',
    steps: [
      {
        index: 0,
        status: 'streaming',
        text: 'working…',
        toolExecutions: [],
        responseMessageId: null,
        collapsed: false,
      },
    ],
    totalSteps: 1,
    totalTools: 2,
    finalText: '',
    createdAt: 1,
    updatedAt: 2,
    ...overrides,
  };
}

describe('closeInterruptedTrace', () => {
  it('closes a running trace as stopping by default and refreshes updatedAt', () => {
    const running = trace();
    const closed = closeInterruptedTrace(running, 'Stopped');
    expect(closed).toEqual({
      ...running,
      status: 'stopping',
      error: 'Stopped',
      updatedAt: expect.any(Number),
    });
    expect(closed.updatedAt).toBeGreaterThanOrEqual(running.updatedAt);
  });

  it('closes a running trace as error with the failing step total', () => {
    const running = trace();
    const closed = closeInterruptedTrace(running, 'boom', {
      status: 'error',
      totalSteps: 3,
    });
    expect(closed).toEqual({
      ...running,
      status: 'error',
      error: 'boom',
      totalSteps: 3,
      updatedAt: expect.any(Number),
    });
  });

  it('keeps the recorded step total when the override is omitted', () => {
    const closed = closeInterruptedTrace(trace({ totalSteps: 7 }), 'stopped');
    expect(closed.totalSteps).toBe(7);
  });

  it('returns non-running traces unchanged (same reference)', () => {
    const table: InlineAgentLoopStatusTable = [
      ['stopping'],
      ['complete'],
      ['error'],
      ['idle'],
    ];
    for (const [status] of table) {
      const settled = trace({ status, error: 'prior', updatedAt: 42 });
      expect(closeInterruptedTrace(settled, 'Stopped')).toBe(settled);
      expect(closeInterruptedTrace(settled, 'boom', { status: 'error' })).toBe(
        settled,
      );
    }
  });

  it('is idempotent: closing an already-closed trace is a no-op', () => {
    const running = trace();
    const first = closeInterruptedTrace(running, 'Stopped');
    const second = closeInterruptedTrace(first, 'Stopped');
    expect(second).toBe(first);
  });

  it('preserves every unrelated record field', () => {
    const running = trace({ finalText: '', totalTools: 4, id: 'zombie-1' });
    const closed = closeInterruptedTrace(running, 'Stopped');
    expect(closed.id).toBe('zombie-1');
    expect(closed.loopId).toBe('loop-1');
    expect(closed.chatSessionId).toBe('session-1');
    expect(closed.steps).toBe(running.steps);
    expect(closed.totalTools).toBe(4);
    expect(closed.createdAt).toBe(1);
  });
});

type InlineAgentLoopStatusTable = Array<
  [Exclude<InlineAgentTraceRecord['status'], 'running'>]
>;
