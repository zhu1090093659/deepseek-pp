import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  normalizeRestoredToolCardResult,
  normalizeRestoredToolExecution,
  sanitizeToolExecutionForRestoreStorage,
} from '../core/tool/execution-restore';
import { executeRuntimeToolCall } from './helpers/production-tool-runtime';
import {
  isToolCallHistoryRecord,
  isToolCallRecord,
  isToolCallRestoreRecord,
  isToolDescriptorRecord,
  isToolExecutionContextRecord,
  isToolExecutionRecord,
  isToolProviderIdentity,
  isToolRegistrySnapshotRecord,
  isToolResultRecord,
} from '../core/messaging/tool-record-codec';
import type { ToolCardResult, ToolExecutionRecord } from '../core/types';
import {
  CONTRACT_EXECUTION_RECORD,
  MALFORMED_TOOL_RECORDS,
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

  it('accepts every released record through one reusable codec authority', () => {
    expect(isToolProviderIdentity(LEGAL_TOOL_RECORDS.provider)).toBe(true);
    expect(isToolDescriptorRecord(LEGAL_TOOL_RECORDS.descriptor)).toBe(true);
    expect(isToolCallRecord(LEGAL_TOOL_RECORDS.call)).toBe(true);
    expect(isToolResultRecord(LEGAL_TOOL_RECORDS.successResult)).toBe(true);
    expect(isToolResultRecord(LEGAL_TOOL_RECORDS.failureResult)).toBe(true);
    expect(isToolExecutionContextRecord(LEGAL_TOOL_RECORDS.executionContext)).toBe(true);
    expect(isToolRegistrySnapshotRecord(LEGAL_TOOL_RECORDS.registrySnapshot)).toBe(true);
    expect(isToolCallHistoryRecord(LEGAL_TOOL_RECORDS.historyRecord)).toBe(true);
    expect(isToolExecutionRecord(LEGAL_TOOL_RECORDS.executionRecord)).toBe(true);
    expect(isToolCallRestoreRecord(LEGAL_TOOL_RECORDS.restoreRecord)).toBe(true);
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

  it('rejects a malformed runtime call before history or provider I/O', async () => {
    const result = await executeRuntimeToolCall({ payload: {} } as unknown as Parameters<typeof executeRuntimeToolCall>[0], 'test', 'en');

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'tool_call_payload_invalid', retryable: false },
    });
    expect(chrome.storage.local.get).not.toHaveBeenCalled();
    expect(chrome.storage.local.set).not.toHaveBeenCalled();
  });

  it('rejects malformed records before a bridge consumer sees them', () => {
    const validators = {
      call: isToolCallRecord,
      result: isToolResultRecord,
      provider: isToolProviderIdentity,
      restoreRecord: isToolCallRestoreRecord,
    } as const;
    for (const fixture of MALFORMED_TOOL_RECORDS) {
      expect(fixture.target).toBe('reject-at-T2.1-boundary');
      expect(JSON.parse(JSON.stringify(fixture.record))).toEqual(fixture.record);
      expect(validators[fixture.family](fixture.record)).toBe(false);
    }
    expect(MALFORMED_TOOL_RECORDS.map((fixture) => fixture.currentBehavior)).toEqual([
      'no-authoritative-codec',
      'accepted-by-restore-normalizer',
      'accepted-by-restore-normalizer',
      'consumer-dependent-failure',
    ]);

    const missingSummary = MALFORMED_TOOL_RECORDS[1].record as unknown as ToolCardResult;
    expect(normalizeRestoredToolCardResult(missingSummary)).toEqual(missingSummary);
    const unsupportedProviderExecution = {
      name: 'capture_page',
      provider: MALFORMED_TOOL_RECORDS[2].record,
      result: CONTRACT_EXECUTION_RECORD.result,
    } as unknown as ToolExecutionRecord;
    expect(normalizeRestoredToolExecution(unsupportedProviderExecution).provider)
      .toEqual(MALFORMED_TOOL_RECORDS[2].record);
    const malformedExecution = MALFORMED_TOOL_RECORDS[3].record.executions[0] as ToolExecutionRecord;
    expect(() => normalizeRestoredToolExecution(malformedExecution)).toThrow();

    const payloadWithFunction = { callback: () => 'not serializable', stable: 42 };
    expect(JSON.parse(JSON.stringify(payloadWithFunction))).toEqual({ stable: 42 });
    expect(isToolCallRecord({ ...LEGAL_TOOL_RECORDS.call, payload: payloadWithFunction })).toBe(false);
    const cyclicPayload: Record<string, unknown> = {};
    cyclicPayload.self = cyclicPayload;
    expect(() => JSON.stringify(cyclicPayload)).toThrow();
    expect(isToolCallRecord({ ...LEGAL_TOOL_RECORDS.call, payload: cyclicPayload })).toBe(false);
  });
});
