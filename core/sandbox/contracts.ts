import { normalizeSandboxRunRequest } from './tool';
import type { SandboxExecutionResult, SandboxRunRequest } from './types';

export const SANDBOX_OFFSCREEN_PORT = 'sandbox-offscreen';

// Sandbox frames have a unique opaque origin, so '*' is required for sending.
// Receivers must pair it with exact WindowProxy identity, strict codecs, and a
// receiver-owned request correlation before dispatching any code.
export const SANDBOX_OPAQUE_TARGET_ORIGIN = '*';
export const SANDBOX_FRAME_TARGET_ORIGIN = SANDBOX_OPAQUE_TARGET_ORIGIN;
export const SANDBOX_OPAQUE_EVENT_ORIGIN = 'null';

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
  if (!isPlainRecord(value)) return null;
  if (value.type !== expectedType || !isNonEmptyString(value.requestId)) return null;
  if (expectedRequestId !== undefined && value.requestId !== expectedRequestId) return null;
  if (!SANDBOX_ENVELOPE_VALIDATORS[expectedType](value)) return null;
  return value as SandboxEnvelope;
}

export function readSandboxRequestId(
  value: unknown,
  expectedType: SandboxMessageType,
): string | null {
  if (!isPlainRecord(value) || value.type !== expectedType || !isNonEmptyString(value.requestId)) return null;
  return value.requestId;
}

export function isTrustedSandboxMessageEvent(
  actualSource: unknown,
  expectedSource: unknown,
  actualOrigin: string,
  expectedOrigin: string,
): boolean {
  return Boolean(expectedSource) && actualSource === expectedSource && actualOrigin === expectedOrigin;
}

export interface SandboxBoundaryRequest extends SandboxRunRequest {
  pyodideBaseUrl?: string;
}

export interface SandboxBoundaryRequestMessages {
  invalidLanguage: string;
  invalidCode: string;
  includePyodideBaseUrl?: boolean;
  pyodideOrigin?: string;
}

export function normalizeSandboxBoundaryRequest(
  payload: unknown,
  messages: SandboxBoundaryRequestMessages,
): SandboxBoundaryRequest {
  let request: SandboxRunRequest;
  try {
    request = normalizeSandboxRunRequest(payload);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    if (detail.startsWith('language must be')) throw new Error(messages.invalidLanguage);
    if (detail.startsWith('code must be')) throw new Error(messages.invalidCode);
    throw error;
  }
  if (!messages.includePyodideBaseUrl) return request;

  const value = payload as Record<string, unknown>;
  return {
    ...request,
    pyodideBaseUrl: normalizePyodideBaseUrl(value.pyodideBaseUrl, messages.pyodideOrigin),
  };
}

export function normalizeSandboxExecutionResult(value: unknown): SandboxExecutionResult {
  if (!isSandboxExecutionResult(value)) {
    throw new Error('Invalid sandbox execution result.');
  }
  return {
    ok: value.ok,
    stdout: value.stdout,
    stderr: value.stderr,
    result: value.result,
    html: value.html,
    previewText: value.previewText,
    durationMs: value.durationMs,
    truncated: value.truncated,
    error: value.error,
  };
}

const SANDBOX_ENVELOPE_VALIDATORS: Record<
  SandboxMessageType,
  (envelope: Record<string, unknown>) => boolean
> = {
  OFFSCREEN_SANDBOX_RUN: (envelope) => isPlainRecord(envelope.payload),
  OFFSCREEN_SANDBOX_RESULT: (envelope) => isSandboxExecutionResult(envelope.result),
  DPP_SANDBOX_RUN: (envelope) => isPlainRecord(envelope.payload),
  DPP_SANDBOX_RESULT: (envelope) => isSandboxExecutionResult(envelope.result),
  DPP_HTML_LOG: (envelope) => (
    ['log', 'info', 'warn', 'error'].includes(String(envelope.level)) &&
    Array.isArray(envelope.values) &&
    envelope.values.every((value) => typeof value === 'string')
  ),
  DPP_HTML_ERROR: (envelope) => typeof envelope.message === 'string',
  DPP_HTML_DONE: (envelope) => (
    typeof envelope.title === 'string' &&
    typeof envelope.text === 'string' &&
    typeof envelope.html === 'string'
  ),
};

function normalizePyodideBaseUrl(value: unknown, expectedOrigin?: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw new Error('Pyodide base URL is invalid.');
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Pyodide base URL is invalid.');
  }
  if (
    (url.protocol !== 'chrome-extension:' && url.protocol !== 'moz-extension:') ||
    (expectedOrigin !== undefined && `${url.protocol}//${url.host}` !== expectedOrigin) ||
    url.pathname !== '/pyodide/' ||
    url.search ||
    url.hash
  ) {
    throw new Error('Pyodide base URL is invalid.');
  }
  return url.href;
}

function isSandboxExecutionResult(value: unknown): value is SandboxExecutionResult {
  if (!isPlainRecord(value)) return false;
  if (
    typeof value.ok !== 'boolean' ||
    typeof value.stdout !== 'string' ||
    typeof value.stderr !== 'string' ||
    !isNonNegativeFiniteNumber(value.durationMs) ||
    typeof value.truncated !== 'boolean'
  ) return false;
  return optionalString(value.result) &&
    optionalString(value.html) &&
    optionalString(value.previewText) &&
    optionalString(value.error);
}

function optionalString(value: unknown): boolean {
  return value === undefined || typeof value === 'string';
}

function isNonNegativeFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
