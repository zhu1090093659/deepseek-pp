import { afterEach, describe, expect, it, vi } from 'vitest';
import { estimateTokenUnits, estimateTokens } from '../core/token/estimator';
import {
  createResponseTokenSpeedTracker,
  shouldIgnoreEmptyTokenSpeedProgress,
  type ResponseTokenSpeedPayload,
} from '../core/deepseek/stream-metrics';
import {
  extractResponseTextForTokenSpeed,
  extractResponseUsageStatsFromParsed,
  parseSSEChunk,
  parseSSEData,
} from '../core/deepseek/stream-codec';

describe('estimateTokenUnits', () => {
  it('estimates ASCII text at ~0.3 token per character', () => {
    expect(estimateTokenUnits('abcd')).toBeCloseTo(1.2, 5);
  });

  it('estimates CJK text at ~0.6 token per character', () => {
    expect(estimateTokenUnits('你好世界')).toBeCloseTo(2.4, 5);
  });

  it('rounds up in estimateTokens', () => {
    expect(estimateTokens('abcd')).toBe(2);
    expect(estimateTokens('你好世界')).toBe(3);
  });
});

describe('createResponseTokenSpeedTracker', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function setupTracker() {
    let now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const payloads: ResponseTokenSpeedPayload[] = [];
    const tracker = createResponseTokenSpeedTracker((p) => payloads.push(p), 250);
    return {
      tracker,
      payloads,
      advanceTo(ms: number) {
        now = ms;
      },
    };
  }

  it('reports zero speed before any chunk arrives', () => {
    const { tracker, payloads, advanceTo } = setupTracker();
    advanceTo(5000);
    tracker.finish();
    const final = payloads[payloads.length - 1];
    expect(final.tokensPerSecond).toBe(0);
    expect(final.estimatedTokens).toBe(0);
  });

  it('measures decode speed from the first streamed chunk, not tracker creation', () => {
    const { tracker, payloads, advanceTo } = setupTracker();
    // 3s of queueing/prefill before the stream produces the first chunk.
    advanceTo(3000);
    tracker.append('你好'); // 1.2 units, excluded from the rate (no elapsed time yet)
    advanceTo(4000);
    tracker.append('世界'); // 1.2 units decoded over 1s
    tracker.finish();
    const final = payloads[payloads.length - 1];
    expect(final.active).toBe(false);
    expect(final.estimatedTokens).toBe(2); // round(2.4)
    expect(final.textLength).toBe(4);
    // 1.2 token units over the 1s between first and second chunk.
    expect(final.tokensPerSecond).toBeCloseTo(1.2, 5);
  });

  it('does not spike on the first chunk', () => {
    const { tracker, payloads, advanceTo } = setupTracker();
    advanceTo(1000);
    tracker.append('hello world, this is a long first chunk');
    const afterFirst = payloads[payloads.length - 1];
    expect(afterFirst.tokensPerSecond).toBe(0);
    tracker.finish();
  });

  it('uses server token usage and server timestamps when available', () => {
    const { tracker, payloads, advanceTo } = setupTracker();
    advanceTo(100);
    tracker.updateServerStats({ modelType: 'vision', insertedAt: 1000 });
    tracker.append('hello world');
    tracker.updateServerStats({ accumulatedTokenUsage: 3302 });
    tracker.finish();
    tracker.updateServerStats({ updatedAt: 1003.11 });

    const final = payloads[payloads.length - 1];
    expect(final.active).toBe(false);
    expect(final.modelType).toBe('vision');
    expect(final.accumulatedTokens).toBe(3302);
    expect(final.tokenSource).toBe('server');
    expect(final.speedSource).toBe('server');
    expect(final.elapsedMs).toBe(3110);
    expect(final.tokensPerSecond).toBeCloseTo(3302 / 3.11, 5);
  });

  it('keeps estimated TPS until the server time window is complete', () => {
    const { tracker, payloads, advanceTo } = setupTracker();
    tracker.updateServerStats({ insertedAt: 1000 });
    tracker.updateServerStats({ updatedAt: 1000.01 });
    advanceTo(1000);
    tracker.append('你好');
    advanceTo(2000);
    tracker.append('世界');
    tracker.updateServerStats({ accumulatedTokenUsage: 99 });
    tracker.finish();

    const final = payloads[payloads.length - 1];
    expect(final.accumulatedTokens).toBe(99);
    expect(final.tokenSource).toBe('server');
    expect(final.speedSource).toBe('estimated');
    expect(final.tokensPerSecond).toBeCloseTo(1.2, 5);
  });

  it('handles server token usage and completion time from the same stats patch', () => {
    const { tracker, payloads } = setupTracker();
    tracker.updateServerStats({ insertedAt: 2000 });
    tracker.finish();
    tracker.updateServerStats({ accumulatedTokenUsage: 120, updatedAt: 2002 });

    const final = payloads[payloads.length - 1];
    expect(final.accumulatedTokens).toBe(120);
    expect(final.speedSource).toBe('server');
    expect(final.tokensPerSecond).toBe(60);
  });
});

describe('shouldIgnoreEmptyTokenSpeedProgress', () => {
  it('allows a new request to reset stale token speed output even before tokens arrive', () => {
    const previous = createProgress({
      requestId: 'request:old',
      estimatedTokens: 42,
      textLength: 120,
      active: false,
    });
    const nextStart = createProgress({
      requestId: 'request:new',
      estimatedTokens: 0,
      textLength: 0,
      active: true,
    });

    expect(shouldIgnoreEmptyTokenSpeedProgress(nextStart, previous)).toBe(false);
  });

  it('ignores empty repeats for the same request after meaningful progress', () => {
    const previous = createProgress({
      requestId: 'request:same',
      accumulatedTokens: 120,
      estimatedTokens: 90,
      textLength: 300,
      active: true,
    });
    const repeat = createProgress({
      requestId: 'request:same',
      accumulatedTokens: null,
      estimatedTokens: 0,
      textLength: 0,
      active: true,
    });

    expect(shouldIgnoreEmptyTokenSpeedProgress(repeat, previous)).toBe(true);
  });

  it('does not treat anonymous empty progress as the same request', () => {
    const previous = createProgress({
      estimatedTokens: 24,
      textLength: 80,
    });
    const anonymousStart = createProgress({
      active: true,
    });

    expect(shouldIgnoreEmptyTokenSpeedProgress(anonymousStart, previous)).toBe(false);
  });
});

describe('extractResponseUsageStatsFromParsed', () => {
  function parseOne(block: string) {
    const event = parseSSEChunk(block)[0];
    if (!event) throw new Error('missing SSE event');
    return {
      event,
      parsed: parseSSEData(event.data),
    };
  }

  it('extracts ready model type and update_session timestamps', () => {
    const ready = parseOne('event: ready\ndata: {"request_message_id":1,"response_message_id":2,"model_type":"vision"}\n\n');
    const update = parseOne('event: update_session\ndata: {"updated_at":1781763676.655633}\n\n');

    expect(extractResponseUsageStatsFromParsed(ready.parsed, ready.event.type)).toEqual({
      modelType: 'vision',
    });
    expect(extractResponseUsageStatsFromParsed(update.parsed, update.event.type)).toEqual({
      updatedAt: 1781763676.655633,
    });
  });

  it('extracts inserted_at and accumulated_token_usage from response payloads and batches', () => {
    const start = parseOne('data: {"v":{"response":{"inserted_at":1781763673.5456538,"accumulated_token_usage":0}}}\n\n');
    const batch = parseOne('data: {"p":"response","o":"BATCH","v":[{"p":"accumulated_token_usage","v":3302},{"p":"quasi_status","v":"FINISHED"}]}\n\n');

    expect(extractResponseUsageStatsFromParsed(start.parsed, start.event.type)).toEqual({
      insertedAt: 1781763673.5456538,
      accumulatedTokenUsage: 0,
    });
    expect(extractResponseUsageStatsFromParsed(batch.parsed, batch.event.type)).toEqual({
      accumulatedTokenUsage: 3302,
    });
  });
});

function createProgress(overrides: Partial<ResponseTokenSpeedPayload> = {}): ResponseTokenSpeedPayload {
  return {
    requestId: undefined,
    chatSessionId: null,
    assistantMessageId: null,
    active: false,
    estimatedTokens: 0,
    accumulatedTokens: null,
    tokensPerSecond: 0,
    elapsedMs: 0,
    textLength: 0,
    tokenSource: 'estimated',
    speedSource: 'estimated',
    modelType: null,
    ...overrides,
  };
}

describe('extractResponseTextForTokenSpeed', () => {
  it('keeps raw response text available for token speed accounting', () => {
    const parsed = {
      p: 'response/content',
      o: 'APPEND',
      v: '<artifact_create>{"filename":"demo.html","content":"<canvas></canvas>"}</artifact_create>',
    };

    expect(extractResponseTextForTokenSpeed(parsed)).toContain('artifact_create');
  });

  it('counts thinking patches even when they are not visible response content', () => {
    expect(extractResponseTextForTokenSpeed({
      p: 'response/fragments/0/thinking_content',
      v: '思考内容',
    })).toBe('思考内容');
  });

  it('combines visible and thinking text inside batch patches', () => {
    expect(extractResponseTextForTokenSpeed({
      o: 'BATCH',
      v: [
        { p: 'response/content', o: 'APPEND', v: '答案' },
        { p: 'response/fragments/0/thinking_content', v: '思考' },
      ],
    })).toBe('答案思考');
  });
});
