import type {
  AutomationErrorState,
  AutomationFailurePhase,
  AutomationRunnerFailure,
  AutomationRunnerRequest,
} from './types';

export function createAutomationRunnerFailure(
  request: Pick<AutomationRunnerRequest, 'chatSessionId' | 'parentMessageId'>,
  code: string,
  message: string,
  phase: AutomationFailurePhase,
  retryable: boolean,
  at: number = Date.now(),
  details?: Record<string, unknown>,
): AutomationRunnerFailure {
  return {
    ok: false,
    chatSessionId: request.chatSessionId,
    parentMessageId: request.parentMessageId,
    completedAt: at,
    error: createAutomationError(code, message, phase, retryable, at, details),
  };
}

export function createAutomationError(
  code: string,
  message: string,
  phase: AutomationFailurePhase,
  retryable: boolean,
  at: number = Date.now(),
  details?: Record<string, unknown>,
): AutomationErrorState {
  return {
    code,
    message,
    phase,
    retryable,
    at,
    details,
  };
}
