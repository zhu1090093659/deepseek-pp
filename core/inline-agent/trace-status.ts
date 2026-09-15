import type { InlineAgentTraceRecord } from './types';

/**
 * Terminal status a still-`running` trace is closed with. Reuses EXISTING
 * `InlineAgentLoopStatus` values — no schema or status-vocabulary change.
 */
export type InterruptedTraceCloseStatus = 'stopping' | 'error';

export interface CloseInterruptedTraceOptions {
  /** Defaults to `'stopping'` (supersede / user-stop semantics). */
  status?: InterruptedTraceCloseStatus;
  /** Overrides the recorded step total (error gates report the failing step). */
  totalSteps?: number;
}

/**
 * Closes a still-`running` inline-agent trace with a terminal status so the
 * persisted census cannot accumulate zombie `running` rows for runs that were
 * superseded, user-stopped, or whose terminal events hit stale-loop gates.
 *
 * Pure and idempotent: non-`running` traces are returned UNCHANGED (same
 * reference), so callers can detect "nothing to persist" by reference
 * inequality and skip the storage write.
 */
export function closeInterruptedTrace(
  trace: InlineAgentTraceRecord,
  error: string,
  options: CloseInterruptedTraceOptions = {},
): InlineAgentTraceRecord {
  if (trace.status !== 'running') return trace;
  return {
    ...trace,
    status: options.status ?? 'stopping',
    error,
    ...(options.totalSteps === undefined
      ? null
      : { totalSteps: options.totalSteps }),
    updatedAt: Date.now(),
  };
}
