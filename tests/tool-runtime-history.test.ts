import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBackgroundErrorResponse } from '../core/messaging/background-error';
import {
  ToolProviderRegistry,
  type RuntimeToolProvider,
} from '../core/tool/provider-registry';
import { createRuntimeToolRuntime } from '../core/tool/runtime';
import { executeRuntimeToolCall } from './helpers/production-tool-runtime';
import type {
  ToolCall,
  ToolDescriptor,
  ToolProviderIdentity,
  ToolResult,
} from '../core/tool/types';
import { TOOL_HISTORY_STORAGE_KEY } from '../core/tool/history';

describe('runtime tool history persistence', () => {
  beforeEach(() => {
    vi.stubGlobal('chrome', {
      storage: {
        local: {
          get: vi.fn(async () => ({})),
          set: vi.fn(async () => {
            throw new Error('QUOTA_BYTES quota exceeded');
          }),
        },
      },
    });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('returns the provider result when history exceeds storage quota', async () => {
    const { execute, runtime, call } = createProviderRuntime();
    const result = await runtime.executeToolCall(call, 'test', 'en');

    expect(result).toEqual({ ok: true, summary: 'provider completed' });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(console.warn).toHaveBeenCalledWith(
      '[DeepSeek++] tool history persistence failed',
      expect.any(Error),
    );
  });

  it('rethrows unexpected history failures so new regressions stay visible', async () => {
    vi.stubGlobal('chrome', {
      storage: {
        local: {
          get: vi.fn(async () => ({})),
          set: vi.fn(async () => {
            throw new Error('storage schema mismatch');
          }),
        },
      },
    });

    await expect(executeRuntimeToolCall(unsupportedToolCall(), 'manual_chat', 'en'))
      .rejects.toThrow('storage schema mismatch');
  });

  it('marks a post-provider history write failure as terminal and ambiguous', async () => {
    vi.stubGlobal('chrome', {
      storage: {
        local: {
          get: vi.fn(async () => ({})),
          set: vi.fn(async () => {
            throw new Error('history disk unavailable');
          }),
        },
      },
    });
    const { execute, runtime, call } = createProviderRuntime();

    const error = await runtime.executeToolCall(call, 'test', 'en').catch((failure) => failure);

    expect(execute).toHaveBeenCalledTimes(1);
    expect(error).toMatchObject({
      name: 'ToolPostEffectPersistenceError',
      code: 'tool_post_effect_persistence_failed',
      retryable: false,
      externalOutcome: 'ambiguous',
    });
    expect(createBackgroundErrorResponse(
      { type: 'EXECUTE_TOOL_CALL' },
      error,
      'Tool execution failed',
    )).toMatchObject({
      ok: false,
      error: {
        code: 'tool_post_effect_persistence_failed',
        retryable: false,
        details: { externalOutcome: 'ambiguous' },
      },
    });
  });

  it('preserves corrupt history and reports a non-retryable post-provider failure', async () => {
    const original = { version: 2, records: [] };
    const set = vi.fn();
    vi.stubGlobal('chrome', {
      storage: {
        local: {
          get: vi.fn(async () => ({ [TOOL_HISTORY_STORAGE_KEY]: original })),
          set,
        },
      },
    });
    const { execute, runtime, call } = createProviderRuntime();

    await expect(runtime.executeToolCall(call, 'test', 'en')).rejects.toMatchObject({
      code: 'tool_post_effect_persistence_failed',
      retryable: false,
      externalOutcome: 'ambiguous',
    });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(set).not.toHaveBeenCalled();
    const stored = await chrome.storage.local.get(TOOL_HISTORY_STORAGE_KEY);
    expect(stored[TOOL_HISTORY_STORAGE_KEY]).toBe(original);
  });
});

function unsupportedToolCall(): ToolCall {
  return {
    name: 'unsupported_tool',
    payload: {},
    raw: '<unsupported_tool>{}</unsupported_tool>',
  };
}

function createProviderRuntime(): {
  execute: ReturnType<typeof vi.fn>;
  runtime: ReturnType<typeof createRuntimeToolRuntime>;
  call: ToolCall;
} {
  const provider: ToolProviderIdentity = {
    kind: 'local',
    id: 'history-test',
    displayName: 'History Test',
    transport: 'in_process',
  };
  const descriptor: ToolDescriptor = {
    id: 'local:history-test:write',
    provider,
    name: 'history_test_write',
    invocationName: 'history_test_write',
    title: 'History test write',
    description: 'Exercises post-provider history persistence.',
    inputSchema: { type: 'object' },
    execution: { mode: 'auto', enabled: true, risk: 'low' },
  };
  const execute = vi.fn(async (): Promise<ToolResult> => ({
    ok: true,
    summary: 'provider completed',
  }));
  const runtimeProvider: RuntimeToolProvider = {
    registration: { kind: 'local', id: provider.id },
    listTools: async () => [descriptor],
    execute,
  };

  return {
    execute,
    runtime: createRuntimeToolRuntime(new ToolProviderRegistry([runtimeProvider])),
    call: {
      id: 'history-test-call',
      descriptorId: descriptor.id,
      provider,
      name: descriptor.name,
      invocationName: descriptor.invocationName,
      payload: {},
      raw: '<history_test_write>{}</history_test_write>',
      source: { trigger: 'test', requestId: 'history-test-request' },
    },
  };
}
