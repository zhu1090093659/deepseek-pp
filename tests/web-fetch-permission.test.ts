import { describe, expect, it } from 'vitest';
import {
  isRetryableWebFetchPermissionPrecondition,
  shouldRequestWebFetchPermission,
} from '../core/tool/web-fetch-permission';
import type { ToolCall, ToolResult } from '../core/types';

const denied: ToolResult = {
  ok: false,
  summary: 'Permission required',
  error: {
    code: 'fetch_permission_denied',
    message: 'Permission required',
    retryable: true,
  },
};

describe('web_fetch permission retry identity', () => {
  it('accepts only the canonical local web_fetch call', () => {
    expect(shouldRequestWebFetchPermission(makeCall(), denied)).toBe(true);
    expect(shouldRequestWebFetchPermission(makeCall({
      descriptorId: 'mcp:server:web_fetch',
      provider: { kind: 'mcp', id: 'server', displayName: 'MCP', transport: 'http' },
    }), denied)).toBe(false);
    expect(shouldRequestWebFetchPermission(makeCall({ descriptorId: undefined }), denied)).toBe(false);
    expect(shouldRequestWebFetchPermission(makeCall({ invocationName: 'server__web_fetch' }), denied)).toBe(false);
  });

  it('shares the same descriptor/error precondition with the reservation state', () => {
    expect(isRetryableWebFetchPermissionPrecondition('local:web:web_fetch', denied)).toBe(true);
    expect(isRetryableWebFetchPermissionPrecondition('local:test:web_fetch', denied)).toBe(false);
    expect(isRetryableWebFetchPermissionPrecondition('local:web:web_fetch', {
      ...denied,
      error: { code: 'fetch_failed', message: 'failed', retryable: false },
    })).toBe(false);
  });
});

function makeCall(overrides: Partial<ToolCall> = {}): ToolCall {
  return {
    id: 'call-1',
    descriptorId: 'local:web:web_fetch',
    provider: { kind: 'local', id: 'web', displayName: 'Web', transport: 'in_process' },
    name: 'web_fetch',
    invocationName: 'web_fetch',
    payload: { url: 'https://example.test' },
    raw: '<web_fetch>{"url":"https://example.test"}</web_fetch>',
    ...overrides,
  };
}
