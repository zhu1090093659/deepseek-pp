export interface AbortScope {
  readonly signal: AbortSignal;
  readonly timedOut: () => boolean;
  clearDeadline(): void;
  cleanup(): void;
}

export function createAbortScope(
  callerSignal: AbortSignal | null | undefined,
  timeoutMs: number,
): AbortScope {
  const controller = new AbortController();
  let timeoutReached = false;
  let cleaned = false;
  const abortFromCaller = () => controller.abort(callerSignal?.reason);

  if (callerSignal?.aborted) {
    abortFromCaller();
  } else {
    callerSignal?.addEventListener('abort', abortFromCaller, { once: true });
  }

  const timeout = setTimeout(() => {
    timeoutReached = true;
    controller.abort(new DOMException(`Request exceeded ${timeoutMs} ms.`, 'TimeoutError'));
  }, timeoutMs);
  const clearDeadline = () => clearTimeout(timeout);

  return {
    signal: controller.signal,
    timedOut: () => timeoutReached,
    clearDeadline,
    cleanup() {
      if (cleaned) return;
      cleaned = true;
      clearDeadline();
      callerSignal?.removeEventListener('abort', abortFromCaller);
    },
  };
}
