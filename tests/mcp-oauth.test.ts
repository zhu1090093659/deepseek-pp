import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  McpOAuthError,
  authorizeMcpServer,
  getMcpOAuthStatus,
  invalidateMcpOAuthToken,
  isMcpOAuthEnabled,
  isMcpOAuthTransportSupported,
  resolveMcpOAuthAuthorization,
  detectMcpOAuthRequirement,
} from '../core/mcp/oauth-client';
import {
  authorizeMcpOAuthServer,
  disconnectMcpOAuthServer,
  getMcpOAuthStatusForServer,
} from '../core/mcp/oauth-service';
import { createMcpServer, getMcpServerById, updateMcpServer } from '../core/mcp/store';
import { decodeMcpStorageState, encodeMcpStorageState } from '../core/mcp/storage-codec';
import { resolveMcpRequestHeaders, shouldRetryMcpUnauthorized } from '../core/mcp/transports/auth';
import type { McpServerConfig } from '../core/mcp/types';
import type { SyncIdentityPort } from '../core/sync/identity-port';

const SERVER_ID = 'oauth-server';
const REDIRECT_URI = 'https://ext.chromiumapp.org/';

function createServer(overrides: Partial<McpServerConfig> = {}): McpServerConfig {
  return {
    version: 1,
    id: SERVER_ID,
    displayName: 'OAuth Server',
    enabled: true,
    transport: { kind: 'http', url: 'https://mcp.example.com/mcp' },
    headers: [],
    secrets: [],
    oauth: {
      enabled: true,
      clientId: 'client-123',
      authorizationUrl: 'https://auth.example.com/authorize',
      tokenUrl: 'https://auth.example.com/token',
      scopes: ['mcp.read'],
    },
    timeouts: { connectMs: 5_000, requestMs: 60_000, discoveryMs: 10_000 },
    limits: { maxResultBytes: 1_024, maxToolCount: 10 },
    allowlist: { mode: 'all', toolNames: [] },
    execution: { mode: 'auto', enabled: true },
    status: 'unknown',
    lastConnectedAt: null,
    lastError: null,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function jsonResponse(payload: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** Identity port that echoes the request `state` back into the redirect URL. */
function createIdentity(redirect = REDIRECT_URI) {
  const launchWebAuthFlow = vi.fn(async (details: { url: string }) => {
    const authUrl = new URL(details.url);
    return `${redirect}?code=auth-code-1&state=${authUrl.searchParams.get('state') ?? ''}`;
  });
  const identity: SyncIdentityPort = {
    getRedirectUri: () => redirect,
    launchWebAuthFlow,
  };
  return { identity, launchWebAuthFlow };
}

function stubChromeStorage(): Record<string, unknown> {
  const storage: Record<string, unknown> = {};
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: vi.fn(async (key: string) => (Object.prototype.hasOwnProperty.call(storage, key)
          ? { [key]: storage[key] }
          : {})),
        set: vi.fn(async (values: Record<string, unknown>) => {
          Object.assign(storage, values);
        }),
        remove: vi.fn(),
      },
    },
    runtime: { getManifest: () => ({ permissions: ['identity'], version: '1.14.0' }) },
    identity: {
      getRedirectURL: () => REDIRECT_URI,
      launchWebAuthFlow: vi.fn(async (details: { url: string }) => {
        const authUrl = new URL(details.url);
        return `${REDIRECT_URI}?code=service-code&state=${authUrl.searchParams.get('state') ?? ''}`;
      }),
    },
    permissions: { contains: async () => true, request: async () => true },
  });
  return storage;
}

afterEach(() => {
  invalidateMcpOAuthToken(SERVER_ID);
  vi.unstubAllGlobals();
});

describe('MCP OAuth transport gating', () => {
  it('supports HTTP-based transports only', () => {
    for (const kind of ['http', 'sse', 'streamable_http'] as const) {
      const server = createServer({ transport: { kind, url: 'https://mcp.example.com/mcp' } });
      expect(isMcpOAuthTransportSupported(server)).toBe(true);
    }
    for (const kind of ['native_messaging', 'stdio_bridge'] as const) {
      const server = createServer({ transport: { kind, nativeHost: 'com.example.host' } });
      expect(isMcpOAuthTransportSupported(server)).toBe(false);
    }
  });

  it('requires both an enabled oauth config and an HTTP transport', () => {
    expect(isMcpOAuthEnabled(createServer())).toBe(true);
    expect(isMcpOAuthEnabled(createServer({ oauth: undefined }))).toBe(false);
    expect(isMcpOAuthEnabled(createServer({ oauth: { enabled: false } }))).toBe(false);
    expect(isMcpOAuthEnabled(createServer({
      transport: { kind: 'native_messaging', nativeHost: 'com.example.host' },
    }))).toBe(false);
  });
});

describe('MCP OAuth status', () => {
  it('reports an unauthorized server before any authorization', () => {
    expect(getMcpOAuthStatus(createServer())).toEqual({
      enabled: true,
      authorized: false,
      expiresAt: null,
      hasRefreshToken: false,
      scopes: ['mcp.read'],
      authorizationUrl: 'https://auth.example.com/authorize',
    });
  });

  it('exposes a stored refresh token without marking the server authorized', () => {
    const server = createServer({
      oauth: { enabled: true, refreshToken: 'stored-refresh', scopes: [] },
    });
    const status = getMcpOAuthStatus(server);
    expect(status.hasRefreshToken).toBe(true);
    expect(status.authorized).toBe(false);
  });
});

describe('resolveMcpOAuthAuthorization', () => {
  it('returns null when OAuth is not enabled', async () => {
    await expect(resolveMcpOAuthAuthorization(createServer({ oauth: undefined })))
      .resolves
      .toBeNull();
  });

  it('fails non-interactively instead of sending an unauthenticated request', async () => {
    const rejection = await resolveMcpOAuthAuthorization(createServer()).catch((error) => error);
    expect(rejection).toBeInstanceOf(McpOAuthError);
    expect(rejection).toMatchObject({
      code: 'mcp_oauth_authorization_required',
      retryable: true,
    });
  });

  it('transparently refreshes using the durable refresh token', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => jsonResponse({
      access_token: 'refreshed-access',
      token_type: 'Bearer',
      expires_in: 3_600,
    }));
    vi.stubGlobal('fetch', fetchMock);
    const server = createServer({
      oauth: {
        enabled: true,
        clientId: 'client-123',
        authorizationUrl: 'https://auth.example.com/authorize',
        tokenUrl: 'https://auth.example.com/token',
        refreshToken: 'durable-refresh',
      },
    });

    await expect(resolveMcpOAuthAuthorization(server)).resolves.toBe('Bearer refreshed-access');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = String(fetchMock.mock.calls[0][1]?.body);
    expect(body).toContain('grant_type=refresh_token');
    expect(body).toContain('refresh_token=durable-refresh');
    expect(body).toContain('client_id=client-123');
    expect(getMcpOAuthStatus(server).authorized).toBe(true);
  });

  it('reuses a cached access token without refreshing again', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => jsonResponse({
      access_token: 'cached-access',
      token_type: 'Bearer',
      expires_in: 3_600,
    }));
    vi.stubGlobal('fetch', fetchMock);
    const server = createServer({
      oauth: {
        enabled: true,
        clientId: 'client-123',
        authorizationUrl: 'https://auth.example.com/authorize',
        tokenUrl: 'https://auth.example.com/token',
        refreshToken: 'durable-refresh',
      },
    });

    await expect(resolveMcpOAuthAuthorization(server)).resolves.toBe('Bearer cached-access');
    await expect(resolveMcpOAuthAuthorization(server)).resolves.toBe('Bearer cached-access');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('asks for authorization when the refresh fails non-interactively', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: 'invalid_grant' }, 400)));
    const server = createServer({
      oauth: {
        enabled: true,
        clientId: 'client-123',
        authorizationUrl: 'https://auth.example.com/authorize',
        tokenUrl: 'https://auth.example.com/token',
        refreshToken: 'stale-refresh',
      },
    });

    await expect(resolveMcpOAuthAuthorization(server)).rejects.toMatchObject({
      code: 'mcp_oauth_authorization_required',
    });
    expect(getMcpOAuthStatus(server).authorized).toBe(false);
  });

  it('runs the PKCE authorization-code flow when interactive', async () => {
    const { identity, launchWebAuthFlow } = createIdentity();
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      if (String(input) === 'https://auth.example.com/token') {
        return jsonResponse({
          access_token: 'interactive-access',
          token_type: 'Bearer',
          expires_in: 3_600,
          refresh_token: 'interactive-refresh',
        });
      }
      throw new Error(`Unexpected fetch: ${String(input)}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(resolveMcpOAuthAuthorization(createServer(), { interactive: true, identity }))
      .resolves
      .toBe('Bearer interactive-access');

    const authUrl = new URL(launchWebAuthFlow.mock.calls[0][0].url);
    expect(`${authUrl.origin}${authUrl.pathname}`).toBe('https://auth.example.com/authorize');
    expect(authUrl.searchParams.get('response_type')).toBe('code');
    expect(authUrl.searchParams.get('client_id')).toBe('client-123');
    expect(authUrl.searchParams.get('code_challenge_method')).toBe('S256');
    expect(authUrl.searchParams.get('code_challenge')).toBeTruthy();
    expect(authUrl.searchParams.get('redirect_uri')).toBe(REDIRECT_URI);
    expect(authUrl.searchParams.get('scope')).toBe('mcp.read');
    expect(authUrl.searchParams.get('state')).toBeTruthy();

    const tokenBody = String(fetchMock.mock.calls[0][1]?.body);
    expect(tokenBody).toContain('grant_type=authorization_code');
    expect(tokenBody).toContain('code=auth-code-1');
    expect(tokenBody).toContain('code_verifier=');
  });
});

describe('authorizeMcpServer', () => {
  it('rejects when OAuth is not configured', async () => {
    await expect(authorizeMcpServer(createServer({ oauth: undefined })))
      .rejects
      .toMatchObject({ code: 'mcp_oauth_not_configured' });
  });

  it('returns the access and refresh tokens from the interactive flow', async () => {
    const { identity } = createIdentity();
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
      access_token: 'access-123',
      token_type: 'Bearer',
      expires_in: 1_800,
      refresh_token: 'refresh-123',
      scope: 'mcp.read',
    })));

    await expect(authorizeMcpServer(createServer(), { identity })).resolves.toMatchObject({
      accessToken: 'access-123',
      refreshToken: 'refresh-123',
      scope: 'mcp.read',
    });
  });

  it('surfaces a state mismatch as a provider error', async () => {
    const identity: SyncIdentityPort = {
      getRedirectUri: () => REDIRECT_URI,
      launchWebAuthFlow: vi.fn(async () => `${REDIRECT_URI}?code=auth-code-1&state=wrong-state`),
    };
    vi.stubGlobal('fetch', vi.fn());

    await expect(authorizeMcpServer(createServer(), { identity }))
      .rejects
      .toMatchObject({ code: 'mcp_oauth_provider_error' });
  });

  it('surfaces a provider error response', async () => {
    const identity: SyncIdentityPort = {
      getRedirectUri: () => REDIRECT_URI,
      launchWebAuthFlow: vi.fn(async () => `${REDIRECT_URI}?error=access_denied`),
    };
    vi.stubGlobal('fetch', vi.fn());

    await expect(authorizeMcpServer(createServer(), { identity }))
      .rejects
      .toMatchObject({ code: 'mcp_oauth_provider_error' });
  });

  it('reports cancellation when the identity flow returns no redirect url', async () => {
    const identity: SyncIdentityPort = {
      getRedirectUri: () => REDIRECT_URI,
      launchWebAuthFlow: vi.fn(async () => undefined),
    };

    await expect(authorizeMcpServer(createServer(), { identity }))
      .rejects
      .toMatchObject({ code: 'mcp_oauth_authorization_cancelled' });
  });

  it('reports an unavailable identity port without a browser identity', async () => {
    await expect(authorizeMcpServer(createServer(), { identity: null }))
      .rejects
      .toMatchObject({ code: 'mcp_oauth_identity_unavailable' });
  });
});

describe('OAuth-owned request headers', () => {
  it('keeps static headers and returns them untouched when OAuth is disabled', async () => {
    const server = createServer({
      oauth: undefined,
      secrets: [{ kind: 'bearer', value: 'static-token' }],
    });

    await expect(resolveMcpRequestHeaders(server)).resolves.toEqual({
      Authorization: 'Bearer static-token',
    });
  });

  it('throws instead of sending an unauthenticated request for a protected server', async () => {
    await expect(resolveMcpRequestHeaders(createServer())).rejects.toMatchObject({
      code: 'mcp_oauth_authorization_required',
    });
  });

  it('lets OAuth own the Authorization header over a static secret', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
      access_token: 'oauth-access',
      token_type: 'Bearer',
      expires_in: 3_600,
    })));
    const server = createServer({
      secrets: [{ kind: 'bearer', value: 'static-token' }],
      oauth: {
        enabled: true,
        clientId: 'client-123',
        authorizationUrl: 'https://auth.example.com/authorize',
        tokenUrl: 'https://auth.example.com/token',
        refreshToken: 'durable-refresh',
      },
    });

    await expect(resolveMcpRequestHeaders(server)).resolves.toMatchObject({
      Authorization: 'Bearer oauth-access',
    });
  });

  it('invalidates the cached token after a 401 so the next attempt refreshes', () => {
    const server = createServer();
    expect(shouldRetryMcpUnauthorized(server, 401)).toBe(true);
    expect(shouldRetryMcpUnauthorized(server, 200)).toBe(false);
    expect(shouldRetryMcpUnauthorized(createServer({ oauth: undefined }), 401)).toBe(false);
  });
});

describe('background OAuth orchestration', () => {
  beforeEach(() => {
    stubChromeStorage();
  });

  it('persists the refresh token and clears it on disconnect', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
      access_token: 'service-access',
      token_type: 'Bearer',
      expires_in: 3_600,
      refresh_token: 'service-refresh',
    })));
    const created = await createMcpServer({
      displayName: 'Service OAuth Server',
      transport: { kind: 'http', url: 'https://service.example.com/mcp' },
      oauth: {
        enabled: true,
        clientId: 'client-123',
        authorizationUrl: 'https://auth.example.com/authorize',
        tokenUrl: 'https://auth.example.com/token',
      },
    });

    const result = await authorizeMcpOAuthServer(created.id);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.status.authorized).toBe(true);

    const withSecrets = await getMcpServerById(created.id, { includeSecrets: true });
    expect(withSecrets?.oauth?.refreshToken).toBe('service-refresh');

    const sanitized = await getMcpServerById(created.id);
    expect(sanitized?.oauth?.refreshToken).toBe('********');

    await expect(getMcpOAuthStatusForServer(created.id)).resolves.toMatchObject({
      hasRefreshToken: true,
      authorized: true,
    });

    await disconnectMcpOAuthServer(created.id);
    const afterDisconnect = await getMcpServerById(created.id, { includeSecrets: true });
    expect(afterDisconnect?.oauth?.refreshToken).toBeUndefined();
  });

  it('reports mcp_oauth_not_configured for a server without OAuth', async () => {
    const created = await createMcpServer({
      displayName: 'Plain Server',
      transport: { kind: 'native_messaging', nativeHost: 'com.example.plain' },
    });

    await expect(authorizeMcpOAuthServer(created.id)).resolves.toEqual({
      ok: false,
      error: 'mcp_oauth_not_configured',
    });
  });

  it('reports a missing server instead of throwing', async () => {
    await expect(authorizeMcpOAuthServer('missing-server')).resolves.toEqual({
      ok: false,
      error: 'mcp_server_not_found',
    });
    await expect(getMcpOAuthStatusForServer('missing-server')).resolves.toBeNull();
  });
});

describe('OAuth config redaction', () => {
  beforeEach(() => {
    stubChromeStorage();
  });

  it('redacts client secret and refresh token in sanitized reads', async () => {
    const created = await createMcpServer({
      displayName: 'Secret Server',
      transport: { kind: 'http', url: 'https://secret.example.com/mcp' },
      oauth: {
        enabled: true,
        clientId: 'client-123',
        clientSecret: 'top-secret',
        refreshToken: 'top-refresh',
      },
    });
    expect(created.oauth?.clientSecret).toBe('********');
    expect(created.oauth?.refreshToken).toBe('********');

    const raw = await getMcpServerById(created.id, { includeSecrets: true });
    expect(raw?.oauth?.clientSecret).toBe('top-secret');
    expect(raw?.oauth?.refreshToken).toBe('top-refresh');
  });

  it('preserves redacted secrets when updating unrelated OAuth fields', async () => {
    const created = await createMcpServer({
      displayName: 'Preserve Server',
      transport: { kind: 'http', url: 'https://preserve.example.com/mcp' },
      oauth: { enabled: true, clientId: 'client-123', clientSecret: 'keep-me' },
    });
    const sanitized = await getMcpServerById(created.id);
    if (!sanitized?.oauth) throw new Error('Missing OAuth config.');

    const updated = await updateMcpServer(created.id, {
      oauth: { ...sanitized.oauth, scopes: ['mcp.read'] },
    });
    expect(updated?.oauth?.scopes).toEqual(['mcp.read']);

    const raw = await getMcpServerById(created.id, { includeSecrets: true });
    expect(raw?.oauth?.clientSecret).toBe('keep-me');
  });
});

describe('OAuth storage codec', () => {
  it('round-trips an OAuth-enabled server without changing the record', () => {
    const raw = {
      version: 2,
      servers: [
        createServer({
          oauth: {
            enabled: true,
            clientId: 'client-123',
            authorizationUrl: 'https://auth.example.com/authorize',
            tokenUrl: 'https://auth.example.com/token',
            scopes: ['mcp.read'],
          },
        }),
      ],
      toolCaches: [],
    };

    const decoded = decodeMcpStorageState(raw);
    expect(encodeMcpStorageState(decoded)).toEqual(raw);
  });
});

describe('detectMcpOAuthRequirement', () => {
  beforeEach(() => {
    stubChromeStorage();
  });

  it('reports no OAuth when the endpoint answers without a 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ jsonrpc: '2.0', id: 'oauth-probe', result: {} })));
    const detection = await detectMcpOAuthRequirement(createServer());
    expect(detection.requiresOAuth).toBe(false);
    expect(detection.metadataDetected).toBe(false);
  });

  it('flags a 401 Bearer challenge as requiring OAuth', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', {
      status: 401,
      headers: { 'www-authenticate': 'Bearer realm="mcp"' },
    })));
    const detection = await detectMcpOAuthRequirement(createServer());
    expect(detection.requiresOAuth).toBe(true);
    expect(detection.challenge).toContain('Bearer');
    expect(detection.metadataDetected).toBe(false);
  });

  it('resolves authorization-server metadata from the challenge', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const target = String(input);
      if (target === 'https://mcp.example.com/mcp') {
        return new Response('', {
          status: 401,
          headers: {
            'www-authenticate': 'Bearer resource_metadata="https://mcp.example.com/.well-known/oauth-protected-resource"',
          },
        });
      }
      if (target === 'https://mcp.example.com/.well-known/oauth-protected-resource') {
        return jsonResponse({
          authorization_servers: ['https://auth.example.com'],
          scopes_supported: ['mcp.read'],
        });
      }
      if (target === 'https://auth.example.com/.well-known/oauth-authorization-server') {
        return jsonResponse({
          authorization_endpoint: 'https://auth.example.com/authorize',
          token_endpoint: 'https://auth.example.com/token',
          registration_endpoint: 'https://auth.example.com/register',
        });
      }
      throw new Error('Unexpected fetch: ' + target);
    });
    vi.stubGlobal('fetch', fetchMock);

    const detection = await detectMcpOAuthRequirement(createServer({ oauth: undefined }));
    expect(detection.requiresOAuth).toBe(true);
    expect(detection.metadataDetected).toBe(true);
    expect(detection.authorizationUrl).toBe('https://auth.example.com/authorize');
    expect(detection.tokenUrl).toBe('https://auth.example.com/token');
    expect(detection.registrationUrl).toBe('https://auth.example.com/register');
  });

  it('skips detection for non-HTTP transports', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const detection = await detectMcpOAuthRequirement(createServer({
      transport: { kind: 'native_messaging', nativeHost: 'com.example.host' },
    }));
    expect(detection.requiresOAuth).toBe(false);
    expect(detection.reason).toBe('unsupported_transport');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
