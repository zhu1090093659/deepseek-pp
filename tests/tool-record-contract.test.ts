import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  normalizeRestoredToolCardResult,
  normalizeRestoredToolExecution,
  sanitizeToolExecutionForRestoreStorage,
} from '../core/tool/execution-restore';
import { executeRuntimeToolCall } from '../core/tool/runtime';
import type { ToolCardResult, ToolExecutionRecord } from '../core/types';
import {
  CONTRACT_EXECUTION_RECORD,
  CURRENT_GAP_TOOL_RECORDS,
  LEGAL_TOOL_RECORDS,
} from './fixtures/runtime-contract/tool-records';

beforeEach(() => {
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: vi.fn(async () => ({})),
        set: vi.fn(async () => undefined),
      },
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('tool record compatibility contract', () => {
  it('round-trips every released cross-runtime record family as JSON', () => {
    expect(JSON.parse(JSON.stringify(LEGAL_TOOL_RECORDS))).toEqual(LEGAL_TOOL_RECORDS);
    expect(Object.keys(LEGAL_TOOL_RECORDS)).toEqual([
      'provider',
      'descriptor',
      'call',
      'successResult',
      'failureResult',
      'executionContext',
      'registrySnapshot',
      'historyRecord',
      'executionRecord',
      'restoreRecord',
    ]);
  });

  it('preserves released restore normalization and storage sanitization fields', () => {
    expect(normalizeRestoredToolExecution(CONTRACT_EXECUTION_RECORD)).toEqual({
      name: CONTRACT_EXECUTION_RECORD.name,
      provider: CONTRACT_EXECUTION_RECORD.provider,
      descriptorId: CONTRACT_EXECUTION_RECORD.descriptorId,
      result: CONTRACT_EXECUTION_RECORD.result,
    });
    expect(sanitizeToolExecutionForRestoreStorage(CONTRACT_EXECUTION_RECORD)).toEqual({
      name: CONTRACT_EXECUTION_RECORD.name,
      provider: CONTRACT_EXECUTION_RECORD.provider,
      descriptorId: CONTRACT_EXECUTION_RECORD.descriptorId,
      result: CONTRACT_EXECUTION_RECORD.result,
    });
  });

  it('freezes visible runtime tool errors', async () => {
    const unsupported = await executeRuntimeToolCall({
      name: 'unsupported_contract_tool',
      payload: {},
      raw: '<unsupported_contract_tool>{}</unsupported_contract_tool>',
    }, 'test', 'en');
    const parseFailure = await executeRuntimeToolCall({
      name: 'capture_page',
      payload: {},
      raw: '<capture_page>{bad json}</capture_page>',
      parseError: {
        code: 'tool_call_json_invalid',
        message: 'Tool payload is not valid JSON.',
        retryable: false,
      },
    }, 'test', 'en');

    expect(unsupported).toMatchObject({
      ok: false,
      name: 'unsupported_contract_tool',
      error: { code: 'tool_unsupported', retryable: false },
    });
    expect(parseFailure).toMatchObject({
      ok: false,
      name: 'capture_page',
      error: { code: 'tool_call_json_invalid', retryable: false },
    });
  });

  it('characterizes unvalidated records without pretending every consumer accepts them', () => {
    for (const fixture of CURRENT_GAP_TOOL_RECORDS) {
      expect(fixture.target).toBe('reject-after-T2.1');
      expect(JSON.parse(JSON.stringify(fixture.record))).toEqual(fixture.record);
    }
    expect(CURRENT_GAP_TOOL_RECORDS.map((fixture) => fixture.currentBehavior)).toEqual([
      'no-authoritative-codec',
      'accepted-by-restore-normalizer',
      'accepted-by-restore-normalizer',
      'consumer-dependent-failure',
    ]);

    const missingSummary = CURRENT_GAP_TOOL_RECORDS[1].record as unknown as ToolCardResult;
    expect(normalizeRestoredToolCardResult(missingSummary)).toEqual(missingSummary);
    const unsupportedProviderExecution = {
      name: 'capture_page',
      provider: CURRENT_GAP_TOOL_RECORDS[2].record,
      result: CONTRACT_EXECUTION_RECORD.result,
    } as unknown as ToolExecutionRecord;
    expect(normalizeRestoredToolExecution(unsupportedProviderExecution).provider)
      .toEqual(CURRENT_GAP_TOOL_RECORDS[2].record);
    const malformedExecution = CURRENT_GAP_TOOL_RECORDS[3].record.executions[0] as ToolExecutionRecord;
    expect(() => normalizeRestoredToolExecution(malformedExecution)).toThrow();

    const payloadWithFunction = { callback: () => 'not serializable', stable: 42 };
    expect(JSON.parse(JSON.stringify(payloadWithFunction))).toEqual({ stable: 42 });
    const cyclicPayload: Record<string, unknown> = {};
    cyclicPayload.self = cyclicPayload;
    expect(() => JSON.stringify(cyclicPayload)).toThrow();
  });
});
