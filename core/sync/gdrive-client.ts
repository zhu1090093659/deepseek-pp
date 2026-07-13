import type { GDriveSyncConfig } from '../types';
import type { StorageBackend } from './storage-backend';
import {
  authedFetch,
  defaultSyncErrorTranslator,
  exchangeCodeForTokens,
  getRedirectUri,
  runAuthCodeFlow,
  type SyncErrorTranslator,
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
  createdTime?: string;
  modifiedTime?: string;
}

function buildAuthUrl(config: GDriveAuthInput, t: SyncErrorTranslator): string {
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: getRedirectUri(t),
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
export async function authorizeGDrive(
  config: GDriveAuthInput,
  t: SyncErrorTranslator = defaultSyncErrorTranslator,
): Promise<string> {
  const code = await runAuthCodeFlow(buildAuthUrl(config, t), t);
  const tokens = await exchangeCodeForTokens(TOKEN_URL, {
    code,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uri: getRedirectUri(t),
  }, t);
  if (!tokens.refreshToken) {
    throw new Error(t('background.sync.gdriveMissingRefreshToken'));
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
  t: SyncErrorTranslator,
): Promise<string | null> {
  const params = new URLSearchParams({
    spaces: 'appDataFolder',
    fields: 'files(id,name,createdTime,modifiedTime)',
    q: `name = '${escapeDriveQueryLiteral(name)}' and trashed = false`,
    pageSize: '1000',
  });
  const res = await authedFetch(
    cacheKey(config),
    requireRefreshToken(config, t),
    TOKEN_URL,
    refreshParams(config),
    `${API_BASE}/files?${params.toString()}`,
    { method: 'GET' },
    t,
  );
  if (!res.ok) throw new Error(t('background.sync.gdriveQueryFailed', { name, status: res.status }));
  const data = await res.json() as { files?: DriveFileMeta[] };
  const matches = (data.files ?? [])
    .filter((file) => file.name === name)
    .sort(compareDriveFilesNewestFirst);
  return matches[0]?.id ?? null;
}

function compareDriveFilesNewestFirst(left: DriveFileMeta, right: DriveFileMeta): number {
  const modifiedDelta = driveTimestamp(right.modifiedTime) - driveTimestamp(left.modifiedTime);
  if (modifiedDelta !== 0) return modifiedDelta;
  const createdDelta = driveTimestamp(right.createdTime) - driveTimestamp(left.createdTime);
  if (createdDelta !== 0) return createdDelta;
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

function driveTimestamp(value: string | undefined): number {
  const timestamp = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(timestamp) ? timestamp : 0;
}

async function createFile(
  config: GDriveSyncConfig,
  name: string,
  content: string,
  t: SyncErrorTranslator,
): Promise<void> {
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
    requireRefreshToken(config, t),
    TOKEN_URL,
    refreshParams(config),
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart',
    {
      method: 'POST',
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body,
    },
    t,
  );
  if (!res.ok) throw new Error(t('background.sync.gdriveUploadFailed', { name, status: res.status }));
}

async function updateFile(
  config: GDriveSyncConfig,
  fileId: string,
  name: string,
  content: string,
  t: SyncErrorTranslator,
): Promise<void> {
  const res = await authedFetch(
    cacheKey(config),
    requireRefreshToken(config, t),
    TOKEN_URL,
    refreshParams(config),
    `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: content,
    },
    t,
  );
  if (!res.ok) throw new Error(t('background.sync.gdriveUploadFailed', { name, status: res.status }));
}

function requireRefreshToken(config: GDriveSyncConfig, t: SyncErrorTranslator): string {
  if (!config.refreshToken) {
    throw new Error(t('background.sync.gdriveMissingAuthorization'));
  }
  return config.refreshToken;
}

export function createGDriveBackend(
  config: GDriveSyncConfig,
  t: SyncErrorTranslator = defaultSyncErrorTranslator,
): StorageBackend {
  return {
    async test(): Promise<void> {
      requireRefreshToken(config, t);
      // A successful appDataFolder list == credentials + token are valid.
      const params = new URLSearchParams({ spaces: 'appDataFolder', pageSize: '1', fields: 'files(id)' });
      const res = await authedFetch(
        cacheKey(config),
        requireRefreshToken(config, t),
        TOKEN_URL,
        refreshParams(config),
        `${API_BASE}/files?${params.toString()}`,
        { method: 'GET' },
        t,
      );
      if (res.status === 401) throw new Error(t('background.sync.gdriveAuthorizationExpired'));
      if (!res.ok) throw new Error(t('background.sync.gdriveConnectFailed', { status: res.status }));
    },

    async ensureStore(): Promise<void> {
      // appDataFolder is implicit — nothing to create.
    },

    async get(key: string): Promise<string | null> {
      const fileId = await findFileId(config, key, t);
      if (!fileId) return null;
      const res = await authedFetch(
        cacheKey(config),
        requireRefreshToken(config, t),
        TOKEN_URL,
        refreshParams(config),
        `${API_BASE}/files/${fileId}?alt=media`,
        { method: 'GET' },
        t,
      );
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(t('background.sync.gdriveDownloadFailed', { key, status: res.status }));
      return res.text();
    },

    async put(key: string, content: string): Promise<void> {
      const fileId = await findFileId(config, key, t);
      if (fileId) {
        await updateFile(config, fileId, key, content, t);
      } else {
        await createFile(config, key, content, t);
      }
    },
  };
}
