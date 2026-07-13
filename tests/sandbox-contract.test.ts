import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  executeSandboxToolCall,
  normalizeSandboxBoundaryRequest,
  normalizeSandboxExecutionResult,
  normalizeSandboxRunRequest,
  parseSandboxEnvelope,
  SANDBOX_FRAME_TARGET_ORIGIN,
  SANDBOX_MESSAGE_TYPES,
  SANDBOX_OFFSCREEN_PORT,
} from '../core/sandbox';
import type { ToolCall } from '../core/tool/types';
import {
  SANDBOX_CURRENT_GAPS,
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

  it('characterizes divergent validators and permissive result normalization as current gaps', () => {
    expect(SANDBOX_CURRENT_GAPS.map((gap) => gap.target)).toEqual([
      'reject-or-strip-explicitly-after-T2.1',
      'shared-sandbox-boundary-after-T2.1',
      'explicit-invalid-result-after-T2.1',
      'explicit-sandbox-origin-policy-after-T2.1',
      'reject-malformed-envelope-after-T2.1',
      'reject-malformed-envelope-after-T2.1',
    ]);
    expect(normalizeSandboxRunRequest(SANDBOX_CURRENT_GAPS[0].input)).toEqual({
      language: 'javascript',
      code: 'return 42;',
      input: undefined,
      timeoutMs: 5_000,
    });
    expect(normalizeSandboxBoundaryRequest(SANDBOX_CURRENT_GAPS[1].input.payload, {
      invalidLanguage: 'invalid language',
      invalidCode: 'invalid code',
    }).code).toHaveLength(30_001);
    expect(normalizeSandboxExecutionResult(SANDBOX_CURRENT_GAPS[2].input)).toEqual({
      ok: false,
      stdout: '',
      stderr: '',
      result: undefined,
      html: undefined,
      previewText: undefined,
      durationMs: 0,
      truncated: false,
      error: undefined,
    });
    expect(SANDBOX_FRAME_TARGET_ORIGIN).toBe(SANDBOX_CURRENT_GAPS[3].input.targetOrigin);
    expect(parseSandboxEnvelope(
      SANDBOX_CURRENT_GAPS[4].input,
      SANDBOX_MESSAGE_TYPES.frameRun,
    )).not.toBeNull();
    expect(parseSandboxEnvelope(
      SANDBOX_CURRENT_GAPS[5].input,
      SANDBOX_MESSAGE_TYPES.offscreenResult,
    )).not.toBeNull();
  });
});

function sandboxCall(name: string, payload: Record<string, unknown>): ToolCall {
  return {
    name,
    payload,
    raw: `<${name}>${JSON.stringify(payload)}</${name}>`,
  };
}
