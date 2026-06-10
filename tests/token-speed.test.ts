import { afterEach, describe, expect, it, vi } from 'vitest';
import { estimateTokenUnits, estimateTokens } from '../core/token/estimator';
import {
  createResponseTokenSpeedTracker,
  type ResponseTokenSpeedPayload,
} from '../core/interceptor/token-speed';

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
});
