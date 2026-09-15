/**
 * Shared step-level control helpers for the inline agent.
 *
 * Extracted from the original self-built loop (loop.ts) so the DS-web
 * StreamFn adapter (Issue A1) can reuse the exact same timeout/abort and
 * request-throttling semantics without duplicating them. Behavior is
 * byte-identical to the previous private implementations; the original
 * loop is replaced by the pi engine in Issue A3, which consumes this
 * module as well.
 */
import {
  INLINE_AGENT_REQUEST_DELAY_MAX_MS,
  INLINE_AGENT_REQUEST_DELAY_MIN_MS,
  INLINE_AGENT_STEP_TIMEOUT_MS,
} from './types';
import type {
  ToolCardResult,
  ToolDescriptorId,
  ToolProviderIdentity,
} from '../types';

export interface StepSignal {
  signal: AbortSignal;
  clear: () => void;
  timedOut: () => boolean;
}

/**
 * Creates an abort signal that fires either when the parent signal aborts or
 * when the step timeout (120s) elapses. Mirrors the original loop semantics:
 * the timeout reason is a `TimeoutError` DOMException and `timedOut()` reports
 * whether the timeout (not a parent abort) fired.
 */
export function createStepSignal(parentSignal: AbortSignal): StepSignal {
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort(new DOMException('Agent step timed out.', 'TimeoutError'));
  }, INLINE_AGENT_STEP_TIMEOUT_MS);
  const onParentAbort = () => controller.abort();
  if (parentSignal.aborted) {
    onParentAbort();
  } else {
    parentSignal.addEventListener('abort', onParentAbort, { once: true });
  }
  const clear = () => {
    clearTimeout(timeout);
    parentSignal.removeEventListener('abort', onParentAbort);
  };
  return { signal: controller.signal, clear, timedOut: () => timedOut };
}

/** Resolves after a random 2.5–6.5s delay, or immediately when aborted. */
export function waitBetweenDeepSeekRequests(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  const delay = randomInt(INLINE_AGENT_REQUEST_DELAY_MIN_MS, INLINE_AGENT_REQUEST_DELAY_MAX_MS);
  return new Promise((resolve) => {
    const timeout = setTimeout(cleanup, delay);
    const onAbort = () => cleanup();

    function cleanup() {
      clearTimeout(timeout);
      signal.removeEventListener('abort', onAbort);
      resolve();
    }

    signal.addEventListener('abort', onAbort, { once: true });
  });
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/** Resolved by `raceWithDeadline` when the deadline expires before the promise. */
export interface ToolDeadlineTimeout {
  timedOut: true;
}

/** Injectable timer seam so tests can drive deadline expiry deterministically. */
export interface DeadlineTimers {
  scheduleTimeout: (callback: () => void, timeoutMs: number) => unknown;
  clearScheduledTimeout: (timer: unknown) => void;
}

const defaultDeadlineTimers: DeadlineTimers = {
  scheduleTimeout: (callback, timeoutMs) => setTimeout(callback, timeoutMs),
  clearScheduledTimeout: (timer) =>
    clearTimeout(timer as ReturnType<typeof setTimeout>),
};

/**
 * Races a tool-execution promise against a hard deadline and the run's abort
 * signal (fix/v1.14.1-tool-loop):
 *  - resolves with the promise value when the promise wins;
 *  - rejects with `signal.reason` when the run aborts first (silent-abort
 *    semantics are preserved — the loop adapter finalizes without an error);
 *  - resolves with the `{ timedOut: true }` sentinel when the deadline
 *    expires first, so the caller can fail the tool with a normal error
 *    result and the pi loop keeps running. The underlying promise is never
 *    cancelled; its eventual settlement is absorbed here.
 */
export function raceWithDeadline<T>(
  promise: Promise<T>,
  signal: AbortSignal,
  timeoutMs: number,
  timers: DeadlineTimers = defaultDeadlineTimers,
): Promise<T | ToolDeadlineTimeout> {
  return new Promise<T | ToolDeadlineTimeout>((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    let settled = false;
    let timer: unknown;
    const cleanup = () => {
      timers.clearScheduledTimeout(timer);
      signal.removeEventListener('abort', onAbort);
    };
    const onAbort = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(signal.reason);
    };
    timer = timers.scheduleTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve({ timedOut: true });
    }, timeoutMs);
    signal.addEventListener('abort', onAbort, { once: true });
    void promise.then(
      (value) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(value);
      },
      (error) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      },
    );
  });
}

/** Narrows a `raceWithDeadline` outcome to the deadline-expiry sentinel. */
export function isToolDeadlineTimeout<T>(
  value: T | ToolDeadlineTimeout,
): value is ToolDeadlineTimeout {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as ToolDeadlineTimeout).timedOut === true
  );
}

/**
 * Shapes the error result for a tool call that missed the deadline: the tool
 * FAILS (`ok: false`, retryable `tool_call_deadline_exceeded` error) so the
 * pi loop continues with a visible failure — never a silent skip, never a
 * thrown exception.
 */
export function shapeToolDeadlineTimeout(
  call: Pick<ToolCallIdentity, 'name' | 'provider' | 'descriptorId'>,
  message: string,
): ToolCardResult {
  return {
    ok: false,
    name: call.name,
    provider: call.provider,
    descriptorId: call.descriptorId,
    summary: message,
    error: {
      code: 'tool_call_deadline_exceeded',
      message,
      retryable: true,
    },
  };
}

type ToolCallIdentity = {
  name: string;
  provider?: ToolProviderIdentity;
  descriptorId?: ToolDescriptorId;
};
