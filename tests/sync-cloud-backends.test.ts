import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GDriveSyncConfig, OneDriveSyncConfig, WebdavSyncConfig } from '../core/types';
import { createStorageBackend } from '../core/sync/backend-factory';
import {
  getAccessToken,
  invalidateToken,
  authedFetch,
} from '../core/sync/oauth-client';
import { createGDriveBackend } from '../core/sync/gdrive-client';
import { createOneDriveBackend } from '../core/sync/onedrive-client';
import type { LocaleMessageKey, MessageParams } from '../core/i18n';

// chrome.identity is read lazily via getRedirectUri(); stub it so imports work.
beforeEach(() => {
  vi.stubGlobal('chrome', {
    identity: { getRedirectURL: () => 'https://test-ext.chromiumapp.org/' },
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function textResponse(body: string, status = 200): Response {
  return new Response(body, { status, headers: { 'Content-Type': 'text/plain' } });
}

function testT(key: LocaleMessageKey, params?: MessageParams): string {
  const suffix = params ? ` ${JSON.stringify(params)}` : '';
  return `translated:${key}${suffix}`;
}

describe('createStorageBackend routing', () => {
  it('routes each provider to its backend implementation', () => {
    const webdav: WebdavSyncConfig = { provider: 'webdav', url: 'https://dav', username: 'u', password: 'p', remotePath: 'r', lastSyncAt: null };
    const gdrive: GDriveSyncConfig = { provider: 'gdrive', clientId: 'c', clientSecret: 's', lastSyncAt: null };
    const onedrive: OneDriveSyncConfig = { provider: 'onedrive', clientId: 'c', clientSecret: 's', lastSyncAt: null };

    // No throw + distinct objects per provider is the contract.
    expect(typeof createStorageBackend(webdav).put).toBe('function');
    expect(typeof createStorageBackend(gdrive).put).toBe('function');
    expect(typeof createStorageBackend(onedrive).put).toBe('function');
  });
});

describe('oauth token management', () => {
  const REFRESH_URL = 'https://example.test/token';

  afterEach(() => {
    invalidateToken('test-key');
  });

  it('caches access tokens and reuses them until expiry', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ access_token: 'token-1', expires_in: 3600 }),
    );
    vi.stubGlobal('fetch', fetchImpl);

    await getAccessToken('test-key', 'refresh', REFRESH_URL, { client_id: 'c' });
    await getAccessToken('test-key', 'refresh', REFRESH_URL, { client_id: 'c' });

    // Second call hits the cache — no extra token request.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('refreshes the token after invalidation', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ access_token: 'token-2', expires_in: 3600 }),
    );
    vi.stubGlobal('fetch', fetchImpl);

    await getAccessToken('test-key', 'refresh', REFRESH_URL, { client_id: 'c' });
    invalidateToken('test-key');
    await getAccessToken('test-key', 'refresh', REFRESH_URL, { client_id: 'c' });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('uses the injected translator for token refresh failures', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => textResponse('bad token', 500)));

    await expect(
      getAccessToken('test-key', 'refresh', REFRESH_URL, { client_id: 'c' }, testT),
    ).rejects.toThrow('translated:background.sync.oauthRefreshFailed {"status":500,"detail":": bad token"}');
  });

  it('retries once with a fresh token on 401', async () => {
    // First access token fetch, then the 401, then the refreshed token fetch.
    let tokenCall = 0;
    const fetchImpl = vi.fn<typeof fetch>(async (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === REFRESH_URL) {
        tokenCall += 1;
        return jsonResponse({ access_token: `token-${tokenCall}`, expires_in: 3600 });
      }
      // API call: 401 first time (with token-1), success after refresh (token-2).
      return tokenCall === 1 ? new Response('unauthorized', { status: 401 }) : textResponse('ok');
    });
    vi.stubGlobal('fetch', fetchImpl);

    const res = await authedFetch('test-key', 'refresh', REFRESH_URL, { client_id: 'c' }, 'https://api.test/resource', { method: 'GET' });
    expect(res.ok).toBe(true);
    // 1 initial token + 1 API 401 + 1 refresh token + 1 API retry.
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });
});

describe('Google Drive backend', () => {
  const config: GDriveSyncConfig = {
    provider: 'gdrive',
    clientId: 'cid',
    clientSecret: 'sec',
    refreshToken: 'rtok',
    lastSyncAt: null,
  };

  afterEach(() => {
    invalidateToken(`gdrive:${config.clientId}`);
    vi.unstubAllGlobals();
  });

  it('get returns null when the file is absent', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/oauth2.googleapis.com/token')) {
        return jsonResponse({ access_token: 'atok', expires_in: 3600 });
      }
      // files list returns empty → file not found.
      return jsonResponse({ files: [] });
    });
    vi.stubGlobal('fetch', fetchImpl);

    const backend = createGDriveBackend(config);
    expect(await backend.get('memories.json')).toBeNull();
  });

  it('uses the newest live object as the canonical file when Drive contains duplicate names', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/oauth2.googleapis.com/token')) {
        return jsonResponse({ access_token: 'atok', expires_in: 3600 });
      }
      if (url.includes('/drive/v3/files?')) {
        return jsonResponse({
          files: [
            {
              id: 'old-file',
              name: 'sync-current.json',
              createdTime: '2026-07-13T10:00:00.000Z',
              modifiedTime: '2026-07-13T10:00:00.000Z',
            },
            {
              id: 'new-file',
              name: 'sync-current.json',
              createdTime: '2026-07-13T10:01:00.000Z',
              modifiedTime: '2026-07-13T10:02:00.000Z',
            },
          ],
        });
      }
      if (url.includes('/drive/v3/files/new-file?alt=media')) return textResponse('{"canonical":true}');
      if (url.includes('upload/drive/v3/files/new-file') && init?.method === 'PATCH') {
        return new Response('{}', { status: 200 });
      }
      return new Response('unexpected', { status: 500 });
    });
    vi.stubGlobal('fetch', fetchImpl);

    const backend = createGDriveBackend(config);
    expect(await backend.get('sync-current.json')).toBe('{"canonical":true}');
    await backend.put('sync-current.json', '{"candidate":true}');
    const queryUrl = fetchImpl.mock.calls
      .map(([input]) => typeof input === 'string' ? input : input.toString())
      .find((url) => url.includes('/drive/v3/files?'));
    expect(queryUrl).toContain('pageSize=1000');
    expect(new URL(queryUrl!).searchParams.get('q')).toContain('trashed = false');
    expect(fetchImpl.mock.calls.some(([input, init]) => (
      (typeof input === 'string' ? input : input.toString()).includes('/new-file')
      && init?.method === 'PATCH'
    ))).toBe(true);
  });

  it('uses the injected translator when Google Drive is not authorized', async () => {
    const backend = createGDriveBackend({ ...config, refreshToken: undefined }, testT);

    await expect(backend.test()).rejects.toThrow('translated:background.sync.gdriveMissingAuthorization');
  });

  it('put creates a file when absent, updates when present', async () => {
    let listHasFile = false;
    const fetchImpl = vi.fn<typeof fetch>(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/oauth2.googleapis.com/token')) {
        return jsonResponse({ access_token: 'atok', expires_in: 3600 });
      }
      if (url.includes('/drive/v3/files') && init?.method === 'GET') {
        return jsonResponse(listHasFile ? { files: [{ id: 'file-1', name: 'memories.json' }] } : { files: [] });
      }
      if (url.includes('upload/drive/v3/files') && init?.method === 'POST') {
        listHasFile = true;
        return jsonResponse({ id: 'file-1' });
      }
      if (url.includes('upload/drive/v3/files/file-1') && init?.method === 'PATCH') {
        return new Response('{}', { status: 200 });
      }
      return new Response('unexpected', { status: 500 });
    });
    vi.stubGlobal('fetch', fetchImpl);

    const backend = createGDriveBackend(config);
    // First put: no existing file → POST create.
    await backend.put('memories.json', '{"a":1}');
    expect(fetchImpl.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(true);

    // Second put: file now exists → PATCH update.
    await backend.put('memories.json', '{"a":2}');
    expect(fetchImpl.mock.calls.some(([, init]) => init?.method === 'PATCH')).toBe(true);
  });
});

describe('OneDrive backend', () => {
  const config: OneDriveSyncConfig = {
    provider: 'onedrive',
    clientId: 'cid',
    clientSecret: 'sec',
    refreshToken: 'rtok',
    lastSyncAt: null,
  };

  afterEach(() => {
    invalidateToken(`onedrive:${config.clientId}`);
    vi.unstubAllGlobals();
  });

  it('get returns null on 404, content otherwise', async () => {
    let missing = true;
    const fetchImpl = vi.fn<typeof fetch>(async (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('login.microsoftonline.com')) {
        return jsonResponse({ access_token: 'atok', expires_in: 3600 });
      }
      return missing ? new Response('not found', { status: 404 }) : textResponse('{"a":1}');
    });
    vi.stubGlobal('fetch', fetchImpl);

    const backend = createOneDriveBackend(config);
    expect(await backend.get('memories.json')).toBeNull();
    missing = false;
    expect(await backend.get('memories.json')).toBe('{"a":1}');
  });

  it('put issues a PUT to the app-root content endpoint', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('login.microsoftonline.com')) {
        return jsonResponse({ access_token: 'atok', expires_in: 3600 });
      }
      return new Response('{}', { status: 200 });
    });
    vi.stubGlobal('fetch', fetchImpl);

    const backend = createOneDriveBackend(config);
    await backend.put('skills.json', '[]');

    const [calledUrl, init] = fetchImpl.mock.calls.find(
      ([url]) => typeof url === 'string' && url.includes('approot'),
    ) ?? [];
    expect(calledUrl).toBeDefined();
    expect((init as RequestInit | undefined)?.method).toBe('PUT');
  });
});
