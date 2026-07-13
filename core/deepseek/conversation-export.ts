import { DEEPSEEK_API_URL } from '../constants';
import { DEEPSEEK_WEB_ROUTES } from './contracts';
import { BYPASS_HOOK_HEADER } from './adapter';
import {
  extractBizData,
  normalizeDeepSeekSessionSummary,
  type DeepSeekSessionSummary,
} from '../export/normalize';

const DEFAULT_BASE_URL = new URL(DEEPSEEK_API_URL).origin;
const SESSION_FETCH_PATH = DEEPSEEK_WEB_ROUTES.fetchSessions;
const HISTORY_PATH = DEEPSEEK_WEB_ROUTES.history;
const FILE_FETCH_PATH = DEEPSEEK_WEB_ROUTES.fetchFiles;

export interface DeepSeekConversationExportTransportOptions {
  baseUrl?: string;
  clientHeaders: Record<string, string>;
  fetchImpl?: typeof fetch;
}

export interface DeepSeekSessionPage {
  sessions: DeepSeekSessionSummary[];
  hasMore: boolean;
  nextCursor: DeepSeekSessionCursor | null;
}

interface DeepSeekSessionCursor {
  updatedAt: string | number | null;
  pinned: boolean;
}

export class DeepSeekExportEndpointError extends Error {
  readonly endpoint: string;
  readonly status: number;
  readonly bizCode: number | string | null;
  readonly retryable: boolean;
  readonly code: string;

  constructor(
    message: string,
    options: { endpoint: string; status: number; bizCode?: number | string | null; retryable?: boolean; code?: string },
  ) {
    super(message);
    this.name = 'DeepSeekExportEndpointError';
    this.endpoint = options.endpoint;
    this.status = options.status;
    this.bizCode = options.bizCode ?? null;
    this.retryable = options.retryable ?? false;
    this.code = options.code ?? 'deepseek_export_endpoint_error';
  }
}

export function createDeepSeekConversationExportTransport(options: DeepSeekConversationExportTransportOptions) {
  return {
    listSessions: (input: { pageSize: number; sessionLimit?: number; includeRaw: boolean; signal?: AbortSignal }) =>
      listDeepSeekSessions({ ...options, ...input }),
    fetchHistory: (input: { session: DeepSeekSessionSummary; includeRaw: boolean; signal?: AbortSignal }) =>
      fetchDeepSeekSessionHistory({ ...options, ...input }),
    fetchFiles: (input: { fileIds: string[]; includeRaw: boolean; signal?: AbortSignal }) =>
      fetchDeepSeekFileMetadata({ ...options, ...input }),
  };
}

export async function listDeepSeekSessions(input: DeepSeekConversationExportTransportOptions & {
  pageSize: number;
  sessionLimit?: number;
  includeRaw: boolean;
  signal?: AbortSignal;
}): Promise<DeepSeekSessionSummary[]> {
  const sessions: DeepSeekSessionSummary[] = [];
  let cursor: DeepSeekSessionCursor | null = null;
  let page = 0;

  while (true) {
    const remaining = input.sessionLimit ? input.sessionLimit - sessions.length : input.pageSize;
    if (remaining <= 0) break;
    const count = Math.min(input.pageSize, remaining);
    const result = await fetchDeepSeekSessionPage({
      ...input,
      count,
      cursor,
    });
    sessions.push(...result.sessions);
    page += 1;

    if (!result.hasMore) break;
    if (!result.nextCursor) {
      throw new DeepSeekExportEndpointError(
        `DeepSeek session page ${page} had has_more=true but no cursor could be derived.`,
        { endpoint: SESSION_FETCH_PATH, status: 200, retryable: true, code: 'session_cursor_missing' },
      );
    }
    cursor = result.nextCursor;
  }

  return sessions;
}

export async function fetchDeepSeekSessionHistory(input: DeepSeekConversationExportTransportOptions & {
  session: DeepSeekSessionSummary;
  includeRaw: boolean;
  signal?: AbortSignal;
}): Promise<unknown> {
  const url = createApiUrl(input.baseUrl, HISTORY_PATH);
  url.searchParams.set('chat_session_id', input.session.id);
  return fetchDeepSeekJson({
    url,
    endpoint: HISTORY_PATH,
    clientHeaders: input.clientHeaders,
    fetchImpl: input.fetchImpl,
    signal: input.signal,
  });
}

export async function fetchDeepSeekFileMetadata(input: DeepSeekConversationExportTransportOptions & {
  fileIds: string[];
  includeRaw: boolean;
  signal?: AbortSignal;
}): Promise<unknown[]> {
  if (input.fileIds.length === 0) return [];
  const url = createApiUrl(input.baseUrl, FILE_FETCH_PATH);
  url.searchParams.set('file_ids', input.fileIds.join(','));
  const json = await fetchDeepSeekJson({
    url,
    endpoint: FILE_FETCH_PATH,
    clientHeaders: input.clientHeaders,
    fetchImpl: input.fetchImpl,
    signal: input.signal,
  });
  const bizData = extractBizData(json);
  if (Array.isArray(bizData.files)) return bizData.files;
  throw new DeepSeekExportEndpointError(
    'DeepSeek file metadata response did not include files.',
    { endpoint: FILE_FETCH_PATH, status: 200, retryable: true, code: 'file_metadata_missing' },
  );
}

async function fetchDeepSeekSessionPage(input: DeepSeekConversationExportTransportOptions & {
  count: number;
  cursor: DeepSeekSessionCursor | null;
  includeRaw: boolean;
  signal?: AbortSignal;
}): Promise<DeepSeekSessionPage> {
  const url = createApiUrl(input.baseUrl, SESSION_FETCH_PATH);
  url.searchParams.set('count', String(input.count));
  if (input.cursor) {
    if (input.cursor.updatedAt !== null) url.searchParams.set('lte_cursor.updated_at', String(input.cursor.updatedAt));
    url.searchParams.set('lte_cursor.pinned', String(input.cursor.pinned));
  }

  const json = await fetchDeepSeekJson({
    url,
    endpoint: SESSION_FETCH_PATH,
    clientHeaders: input.clientHeaders,
    fetchImpl: input.fetchImpl,
    signal: input.signal,
  });
  const bizData = extractBizData(json);
  if (!Array.isArray(bizData.chat_sessions)) {
    throw new DeepSeekExportEndpointError(
      'DeepSeek session page response did not include chat_sessions.',
      { endpoint: SESSION_FETCH_PATH, status: 200, retryable: true, code: 'session_page_missing' },
    );
  }

  const sessions = bizData.chat_sessions.map((session, index) =>
    normalizeDeepSeekSessionSummary(session, index, input.includeRaw)
  );
  const lastRaw = bizData.chat_sessions.at(-1);
  const last = lastRaw && typeof lastRaw === 'object' ? lastRaw as Record<string, unknown> : null;
  const nextCursor = last
    ? {
      updatedAt: firstCursorValue(last.updated_at, last.updatedAt),
      pinned: Boolean(last.pinned),
    }
    : null;

  return {
    sessions,
    hasMore: Boolean(bizData.has_more ?? bizData.hasMore),
    nextCursor,
  };
}

async function fetchDeepSeekJson(input: {
  url: URL;
  endpoint: string;
  clientHeaders: Record<string, string>;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}): Promise<unknown> {
  const fetcher = input.fetchImpl ?? fetch;
  const response = await fetcher(input.url.href, {
    method: 'GET',
    credentials: 'include',
    signal: input.signal,
    headers: {
      accept: 'application/json',
      [BYPASS_HOOK_HEADER]: '1',
      ...input.clientHeaders,
    },
  });
  const text = await response.text();
  const json = parseJson(text, input.endpoint, response.status);
  const bizCode = readBizCode(json);

  if (!response.ok || (bizCode !== null && bizCode !== 0)) {
    throw new DeepSeekExportEndpointError(
      `DeepSeek export endpoint ${input.endpoint} failed with HTTP ${response.status}${bizCode === null ? '' : `, biz_code ${bizCode}`}.`,
      {
        endpoint: input.endpoint,
        status: response.status,
        bizCode,
        retryable: response.status >= 500,
        code: isAuthBizCode(bizCode) || response.status === 401 ? 'deepseek_auth_failed' : 'deepseek_endpoint_failed',
      },
    );
  }

  return json;
}

function createApiUrl(baseUrl: string | undefined, path: string): URL {
  return new URL(path, baseUrl ?? DEFAULT_BASE_URL);
}

function parseJson(text: string, endpoint: string, status: number): unknown {
  try {
    return JSON.parse(text);
  } catch {
    const preview = text.replace(/\s+/g, ' ').trim().slice(0, 200);
    throw new DeepSeekExportEndpointError(
      `DeepSeek export endpoint ${endpoint} returned non-JSON HTTP ${status}: ${preview}`,
      { endpoint, status, retryable: status >= 500, code: 'deepseek_endpoint_non_json' },
    );
  }
}

function readBizCode(json: unknown): number | string | null {
  const value = json && typeof json === 'object' ? json as Record<string, unknown> : {};
  const data = value.data && typeof value.data === 'object' ? value.data as Record<string, unknown> : {};
  const code = data.biz_code ?? value.biz_code ?? value.code;
  if (typeof code === 'number' || typeof code === 'string') return code;
  return null;
}

function isAuthBizCode(code: number | string | null): boolean {
  return code === 40002 || code === 40003 || code === '40002' || code === '40003';
}

function firstCursorValue(...values: unknown[]): string | number | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return null;
}
