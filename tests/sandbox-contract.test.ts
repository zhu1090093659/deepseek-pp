import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  executeSandboxToolCall,
  isTrustedSandboxMessageEvent,
  normalizeSandboxBoundaryRequest,
  normalizeSandboxExecutionResult,
  normalizeSandboxRunRequest,
  parseSandboxEnvelope,
  readSandboxRequestId,
  SANDBOX_FRAME_TARGET_ORIGIN,
  SANDBOX_MESSAGE_TYPES,
  SANDBOX_OFFSCREEN_PORT,
} from '../core/sandbox';
import type { ToolCall } from '../core/tool/types';
import {
  SANDBOX_BOUNDARY_REGRESSION_CASES,
  SANDBOX_ENVELOPE_TYPES,
  SANDBOX_ERROR_CODES,
  SANDBOX_EXECUTION_RESULT,
  SANDBOX_LEGAL_ENVELOPES,
  SANDBOX_NORMALIZATION_CASES,
  SANDBOX_REJECTED_REQUESTS,
} from './fixtures/runtime-contract/sandbox';

const sandboxSources = [
  'core/sandbox/tool.ts',
  'core/sandbox/worker-runner.ts',
  'core/sandbox/python-worker.ts',
  'entrypoints/background.ts',
  'entrypoints/sandbox-offscreen/main.ts',
  'entrypoints/sandbox-runner/main.ts',
].map((path) => readFileSync(path, 'utf8'));
const combinedSandboxSource = sandboxSources.join('\n');

describe('sandbox compatibility contract', () => {
  it.each(SANDBOX_NORMALIZATION_CASES)('normalizes legal request: $name', ({ input, output }) => {
    expect(normalizeSandboxRunRequest(input)).toEqual(output);
  });

  it('accepts exactly 30000 UTF-8 bytes and rejects the next multibyte character', () => {
    expect(new TextEncoder().encode('界'.repeat(10_000))).toHaveLength(30_000);
    expect(normalizeSandboxRunRequest({
      language: 'javascript',
      code: '界'.repeat(10_000),
    }).code).toHaveLength(10_000);
    expect(() => normalizeSandboxRunRequest({
      language: 'javascript',
      code: '界'.repeat(10_001),
    })).toThrow('code is too large; max 30000 bytes');
  });

  it.each(SANDBOX_REJECTED_REQUESTS)('rejects malformed request: $name', ({ input, error }) => {
    expect(() => normalizeSandboxRunRequest(input)).toThrow(error);
  });

  it('preserves successful ToolResult identity across the injected runtime', async () => {
    const result = await executeSandboxToolCall({
      async runSandbox(request) {
        expect(request).toEqual({
          language: 'javascript',
          code: 'return 42;',
          input: undefined,
          timeoutMs: 5_000,
        });
        return {
          ok: SANDBOX_EXECUTION_RESULT.ok,
          summary: 'Sandbox executed',
          detail: SANDBOX_EXECUTION_RESULT.result,
          output: SANDBOX_EXECUTION_RESULT,
        };
      },
    }, sandboxCall('sandbox_run', { language: 'javascript', code: 'return 42;' }), 'en');

    expect(result).toEqual({
      ok: true,
      summary: 'Sandbox executed',
      detail: '42',
      output: SANDBOX_EXECUTION_RESULT,
      name: 'sandbox_run',
      provider: {
        kind: 'local',
        id: 'sandbox',
        displayName: 'Browser Sandbox',
        transport: 'in_process',
      },
      descriptorId: undefined,
    });
  });

  it('preserves explicit tool, runtime, and invalid-request error codes', async () => {
    const unsupported = await executeSandboxToolCall(null, sandboxCall('not_sandbox', {}), 'en');
    const unavailable = await executeSandboxToolCall(null, sandboxCall('sandbox_run', {
      language: 'javascript',
      code: 'return 42;',
    }), 'en');
    const invalid = await executeSandboxToolCall({
      async runSandbox() {
        throw new Error('must not execute invalid input');
      },
    }, sandboxCall('sandbox_run', { language: 'ruby', code: 'puts 42' }), 'en');

    expect(unsupported).toMatchObject({ ok: false, error: { code: 'sandbox_tool_unsupported', retryable: false } });
    expect(unavailable).toMatchObject({ ok: false, error: { code: 'sandbox_runtime_unavailable', retryable: false } });
    expect(invalid).toMatchObject({ ok: false, error: { code: 'sandbox_invalid_request', retryable: false } });
  });

  it('enumerates every multi-hop envelope and stable sandbox error code', () => {
    expect(SANDBOX_OFFSCREEN_PORT).toBe(SANDBOX_ENVELOPE_TYPES.backgroundPort.port);
    expect(SANDBOX_MESSAGE_TYPES).toEqual({
      offscreenRun: SANDBOX_ENVELOPE_TYPES.backgroundPort.request,
      offscreenResult: SANDBOX_ENVELOPE_TYPES.backgroundPort.response,
      frameRun: SANDBOX_ENVELOPE_TYPES.frame.request,
      frameResult: SANDBOX_ENVELOPE_TYPES.frame.response,
      htmlLog: SANDBOX_ENVELOPE_TYPES.html.log,
      htmlError: SANDBOX_ENVELOPE_TYPES.html.error,
      htmlDone: SANDBOX_ENVELOPE_TYPES.html.done,
    });
    expect(SANDBOX_LEGAL_ENVELOPES.map((envelope) => envelope.type))
      .toEqual(Object.values(SANDBOX_MESSAGE_TYPES));
    for (const envelope of SANDBOX_LEGAL_ENVELOPES) {
      expect(parseSandboxEnvelope(envelope, envelope.type)).toEqual(envelope);
    }
    expect(parseSandboxEnvelope(null, SANDBOX_MESSAGE_TYPES.frameRun)).toBeNull();
    expect(parseSandboxEnvelope([], SANDBOX_MESSAGE_TYPES.frameRun)).toBeNull();
    expect(parseSandboxEnvelope({ type: 'UNKNOWN', requestId: 'sandbox-contract-1' }, SANDBOX_MESSAGE_TYPES.frameRun)).toBeNull();
    expect(parseSandboxEnvelope({ type: SANDBOX_MESSAGE_TYPES.frameRun, requestId: 7 }, SANDBOX_MESSAGE_TYPES.frameRun)).toBeNull();
    expect(parseSandboxEnvelope(
      { type: SANDBOX_MESSAGE_TYPES.offscreenResult, requestId: 'stale', result: SANDBOX_EXECUTION_RESULT },
      SANDBOX_MESSAGE_TYPES.offscreenResult,
      'sandbox-contract-1',
    )).toBeNull();

    const sourceErrorCodes = new Set(
      [...combinedSandboxSource.matchAll(/['"](sandbox_[a-z_]+)['"]/g)]
        .map((match) => match[1])
        .filter((code) => code !== 'sandbox_run'),
    );
    expect(sourceErrorCodes).toEqual(new Set(SANDBOX_ERROR_CODES));
  });

  it('closes divergent validators and permissive result normalization gaps', () => {
    expect(SANDBOX_BOUNDARY_REGRESSION_CASES.map((gap) => gap.target)).toEqual([
      'explicit-strip-at-T2.1-boundary',
      'shared-sandbox-boundary-at-T2.1',
      'explicit-invalid-result-at-T2.1-boundary',
      'opaque-sandbox-origin-policy-at-T2.1',
      'reject-malformed-envelope-at-T2.1-boundary',
      'reject-malformed-envelope-at-T2.1-boundary',
    ]);
    expect(normalizeSandboxRunRequest(SANDBOX_BOUNDARY_REGRESSION_CASES[0].input)).toEqual({
      language: 'javascript',
      code: 'return 42;',
      input: undefined,
      timeoutMs: 5_000,
    });
    expect(() => normalizeSandboxBoundaryRequest(SANDBOX_BOUNDARY_REGRESSION_CASES[1].input.payload, {
      invalidLanguage: 'invalid language',
      invalidCode: 'invalid code',
    })).toThrow('code is too large; max 30000 bytes');
    expect(() => normalizeSandboxExecutionResult(SANDBOX_BOUNDARY_REGRESSION_CASES[2].input))
      .toThrow('Invalid sandbox execution result.');
    expect(SANDBOX_FRAME_TARGET_ORIGIN).toBe(SANDBOX_BOUNDARY_REGRESSION_CASES[3].input.targetOrigin);
    expect(parseSandboxEnvelope(
      SANDBOX_BOUNDARY_REGRESSION_CASES[4].input,
      SANDBOX_MESSAGE_TYPES.frameRun,
    )).toBeNull();
    expect(parseSandboxEnvelope(
      SANDBOX_BOUNDARY_REGRESSION_CASES[5].input,
      SANDBOX_MESSAGE_TYPES.offscreenResult,
    )).toBeNull();
  });

  it('keeps opaque-origin sending bounded by exact source and origin checks', () => {
    const source = {};
    expect(SANDBOX_FRAME_TARGET_ORIGIN).toBe('*');
    expect(isTrustedSandboxMessageEvent(source, source, 'null', 'null')).toBe(true);
    expect(isTrustedSandboxMessageEvent({}, source, 'null', 'null')).toBe(false);
    expect(isTrustedSandboxMessageEvent(source, source, 'https://example.test', 'null')).toBe(false);
  });

  it.each([
    ['run without payload', { type: SANDBOX_MESSAGE_TYPES.offscreenRun, requestId: 'bad-1' }, SANDBOX_MESSAGE_TYPES.offscreenRun],
    ['result with negative duration', {
      type: SANDBOX_MESSAGE_TYPES.offscreenResult,
      requestId: 'bad-2',
      result: { ...SANDBOX_EXECUTION_RESULT, durationMs: -1 },
    }, SANDBOX_MESSAGE_TYPES.offscreenResult],
    ['HTML log with non-string value', {
      type: SANDBOX_MESSAGE_TYPES.htmlLog,
      requestId: 'bad-3',
      level: 'log',
      values: [{}],
    }, SANDBOX_MESSAGE_TYPES.htmlLog],
    ['HTML error without message', {
      type: SANDBOX_MESSAGE_TYPES.htmlError,
      requestId: 'bad-4',
    }, SANDBOX_MESSAGE_TYPES.htmlError],
    ['HTML done without serialized document', {
      type: SANDBOX_MESSAGE_TYPES.htmlDone,
      requestId: 'bad-5',
      title: '',
      text: '',
    }, SANDBOX_MESSAGE_TYPES.htmlDone],
  ] as const)('rejects malformed nested sandbox envelope: %s', (_name, message, type) => {
    expect(readSandboxRequestId(message, type)).toBe(message.requestId);
    expect(parseSandboxEnvelope(message, type)).toBeNull();
  });

  it('validates Pyodide asset URLs at the frame execution boundary', () => {
    expect(normalizeSandboxBoundaryRequest({
      language: 'python',
      code: 'print(42)',
      pyodideBaseUrl: 'chrome-extension://contract/pyodide/',
    }, {
      invalidLanguage: 'invalid language',
      invalidCode: 'invalid code',
      includePyodideBaseUrl: true,
      pyodideOrigin: 'chrome-extension://contract',
    })).toEqual({
      language: 'python',
      code: 'print(42)',
      input: undefined,
      timeoutMs: 15_000,
      pyodideBaseUrl: 'chrome-extension://contract/pyodide/',
    });

    for (const pyodideBaseUrl of [
      'https://example.test/pyodide/',
      'chrome-extension://other/pyodide/',
      'chrome-extension://contract/other/',
      'chrome-extension://contract/pyodide/?override=1',
    ]) {
      expect(() => normalizeSandboxBoundaryRequest({
        language: 'python',
        code: 'print(42)',
        pyodideBaseUrl,
      }, {
        invalidLanguage: 'invalid language',
        invalidCode: 'invalid code',
        includePyodideBaseUrl: true,
        pyodideOrigin: 'chrome-extension://contract',
      })).toThrow('Pyodide base URL is invalid.');
    }
  });

  it('normalizes RUN_ARTIFACT_CODE before creating an offscreen document', () => {
    const background = readFileSync('entrypoints/background.ts', 'utf8');
    const start = background.indexOf('async function runBrowserSandboxToolResult');
    const normalize = background.indexOf('normalizeSandboxRunRequest(request)', start);
    const dispatch = background.indexOf('requestOffscreenSandboxRun(normalizedRequest)', start);

    expect(start).toBeGreaterThan(-1);
    expect(normalize).toBeGreaterThan(start);
    expect(dispatch).toBeGreaterThan(normalize);
  });
});

function sandboxCall(name: string, payload: Record<string, unknown>): ToolCall {
  return {
    name,
    payload,
    raw: `<${name}>${JSON.stringify(payload)}</${name}>`,
  };
}
