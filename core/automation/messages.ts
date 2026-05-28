import type {
  AutomationErrorState,
  AutomationFailurePhase,
  AutomationRunnerFailure,
  AutomationRunnerRequest,
  AutomationRunnerResult,
} from './types';

export const AUTOMATION_CONTENT_RUN = 'DPP_AUTOMATION_CONTENT_RUN';
export const AUTOMATION_WINDOW_RUN_REQUEST = 'DPP_AUTOMATION_WINDOW_RUN_REQUEST';
export const AUTOMATION_WINDOW_RUN_RESULT = 'DPP_AUTOMATION_WINDOW_RUN_RESULT';
export const AUTOMATION_BRIDGE_TIMEOUT_MS = 120_000;

export const CONTENT_WINDOW_SOURCE = 'deepseek-pp-content';
export const MAIN_WORLD_WINDOW_SOURCE = 'deepseek-pp-main';

export interface AutomationContentRunMessage {
  type: typeof AUTOMATION_CONTENT_RUN;
  payload: AutomationRunnerRequest;
}

export interface AutomationWindowRunRequestMessage {
  source: typeof CONTENT_WINDOW_SOURCE;
  type: typeof AUTOMATION_WINDOW_RUN_REQUEST;
  id: string;
  payload: AutomationRunnerRequest;
}

export interface AutomationWindowRunResultMessage {
  source: typeof MAIN_WORLD_WINDOW_SOURCE;
  nonce?: string;
  type: typeof AUTOMATION_WINDOW_RUN_RESULT;
  id: string;
  result: AutomationRunnerResult;
}

export function isAutomationContentRunMessage(message: unknown): message is AutomationContentRunMessage {
  return (
    typeof message === 'object' &&
    message !== null &&
    (message as { type?: unknown }).type === AUTOMATION_CONTENT_RUN
  );
}

export function isAutomationWindowRunRequestMessage(
  message: unknown,
): message is AutomationWindowRunRequestMessage {
  return (
    typeof message === 'object' &&
    message !== null &&
    (message as { source?: unknown }).source === CONTENT_WINDOW_SOURCE &&
    (message as { type?: unknown }).type === AUTOMATION_WINDOW_RUN_REQUEST &&
    typeof (message as { id?: unknown }).id === 'string'
  );
}

export function isAutomationWindowRunResultMessage(
  message: unknown,
): message is AutomationWindowRunResultMessage {
  return (
    typeof message === 'object' &&
    message !== null &&
    (message as { source?: unknown }).source === MAIN_WORLD_WINDOW_SOURCE &&
    (message as { type?: unknown }).type === AUTOMATION_WINDOW_RUN_RESULT &&
    typeof (message as { id?: unknown }).id === 'string'
  );
}

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

export function isAutomationRunnerResult(value: unknown): value is AutomationRunnerResult {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { ok?: unknown }).ok === 'boolean' &&
    typeof (value as { completedAt?: unknown }).completedAt === 'number'
  );
}
