import { createAutomationRunnerFailure } from './messages';
import type { AutomationRunnerRequest, AutomationRunnerResult } from './types';

export type ResolvedAutomationClientHeaders =
  | { kind: 'ok'; headers: Record<string, string> }
  | { kind: 'failure'; result: AutomationRunnerResult };

export function createAutomationAuthFailure(
  request: Pick<AutomationRunnerRequest, 'chatSessionId' | 'parentMessageId'>,
  message: string,
): AutomationRunnerResult {
  return createAutomationRunnerFailure(
    request,
    'deepseek_auth_token_missing',
    message,
    'auth',
    false,
  );
}

export function resolveAutomationClientHeaders(
  clientHeaders: Record<string, string> | null | undefined,
  request: Pick<AutomationRunnerRequest, 'chatSessionId' | 'parentMessageId'>,
  message: string,
): ResolvedAutomationClientHeaders {
  if (!clientHeaders?.Authorization) {
    return {
      kind: 'failure',
      result: createAutomationAuthFailure(request, message),
    };
  }
  return { kind: 'ok', headers: clientHeaders };
}