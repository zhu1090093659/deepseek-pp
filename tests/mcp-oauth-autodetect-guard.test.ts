import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { McpServerCreateInput } from '../core/types';
import { withDetectedOAuth } from '../entrypoints/sidepanel/controllers/useMcpPageController';

function createInput(overrides: Partial<McpServerCreateInput> = {}): McpServerCreateInput {
  return {
    displayName: 'Probe Server',
    transport: { kind: 'streamable_http', url: 'https://mcp.example.com/mcp' },
    ...overrides,
  };
}

describe('withDetectedOAuth auto-detect guard', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns the payload untouched and never probes when auto-detect is off', async () => {
    const payload = createInput();
    const result = await withDetectedOAuth(payload, { autoDetect: false });

    expect(result).toBe(payload);
    expect(result.oauth?.enabled).toBeUndefined();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('keeps an already-enabled OAuth config regardless of the guard', async () => {
    const payload = createInput({ oauth: { enabled: true, clientId: 'client' } });
    const result = await withDetectedOAuth(payload, { autoDetect: true });

    expect(result.oauth?.enabled).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('skips probing for non-HTTP transports even when auto-detect is on', async () => {
    const payload = createInput({
      transport: { kind: 'native_messaging', nativeHost: 'com.example.host' },
    });
    const result = await withDetectedOAuth(payload, { autoDetect: true });

    expect(result.oauth).toBeUndefined();
    expect(fetch).not.toHaveBeenCalled();
  });
});
