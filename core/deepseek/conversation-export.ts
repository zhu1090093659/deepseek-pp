import {
  DEEPSEEK_BYPASS_HOOK_HEADER,
  DEEPSEEK_BODY_BUDGETS,
  DEEPSEEK_WEB_ROUTES,
} from './contracts';
import { encodeDeepSeekRouteRequest } from './request-codec';
import {
  fetchWithNetworkPolicy,
  readNetworkResponseText,
} from '../network/request-policy';
import {
  extractBizData,
  normalizeDeepSeekSessionSummary,
  type DeepSeekSessionSummary,
} from '../export/normalize';

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
  return fetchDeepSeekJson({
    route: 'history',
    baseUrl: input.baseUrl,
    searchParams: { chat_session_id: input.session.id },
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
  const json = await fetchDeepSeekJson({
    route: 'fetchFiles',
    baseUrl: input.baseUrl,
    searchParams: { file_ids: input.fileIds.join(',') },
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
  const searchParams: Record<string, string> = { count: String(input.count) };
  if (input.cursor) {
    if (input.cursor.updatedAt !== null) searchParams['lte_cursor.updated_at'] = String(input.cursor.updatedAt);
    searchParams['lte_cursor.pinned'] = String(input.cursor.pinned);
  }

  const json = await fetchDeepSeekJson({
    route: 'fetchSessions',
    baseUrl: input.baseUrl,
    searchParams,
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
  route: 'history' | 'fetchFiles' | 'fetchSessions';
  baseUrl?: string;
  searchParams: Readonly<Record<string, string>>;
  clientHeaders: Record<string, string>;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}): Promise<unknown> {
  const endpoint = DEEPSEEK_WEB_ROUTES[input.route];
  const operation = `DeepSeek export ${endpoint}`;
  const request = encodeDeepSeekRouteRequest(input.route, {
    credentials: 'include',
    signal: input.signal,
    headers: {
      accept: 'application/json',
      [DEEPSEEK_BYPASS_HOOK_HEADER]: '1',
      ...input.clientHeaders,
    },
  }, {
    baseUrl: input.baseUrl,
    searchParams: input.searchParams,
  });
  const response = await fetchWithNetworkPolicy(request.url, request.init, {
    operation,
    phase: 'export',
    maxResponseBytes: DEEPSEEK_BODY_BUDGETS.conversationExport,
    fetchImpl: input.fetchImpl,
  });
  const text = await readNetworkResponseText(response, operation);
  const json = parseJson(text, endpoint, response.status);
  const bizCode = readBizCode(json);

  if (!response.ok || (bizCode !== null && bizCode !== 0)) {
    throw new DeepSeekExportEndpointError(
      `DeepSeek export endpoint ${endpoint} failed with HTTP ${response.status}${bizCode === null ? '' : `, biz_code ${bizCode}`}.`,
      {
        endpoint,
        status: response.status,
        bizCode,
        retryable: response.status >= 500,
        code: isAuthBizCode(bizCode) || response.status === 401 ? 'deepseek_auth_failed' : 'deepseek_endpoint_failed',
      },
    );
  }

  return json;
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
