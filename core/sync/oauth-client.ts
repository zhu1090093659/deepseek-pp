import { DEFAULT_LOCALE, translate, type LocaleMessageKey, type MessageParams } from '../i18n';

/**
 * Shared OAuth helpers for cloud-sync providers (Google Drive, OneDrive).
 *
 * Both providers use user-supplied OAuth credentials and the
 * chrome.identity.launchWebAuthFlow authorization-code flow (not getAuthToken,
 * which requires a client_id baked into the manifest). Access tokens are cached
 * in-memory and refreshed transparently when they expire.
 */

// Lazily computed: chrome.identity is only available in the extension runtime,
// and evaluating it at module top-level breaks unit tests that import this
// module transitively without a chrome mock.
let cachedRedirectUri: string | null = null;

export type SyncErrorTranslator = (key: LocaleMessageKey, params?: MessageParams) => string;

export function defaultSyncErrorTranslator(key: LocaleMessageKey, params?: MessageParams): string {
  return translate(DEFAULT_LOCALE, key, params);
}

export function getOptionalRedirectUri(): string | null {
  const identity = getChromeIdentity();
  if (!identity) return null;
  if (cachedRedirectUri === null) {
    cachedRedirectUri = identity.getRedirectURL();
  }
  return cachedRedirectUri;
}

export function getRedirectUri(t: SyncErrorTranslator = defaultSyncErrorTranslator): string {
  const redirectUri = getOptionalRedirectUri();
  if (!redirectUri) {
    throw new Error(t('background.sync.identityUnavailable'));
  }
  return redirectUri;
}

function getChromeIdentity(): Pick<typeof chrome.identity, 'getRedirectURL'> | null {
  if (typeof chrome === 'undefined') return null;
  if (!chrome.identity || typeof chrome.identity.getRedirectURL !== 'function') return null;
  return chrome.identity;
}

/** Parsed redirect URL: either {code} on success or {error} on failure. */
interface RedirectResult {
  code?: string;
  error?: string;
}

function parseRedirectUrl(redirectUrl: string): RedirectResult {
  const url = new URL(redirectUrl);
  const params = new URLSearchParams(url.hash ? url.hash.slice(1) : url.search);
  return {
    code: params.get('code') ?? undefined,
    error: params.get('error') ?? undefined,
  };
}

/**
 * Run the OAuth authorization-code flow interactively and return the code.
 * Throws if the user cancels or the provider returns an error.
 */
export async function runAuthCodeFlow(
  authUrl: string,
  t: SyncErrorTranslator = defaultSyncErrorTranslator,
): Promise<string> {
  const redirectUrl = await chrome.identity.launchWebAuthFlow({
    url: authUrl,
    interactive: true,
  });
  if (!redirectUrl) {
    throw new Error(t('background.sync.oauthCancelled'));
  }
  const result = parseRedirectUrl(redirectUrl);
  if (result.error) {
    throw new Error(t('background.sync.oauthProviderError', { error: result.error }));
  }
  if (!result.code) {
    throw new Error(t('background.sync.oauthMissingCode'));
  }
  return result.code;
}

export interface TokenResponse {
  accessToken: string;
  expiresIn: number; // seconds
  refreshToken?: string; // present on first authorization
}

interface CachedToken {
  accessToken: string;
  expiresAt: number; // epoch ms
  credentialFingerprint: string;
}

/**
 * In-memory token cache keyed by a stable identifier (client_id + provider),
 * with each entry additionally bound to the refresh-token identity. The raw
 * durable credential is never copied into the cache key or logs.
 * Each background instance lives for the extension session; tokens are not
 * persisted—refresh_token is the durable credential and lives in SyncConfig.
 */
const tokenCache = new Map<string, CachedToken>();

function isCacheValid(entry: CachedToken | undefined): boolean {
  if (!entry) return false;
  // Refresh 60s before actual expiry to avoid edge-case 401s.
  return Date.now() < entry.expiresAt - 60_000;
}

/**
 * Obtain a usable access token, refreshing when absent or expired.
 *
 * @param cacheKey stable key (e.g. `gdrive:${clientId}`)
 * @param refreshToken durable refresh token
 * @param refreshUrl provider token endpoint
 * @param tokenParams body params for the refresh request
 */
export async function getAccessToken(
  cacheKey: string,
  refreshToken: string,
  refreshUrl: string,
  tokenParams: Record<string, string>,
  t: SyncErrorTranslator = defaultSyncErrorTranslator,
): Promise<string> {
  const credentialFingerprint = await fingerprintCredential(refreshToken);
  const cached = tokenCache.get(cacheKey);
  if (isCacheValid(cached) && cached?.credentialFingerprint === credentialFingerprint) {
    return cached.accessToken;
  }
  if (cached) tokenCache.delete(cacheKey);

  const body = new URLSearchParams({ ...tokenParams, refresh_token: refreshToken, grant_type: 'refresh_token' });
  const res = await fetch(refreshUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(t('background.sync.oauthRefreshFailed', {
      status: res.status,
      detail: detail ? `: ${detail}` : '',
    }));
  }
  const token = await res.json() as { access_token: string; expires_in: number };
  const entry: CachedToken = {
    accessToken: token.access_token,
    expiresAt: Date.now() + token.expires_in * 1000,
    credentialFingerprint,
  };
  tokenCache.set(cacheKey, entry);
  return entry.accessToken;
}

async function fingerprintCredential(value: string): Promise<string> {
  const cryptoApi = globalThis.crypto;
  if (!cryptoApi?.subtle) throw new Error('Web Crypto SHA-256 is required for OAuth token caching');
  const digest = await cryptoApi.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Drop a cached token (e.g. on a 401, to force refresh on next call). */
export function invalidateToken(cacheKey: string): void {
  tokenCache.delete(cacheKey);
}

/**
 * Run an authenticated request, retrying once with a fresh token on 401.
 */
export async function authedFetch(
  cacheKey: string,
  refreshToken: string,
  refreshUrl: string,
  refreshParams: Record<string, string>,
  input: string,
  init: RequestInit,
  t: SyncErrorTranslator = defaultSyncErrorTranslator,
): Promise<Response> {
  const token = await getAccessToken(cacheKey, refreshToken, refreshUrl, refreshParams, t);
  const res = await fetch(input, {
    ...init,
    headers: { ...(init.headers as Record<string, string> | undefined), Authorization: `Bearer ${token}` },
  });
  if (res.status === 401) {
    invalidateToken(cacheKey);
    const fresh = await getAccessToken(cacheKey, refreshToken, refreshUrl, refreshParams, t);
    return fetch(input, {
      ...init,
      headers: { ...(init.headers as Record<string, string> | undefined), Authorization: `Bearer ${fresh}` },
    });
  }
  return res;
}

/**
 * Exchange an authorization code for tokens (first-time flow).
 */
export async function exchangeCodeForTokens(
  tokenUrl: string,
  params: Record<string, string>,
  t: SyncErrorTranslator = defaultSyncErrorTranslator,
): Promise<TokenResponse> {
  const body = new URLSearchParams({ ...params, grant_type: 'authorization_code' });
  const res = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(t('background.sync.oauthTokenExchangeFailed', {
      status: res.status,
      detail: detail ? `: ${detail}` : '',
    }));
  }
  const token = await res.json() as {
    access_token: string;
    expires_in: number;
    refresh_token?: string;
  };
  return {
    accessToken: token.access_token,
    expiresIn: token.expires_in,
    refreshToken: token.refresh_token,
  };
}
