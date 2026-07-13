import type { SandboxExecutionResult, SandboxRunRequest } from './types';

export const SANDBOX_OFFSCREEN_PORT = 'sandbox-offscreen';
export const SANDBOX_FRAME_TARGET_ORIGIN = '*';

export const SANDBOX_MESSAGE_TYPES = {
  offscreenRun: 'OFFSCREEN_SANDBOX_RUN',
  offscreenResult: 'OFFSCREEN_SANDBOX_RESULT',
  frameRun: 'DPP_SANDBOX_RUN',
  frameResult: 'DPP_SANDBOX_RESULT',
  htmlLog: 'DPP_HTML_LOG',
  htmlError: 'DPP_HTML_ERROR',
  htmlDone: 'DPP_HTML_DONE',
} as const;

export type SandboxMessageType = typeof SANDBOX_MESSAGE_TYPES[keyof typeof SANDBOX_MESSAGE_TYPES];

export interface SandboxEnvelope {
  type: SandboxMessageType;
  requestId: string;
  payload?: unknown;
  result?: unknown;
  [key: string]: unknown;
}

export function parseSandboxEnvelope(
  value: unknown,
  expectedType: SandboxMessageType,
  expectedRequestId?: string,
): SandboxEnvelope | null {
  if (!value || typeof value !== 'object') return null;
  const envelope = value as Record<string, unknown>;
  if (envelope.type !== expectedType || typeof envelope.requestId !== 'string') return null;
  if (expectedRequestId !== undefined && envelope.requestId !== expectedRequestId) return null;
  return envelope as SandboxEnvelope;
}

export interface SandboxBoundaryRequest extends SandboxRunRequest {
  pyodideBaseUrl?: string;
}

export interface SandboxBoundaryRequestMessages {
  invalidLanguage: string;
  invalidCode: string;
  includePyodideBaseUrl?: boolean;
}

export function normalizeSandboxBoundaryRequest(
  payload: unknown,
  messages: SandboxBoundaryRequestMessages,
): SandboxBoundaryRequest {
  const value = payload && typeof payload === 'object' ? payload as Partial<SandboxBoundaryRequest> : {};
  if (
    value.language !== 'javascript' &&
    value.language !== 'typescript' &&
    value.language !== 'python' &&
    value.language !== 'html'
  ) {
    throw new Error(messages.invalidLanguage);
  }
  if (typeof value.code !== 'string' || value.code.trim().length === 0) {
    throw new Error(messages.invalidCode);
  }
  const request: SandboxRunRequest = {
    language: value.language,
    code: value.code,
    input: typeof value.input === 'string' ? value.input : undefined,
    timeoutMs: typeof value.timeoutMs === 'number' && Number.isFinite(value.timeoutMs)
      ? Math.max(1_000, Math.min(15_000, Math.floor(value.timeoutMs)))
      : value.language === 'python' ? 15_000 : 5_000,
  };
  if (!messages.includePyodideBaseUrl) return request;
  return {
    ...request,
    pyodideBaseUrl: typeof value.pyodideBaseUrl === 'string' ? value.pyodideBaseUrl : undefined,
  };
}

export function normalizeSandboxExecutionResult(value: unknown): SandboxExecutionResult {
  const result = value && typeof value === 'object' ? value as Partial<SandboxExecutionResult> : {};
  return {
    ok: result.ok === true,
    stdout: typeof result.stdout === 'string' ? result.stdout : '',
    stderr: typeof result.stderr === 'string' ? result.stderr : '',
    result: typeof result.result === 'string' ? result.result : undefined,
    html: typeof result.html === 'string' ? result.html : undefined,
    previewText: typeof result.previewText === 'string' ? result.previewText : undefined,
    durationMs: typeof result.durationMs === 'number' && Number.isFinite(result.durationMs) ? result.durationMs : 0,
    truncated: result.truncated === true,
    error: typeof result.error === 'string' ? result.error : undefined,
  };
}
