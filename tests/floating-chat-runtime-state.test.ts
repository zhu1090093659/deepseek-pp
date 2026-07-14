import { describe, expect, it, vi } from 'vitest';
import { resolveFloatingChatRuntimeState } from '../core/floating-chat/runtime-state';

describe('floating chat runtime state', () => {
  it.each([
    [false, false, 'disabled'],
    [false, true, 'disabled'],
    [true, false, 'missing-permission'],
    [true, true, 'ready'],
  ] as const)('maps enabled=%s permission=%s to %s', async (enabled, permission, kind) => {
    const hasHostPermission = vi.fn(async () => permission);
    await expect(resolveFloatingChatRuntimeState({
      readEnabled: async () => enabled,
      hasHostPermission,
      isContextInvalidated: () => false,
    })).resolves.toEqual({ kind });
    expect(hasHostPermission).toHaveBeenCalledTimes(enabled ? 1 : 0);
  });

  it('projects only known context failures to invalidated', async () => {
    await expect(resolveFloatingChatRuntimeState({
      readEnabled: async () => {
        throw new Error('Extension context invalidated.');
      },
      hasHostPermission: async () => true,
      isContextInvalidated: (error) => String(error).includes('context invalidated'),
    })).resolves.toEqual({ kind: 'invalidated' });

    await expect(resolveFloatingChatRuntimeState({
      readEnabled: async () => {
        throw new Error('storage unavailable');
      },
      hasHostPermission: async () => true,
      isContextInvalidated: () => false,
    })).rejects.toThrow('storage unavailable');
  });
});
