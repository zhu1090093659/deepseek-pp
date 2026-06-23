import type { GDriveSyncConfig } from '../types';
import type { StorageBackend } from './storage-backend';
import {
  authedFetch,
  exchangeCodeForTokens,
  getRedirectUri,
  runAuthCodeFlow,
} from './oauth-client';

/**
 * Google Drive sync backend using the hidden appDataFolder.
 *
 * Files are addressed by name inside appDataFolder — users never see them in
 * their Drive and cannot accidentally delete them. Sync keys (memories.json,
 * etc.) map 1:1 to Drive file names.
 */

const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API_BASE = 'https://www.googleapis.com/drive/v3';

/** Minimal credentials needed to run the authorization flow (no timestamp). */
type GDriveAuthInput = Pick<GDriveSyncConfig, 'clientId' | 'clientSecret'>;

interface DriveFileMeta {
  id: string;
  name: string;
}

function buildAuthUrl(config: GDriveAuthInput): string {
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: getRedirectUri(),
    response_type: 'code',
    access_type: 'offline',
    prompt: 'consent',
    scope: DRIVE_SCOPE,
  });
  return `${AUTH_URL}?${params.toString()}`;
}

function cacheKey(config: GDriveSyncConfig): string {
  return `gdrive:${config.clientId}`;
}

function refreshParams(config: GDriveSyncConfig): Record<string, string> {
  return {
    client_id: config.clientId,
    client_secret: config.clientSecret,
  };
}

/**
 * Run first-time authorization: opens the consent screen, exchanges the code
 * for tokens, and returns the durable refresh_token (to persist in config).
 */
export async function authorizeGDrive(config: GDriveAuthInput): Promise<string> {
  const code = await runAuthCodeFlow(buildAuthUrl(config));
  const tokens = await exchangeCodeForTokens(TOKEN_URL, {
    code,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uri: getRedirectUri(),
  });
  if (!tokens.refreshToken) {
    throw new Error('Google 未返回 refresh_token，请撤销访问后重新授权');
  }
  return tokens.refreshToken;
}

// Escape a string for safe embedding in a Drive API `q` filter literal.
// Drive's query language requires escaping both backslashes and single quotes.
function escapeDriveQueryLiteral(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

async function findFileId(
  config: GDriveSyncConfig,
  name: string,
): Promise<string | null> {
  const params = new URLSearchParams({
    spaces: 'appDataFolder',
    fields: 'files(id,name)',
    q: `name = '${escapeDriveQueryLiteral(name)}'`,
    pageSize: '1',
  });
  const res = await authedFetch(
    cacheKey(config),
    requireRefreshToken(config),
    TOKEN_URL,
    refreshParams(config),
    `${API_BASE}/files?${params.toString()}`,
    { method: 'GET' },
  );
  if (!res.ok) throw new Error(`查询 ${name} 失败 (HTTP ${res.status})`);
  const data = await res.json() as { files?: DriveFileMeta[] };
  const match = (data.files ?? []).find((file) => file.name === name);
  return match?.id ?? null;
}

async function createFile(config: GDriveSyncConfig, name: string, content: string): Promise<void> {
  // Multipart upload: metadata (name + parents) + JSON body.
  const boundary = 'deepseek_pp_sync';
  const body =
    `--${boundary}\r\n` +
    'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
    JSON.stringify({ name, parents: ['appDataFolder'] }) +
    `\r\n--${boundary}\r\n` +
    'Content-Type: application/json; charset=utf-8\r\n\r\n' +
    content +
    `\r\n--${boundary}--`;
  const res = await authedFetch(
    cacheKey(config),
    requireRefreshToken(config),
    TOKEN_URL,
    refreshParams(config),
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart',
    {
      method: 'POST',
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body,
    },
  );
  if (!res.ok) throw new Error(`上传 ${name} 失败 (HTTP ${res.status})`);
}

async function updateFile(config: GDriveSyncConfig, fileId: string, name: string, content: string): Promise<void> {
  const res = await authedFetch(
    cacheKey(config),
    requireRefreshToken(config),
    TOKEN_URL,
    refreshParams(config),
    `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: content,
    },
  );
  if (!res.ok) throw new Error(`上传 ${name} 失败 (HTTP ${res.status})`);
}

function requireRefreshToken(config: GDriveSyncConfig): string {
  if (!config.refreshToken) {
    throw new Error('Google Drive 尚未授权，请先点击授权登录');
  }
  return config.refreshToken;
}

export function createGDriveBackend(config: GDriveSyncConfig): StorageBackend {
  return {
    async test(): Promise<void> {
      requireRefreshToken(config);
      // A successful appDataFolder list == credentials + token are valid.
      const params = new URLSearchParams({ spaces: 'appDataFolder', pageSize: '1', fields: 'files(id)' });
      const res = await authedFetch(
        cacheKey(config),
        requireRefreshToken(config),
        TOKEN_URL,
        refreshParams(config),
        `${API_BASE}/files?${params.toString()}`,
        { method: 'GET' },
      );
      if (res.status === 401) throw new Error('Google 授权已失效，请重新授权');
      if (!res.ok) throw new Error(`连接 Google Drive 失败 (HTTP ${res.status})`);
    },

    async ensureStore(): Promise<void> {
      // appDataFolder is implicit — nothing to create.
    },

    async get(key: string): Promise<string | null> {
      const fileId = await findFileId(config, key);
      if (!fileId) return null;
      const res = await authedFetch(
        cacheKey(config),
        requireRefreshToken(config),
        TOKEN_URL,
        refreshParams(config),
        `${API_BASE}/files/${fileId}?alt=media`,
        { method: 'GET' },
      );
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`下载 ${key} 失败 (HTTP ${res.status})`);
      return res.text();
    },

    async put(key: string, content: string): Promise<void> {
      const fileId = await findFileId(config, key);
      if (fileId) {
        await updateFile(config, fileId, key, content);
      } else {
        await createFile(config, key, content);
      }
    },
  };
}
