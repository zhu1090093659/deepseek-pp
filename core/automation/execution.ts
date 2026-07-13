import type { AutomationId, AutomationRunId } from './types';

export type AutomationStopKind = 'timeout' | 'cancelled' | 'lease_lost';

export class AutomationExecutionStoppedError extends Error {
  constructor(
    readonly kind: AutomationStopKind,
    message: string,
  ) {
    super(message);
    this.name = 'AutomationExecutionStoppedError';
  }
}

export interface AutomationExecutionContext {
  readonly runId: AutomationRunId;
  readonly automationId: AutomationId;
  readonly deadlineAt: number;
  readonly attempt: number;
  readonly signal: AbortSignal;
  createIdempotencyKey(scope: string): string;
  assertActive(): void;
}

interface CreateAutomationExecutionContextInput {
  runId: AutomationRunId;
  automationId: AutomationId;
  deadlineAt: number;
  attempt: number;
  signal: AbortSignal;
  isLeaseCurrent: () => boolean;
}

export function createAutomationExecutionContext(
  input: CreateAutomationExecutionContextInput,
): AutomationExecutionContext {
  return {
    runId: input.runId,
    automationId: input.automationId,
    deadlineAt: input.deadlineAt,
    attempt: input.attempt,
    signal: input.signal,
    createIdempotencyKey(scope) {
      const normalizedScope = scope.trim();
      if (!normalizedScope) throw new Error('Automation idempotency scope must not be empty.');
      return `automation:${input.runId}:${normalizedScope}`;
    },
    assertActive() {
      if (Date.now() >= input.deadlineAt) {
        throw new AutomationExecutionStoppedError(
          'timeout',
          `Automation run ${input.runId} exceeded its execution deadline.`,
        );
      }
      if (!input.isLeaseCurrent()) {
        throw new AutomationExecutionStoppedError(
          'lease_lost',
          `Automation run ${input.runId} no longer owns its execution lease.`,
        );
      }
      throwIfAutomationAborted(input.signal);
    },
  };
}

export function throwIfAutomationAborted(signal: AbortSignal): void {
  if (!signal.aborted) return;
  const reason = signal.reason;
  if (reason instanceof AutomationExecutionStoppedError) throw reason;
  if (reason instanceof Error) throw reason;
  throw new AutomationExecutionStoppedError('cancelled', 'Automation run was cancelled.');
}

export function readAutomationStopKind(signal: AbortSignal): AutomationStopKind | null {
  if (!signal.aborted) return null;
  return signal.reason instanceof AutomationExecutionStoppedError
    ? signal.reason.kind
    : 'cancelled';
}
