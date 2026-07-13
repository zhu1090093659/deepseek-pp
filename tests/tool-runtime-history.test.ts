import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { executeRuntimeToolCall } from './helpers/production-tool-runtime';
import type { ToolCall } from '../core/tool/types';

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

  it('returns the tool result even when history persistence fails', async () => {
    const result = await executeRuntimeToolCall(unsupportedToolCall(), 'manual_chat', 'en');

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('tool_unsupported');
    expect(result.detail).toBe('Unsupported tool: unsupported_tool');
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
});

function unsupportedToolCall(): ToolCall {
  return {
    name: 'unsupported_tool',
    payload: {},
    raw: '<unsupported_tool>{}</unsupported_tool>',
  };
}
