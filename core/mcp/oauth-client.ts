import {
  getCurrentSyncIdentityPort,
  type SyncIdentityPort,
} from '../sync/identity-port';
import type { McpOAuthConfig, McpServerConfig, McpServerId } from './types';

/**
 * MCP OAuth 2.1 (+ PKCE) client.
 *
 * MCP servers that require OAuth advertise a protected-resource metadata
 * document and issue a 401 with a `WWW-Authenticate: Bearer` challenge. This
 * module discovers the authorization server, runs the authorization-code flow
 * with PKCE through the shared browser identity port, and caches access tokens
 * in memory.
 *
 * The durable credential is the refresh token, which is persisted on the
 * server's oauth config (redacted like every other secret). Access tokens are
 * never persisted and are additionally bound to a non-logged fingerprint of
 * the client credentials, so a changed client id/secret can never reuse a
 * stale cache entry.
 */

const TOKEN_REFRESH_SKEW_MS = 60_000;
const OAUTH_REQUEST_TIMEOUT_MS = 20_000;

export type McpOAuthErrorCode =
  | 'mcp_oauth_not_configured'
  | 'mcp_oauth_identity_unavailable'
  | 'mcp_oauth_metadata_failed'
  | 'mcp_oauth_registration_failed'
  | 'mcp_oauth_authorization_required'
  | 'mcp_oauth_authorization_cancelled'
  | 'mcp_oauth_provider_error'
  | 'mcp_oauth_missing_code'
  | 'mcp_oauth_token_exchange_failed'
  | 'mcp_oauth_refresh_failed';

export class McpOAuthError extends Error {
  readonly code: McpOAuthErrorCode;
  readonly retryable: boolean;

  constructor(code: McpOAuthErrorCode, message: string, options?: { retryable?: boolean }) {
    super(message);
    this.name = 'McpOAuthError';
    this.code = code;
    this.retryable = options?.retryable ?? false;
  }
}

export interface McpOAuthStatus {
  /** True when the server declares OAuth and uses an HTTP-based transport. */
  enabled: boolean;
  /** True when a currently-usable access token exists in the in-memory cache. */
  authorized: boolean;
  expiresAt: number | null;
  hasRefreshToken: boolean;
  scopes: string[];
  authorizationUrl: string | null;
}

interface CachedOAuthToken {
  accessToken: string;
  tokenType: string;
  scope?: string;
  /** Epoch ms; null when the provider did not advertise an expiry. */
  expiresAt: number | null;
  refreshToken?: string;
  credentialFingerprint: string;
}

interface ResolvedOAuthMetadata {
  authorizationUrl: string;
  tokenUrl: string;
  registrationUrl?: string;
  scopes: string[];
  resource?: string;
}

const tokenCache = new Map<McpServerId, CachedOAuthToken>();

/** OAuth only applies to HTTP-based transports; native/stdio paths are local. */
export function isMcpOAuthTransportSupported(server: McpServerConfig): boolean {
  return server.transport.kind === 'http'
    || server.transport.kind === 'sse'
    || server.transport.kind === 'streamable_http';
}

export function isMcpOAuthEnabled(server: McpServerConfig): boolean {
  return server.oauth?.enabled === true && isMcpOAuthTransportSupported(server);
}

export function getMcpOAuthStatus(server: McpServerConfig): McpOAuthStatus {
  const enabled = isMcpOAuthEnabled(server);
  const cached = tokenCache.get(server.id);
  return {
    enabled,
    authorized: Boolean(cached && isTokenFresh(cached)),
    expiresAt: cached?.expiresAt ?? null,
    hasRefreshToken: Boolean(server.oauth?.refreshToken),
    scopes: server.oauth?.scopes ?? [],
    authorizationUrl: server.oauth?.authorizationUrl ?? null,
  };
}

/** Drop a cached access token (e.g. after a 401) so the next call refreshes. */
export function invalidateMcpOAuthToken(serverId: McpServerId): void {
  tokenCache.delete(serverId);
}

function isTokenFresh(entry: CachedOAuthToken): boolean {
  if (entry.expiresAt === null) return true;
  return Date.now() < entry.expiresAt - TOKEN_REFRESH_SKEW_MS;
}

/**
 * Resolve the Authorization header for an OAuth-protected MCP server.
 *
 * Returns null when the server does not use OAuth (static secrets keep
 * owning the header). When interactive is false and no usable token exists,
 * throws `mcp_oauth_authorization_required` so callers can prompt the user
 * instead of silently sending an unauthenticated request.
 */
export async function resolveMcpOAuthAuthorization(
  server: McpServerConfig,
  options: { interactive?: boolean; signal?: AbortSignal; identity?: SyncIdentityPort | null } = {},
): Promise<string | null> {
  if (!isMcpOAuthEnabled(server)) return null;

  const cached = tokenCache.get(server.id);
  const fingerprint = await fingerprintCredentials(server.oauth);
  if (cached && cached.credentialFingerprint === fingerprint && isTokenFresh(cached)) {
    return `${cached.tokenType || 'Bearer'} ${cached.accessToken}`;
  }

  // Try a transparent refresh when a durable refresh token exists.
  const refreshToken = server.oauth?.refreshToken;
  if (refreshToken) {
    try {
      const refreshed = await refreshAccessToken(server, refreshToken, fingerprint, options.signal);
      tokenCache.set(server.id, refreshed);
      return `${refreshed.tokenType || 'Bearer'} ${refreshed.accessToken}`;
    } catch (error) {
      if (!options.interactive) {
        invalidateMcpOAuthToken(server.id);
        throw new McpOAuthError(
          'mcp_oauth_authorization_required',
          'MCP OAuth authorization is required. Authorize this server, then retry.',
          { retryable: true },
        );
      }
      // Fall through to a fresh interactive authorization.
    }
  }

  if (!options.interactive) {
    throw new McpOAuthError(
      'mcp_oauth_authorization_required',
      'MCP OAuth authorization is required. Authorize this server, then retry.',
      { retryable: true },
    );
  }

  const authorized = await runInteractiveAuthorization(server, options);
  return `${authorized.tokenType || 'Bearer'} ${authorized.accessToken}`;
}

/**
 * Run the full interactive authorization flow and return the fresh token.
 * The caller is responsible for persisting the returned refresh token onto the
 * server config; this module never writes storage itself.
 */
export async function authorizeMcpServer(
  server: McpServerConfig,
  options: { signal?: AbortSignal; identity?: SyncIdentityPort | null } = {},
): Promise<{ accessToken: string; refreshToken?: string; expiresAt: number | null; scope?: string }> {
  if (!server.oauth?.enabled) {
    throw new McpOAuthError('mcp_oauth_not_configured', 'OAuth is not enabled for this MCP server.');
  }
  const token = await runInteractiveAuthorization(server, options);
  return {
    accessToken: token.accessToken,
    refreshToken: token.refreshToken,
    expiresAt: token.expiresAt,
    scope: token.scope,
  };
}

async function runInteractiveAuthorization(
  server: McpServerConfig,
  options: { signal?: AbortSignal; identity?: SyncIdentityPort | null },
): Promise<CachedOAuthToken> {
  const identity = options.identity ?? getCurrentSyncIdentityPort();
  if (!identity) {
    throw new McpOAuthError(
      'mcp_oauth_identity_unavailable',
      'OAuth authorization is not available in this browser context.',
    );
  }
  const metadata = await resolveOAuthMetadata(server, options.signal);
  const clientId = await ensureClientId(server, metadata, options.signal);
  const redirectUri = identity.getRedirectUri();
  const codeVerifier = createCodeVerifier();
  const codeChallenge = await createCodeChallenge(codeVerifier);
  const state = createRandomToken();

  const authUrl = new URL(metadata.authorizationUrl);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('code_challenge', codeChallenge);
  authUrl.searchParams.set('code_challenge_method', 'S256');
  authUrl.searchParams.set('state', state);
  if (metadata.scopes.length > 0) authUrl.searchParams.set('scope', metadata.scopes.join(' '));
  if (metadata.resource) authUrl.searchParams.set('resource', metadata.resource);

  const redirectUrl = await identity.launchWebAuthFlow({ url: authUrl.toString(), interactive: true });
  if (!redirectUrl) {
    throw new McpOAuthError('mcp_oauth_authorization_cancelled', 'MCP OAuth authorization was cancelled.');
  }
  const parsed = parseRedirectUrl(redirectUrl);
  if (parsed.error) {
    throw new McpOAuthError(
      'mcp_oauth_provider_error',
      `MCP OAuth provider returned an error: ${parsed.error}`,
    );
  }
  if (parsed.state && parsed.state !== state) {
    throw new McpOAuthError('mcp_oauth_provider_error', 'MCP OAuth state did not match.');
  }
  if (!parsed.code) {
    throw new McpOAuthError('mcp_oauth_missing_code', 'MCP OAuth provider did not return an authorization code.');
  }

  const fingerprint = await fingerprintCredentials(server.oauth);
  const token = await exchangeCodeForToken(server, metadata, {
    code: parsed.code,
    codeVerifier,
    redirectUri,
    clientId,
    signal: options.signal,
  });
  const entry: CachedOAuthToken = { ...token, credentialFingerprint: fingerprint };
  tokenCache.set(server.id, entry);
  return entry;
}

async function refreshAccessToken(
  server: McpServerConfig,
  refreshToken: string,
  fingerprint: string,
  signal?: AbortSignal,
): Promise<CachedOAuthToken> {
  const metadata = await resolveOAuthMetadata(server, signal);
  const clientId = await ensureClientId(server, metadata, signal);
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: clientId,
  });
  if (server.oauth?.clientSecret) body.set('client_secret', server.oauth.clientSecret);
  if (metadata.resource) body.set('resource', metadata.resource);

  const payload = await postForm(metadata.tokenUrl, body, signal);
  if (!payload?.access_token) {
    throw new McpOAuthError(
      'mcp_oauth_refresh_failed',
      'MCP OAuth token refresh did not return an access token.',
      { retryable: true },
    );
  }
  return {
    accessToken: String(payload.access_token),
    tokenType: typeof payload.token_type === 'string' ? payload.token_type : 'Bearer',
    scope: typeof payload.scope === 'string' ? payload.scope : undefined,
    expiresAt: toExpiry(payload.expires_in),
    refreshToken: typeof payload.refresh_token === 'string' ? payload.refresh_token : refreshToken,
    credentialFingerprint: fingerprint,
  };
}

async function exchangeCodeForToken(
  server: McpServerConfig,
  metadata: ResolvedOAuthMetadata,
  input: { code: string; codeVerifier: string; redirectUri: string; clientId: string; signal?: AbortSignal },
): Promise<Omit<CachedOAuthToken, 'credentialFingerprint'>> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: input.code,
    code_verifier: input.codeVerifier,
    redirect_uri: input.redirectUri,
    client_id: input.clientId,
  });
  if (server.oauth?.clientSecret) body.set('client_secret', server.oauth.clientSecret);
  if (metadata.resource) body.set('resource', metadata.resource);

  const payload = await postForm(metadata.tokenUrl, body, input.signal);
  if (!payload?.access_token) {
    throw new McpOAuthError(
      'mcp_oauth_token_exchange_failed',
      'MCP OAuth token exchange did not return an access token.',
    );
  }
  return {
    accessToken: String(payload.access_token),
    tokenType: typeof payload.token_type === 'string' ? payload.token_type : 'Bearer',
    scope: typeof payload.scope === 'string' ? payload.scope : undefined,
    expiresAt: toExpiry(payload.expires_in),
    refreshToken: typeof payload.refresh_token === 'string' ? payload.refresh_token : undefined,
  };
}

async function ensureClientId(
  server: McpServerConfig,
  metadata: ResolvedOAuthMetadata,
  signal?: AbortSignal,
): Promise<string> {
  if (server.oauth?.clientId) return server.oauth.clientId;
  // Dynamic client registration (RFC 7591) is required by the MCP spec for
  // servers that do not hand out a static client id. It is best-effort: when
  // the server publishes no registration endpoint the caller sees a clear
  // error instead of a malformed authorization request.
  if (!metadata.registrationUrl) {
    throw new McpOAuthError(
      'mcp_oauth_registration_failed',
      'MCP OAuth requires a client id, but the server does not support dynamic client registration.',
    );
  }
  const identity = getCurrentSyncIdentityPort();
  const redirectUri = identity?.getRedirectUri() ?? undefined;
  const payload = await postJson(metadata.registrationUrl, {
    client_name: 'DeepSeek++',
    redirect_uris: redirectUri ? [redirectUri] : [],
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
    scope: metadata.scopes.join(' ') || undefined,
  }, signal);
  if (typeof payload?.client_id !== 'string' || !payload.client_id) {
    throw new McpOAuthError(
      'mcp_oauth_registration_failed',
      'MCP OAuth dynamic client registration did not return a client id.',
    );
  }
  return payload.client_id;
}

async function resolveOAuthMetadata(
  server: McpServerConfig,
  signal?: AbortSignal,
): Promise<ResolvedOAuthMetadata> {
  const oauth = server.oauth ?? { enabled: false };
  const resource = oauth.resource ?? server.transport.url ?? undefined;

  if (oauth.authorizationUrl && oauth.tokenUrl) {
    return {
      authorizationUrl: oauth.authorizationUrl,
      tokenUrl: oauth.tokenUrl,
      registrationUrl: oauth.registrationUrl,
      scopes: oauth.scopes ?? [],
      resource,
    };
  }

  // Discover the authorization server via protected-resource metadata.
  const endpoint = server.transport.url;
  if (!endpoint) {
    throw new McpOAuthError(
      'mcp_oauth_metadata_failed',
      'MCP OAuth metadata cannot be discovered without a service URL.',
    );
  }
  const origin = new URL(endpoint).origin;
  const protectedResource = await fetchJson(
    `${origin}/.well-known/oauth-protected-resource`,
    signal,
  );
  const authorizationServer = Array.isArray(protectedResource?.authorization_servers)
    ? protectedResource.authorization_servers.find((value): value is string => typeof value === 'string')
    : undefined;
  if (!authorizationServer) {
    throw new McpOAuthError(
      'mcp_oauth_metadata_failed',
      'MCP OAuth protected-resource metadata did not advertise an authorization server.',
    );
  }
  const metadataUrl = new URL('/.well-known/oauth-authorization-server', authorizationServer).toString();
  const metadata = await fetchJson(metadataUrl, signal);
  const authorizationUrl = pickString(metadata?.authorization_endpoint) ?? oauth.authorizationUrl;
  const tokenUrl = pickString(metadata?.token_endpoint) ?? oauth.tokenUrl;
  if (!authorizationUrl || !tokenUrl) {
    throw new McpOAuthError(
      'mcp_oauth_metadata_failed',
      'MCP OAuth authorization-server metadata is missing required endpoints.',
    );
  }
  const scopes = oauth.scopes && oauth.scopes.length > 0
    ? oauth.scopes
    : parseScopes(protectedResource?.scopes_supported) ?? parseScopes(metadata?.scopes_supported) ?? [];
  return {
    authorizationUrl,
    tokenUrl,
    registrationUrl: pickString(metadata?.registration_endpoint) ?? oauth.registrationUrl,
    scopes,
    resource: resource ?? pickString(metadata?.resource),
  };
}

async function postForm(
  url: string,
  body: URLSearchParams,
  signal?: AbortSignal,
): Promise<Record<string, unknown> | null> {
  const response = await fetchWithTimeout(url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: body.toString(),
    signal,
  });
  return readJsonBody(response);
}

async function postJson(
  url: string,
  body: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<Record<string, unknown> | null> {
  const response = await fetchWithTimeout(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  return readJsonBody(response);
}

async function fetchJson(url: string, signal?: AbortSignal): Promise<Record<string, unknown> | null> {
  const response = await fetchWithTimeout(url, {
    method: 'GET',
    headers: { accept: 'application/json' },
    signal,
  });
  return readJsonBody(response);
}

async function fetchWithTimeout(url: string, init: RequestInit, signal?: AbortSignal): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), OAUTH_REQUEST_TIMEOUT_MS);
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', onAbort);
  }
}

async function readJsonBody(response: Response): Promise<Record<string, unknown> | null> {
  if (!response.ok) {
    throw new McpOAuthError(
      'mcp_oauth_metadata_failed',
      `MCP OAuth endpoint returned HTTP ${response.status}.`,
      { retryable: response.status >= 500 },
    );
  }
  try {
    const value = await response.json();
    return value && typeof value === 'object' ? value as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function parseRedirectUrl(redirectUrl: string): { code?: string; state?: string; error?: string } {
  const url = new URL(redirectUrl);
  const params = new URLSearchParams(url.hash ? url.hash.slice(1) : url.search);
  return {
    code: params.get('code') ?? undefined,
    state: params.get('state') ?? undefined,
    error: params.get('error') ?? undefined,
  };
}

function toExpiry(expiresIn: unknown): number | null {
  const seconds = typeof expiresIn === 'number' ? expiresIn : Number(expiresIn);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return Date.now() + seconds * 1000;
}

function pickString(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

function parseScopes(value: unknown): string[] | undefined {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.length > 0)
    : undefined;
}

function createCodeVerifier(): string {
  return base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)));
}

async function createCodeChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64UrlEncode(new Uint8Array(digest));
}

function createRandomToken(): string {
  return base64UrlEncode(crypto.getRandomValues(new Uint8Array(16)));
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function fingerprintCredentials(oauth: McpOAuthConfig | undefined): Promise<string> {
  const material = `${oauth?.clientId ?? ''}\u0000${oauth?.clientSecret ?? ''}`;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(material));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
