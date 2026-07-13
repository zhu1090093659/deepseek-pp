import {
  DEEPSEEK_BYPASS_HOOK_HEADER,
  DEEPSEEK_WEB_ORIGIN,
  DEEPSEEK_WEB_ROUTES,
} from './contracts';

export type DeepSeekWebRouteName = keyof typeof DEEPSEEK_WEB_ROUTES;
export type DeepSeekHttpMethod = 'GET' | 'POST';

export interface DeepSeekRoutePolicy {
  readonly route: DeepSeekWebRouteName;
  readonly method: DeepSeekHttpMethod;
}

type DeepSeekActiveRoutePolicyMap = {
  readonly [Route in DeepSeekWebRouteName]: DeepSeekRoutePolicy & { readonly route: Route };
};

export const DEEPSEEK_ACTIVE_ROUTE_POLICY = {
  completion: { route: 'completion', method: 'POST' },
  regenerate: { route: 'regenerate', method: 'POST' },
  createSession: { route: 'createSession', method: 'POST' },
  powChallenge: { route: 'powChallenge', method: 'POST' },
  history: { route: 'history', method: 'GET' },
  uploadFile: { route: 'uploadFile', method: 'POST' },
  fetchFiles: { route: 'fetchFiles', method: 'GET' },
  fetchSessions: { route: 'fetchSessions', method: 'GET' },
} as const satisfies DeepSeekActiveRoutePolicyMap;

export interface EncodedDeepSeekRequest {
  readonly url: string;
  readonly init: RequestInit;
}

export interface EncodeDeepSeekRouteRequestOptions {
  readonly baseUrl?: string;
  readonly searchParams?: Readonly<Record<string, string>>;
}

export interface DeepSeekCompletionRequestInput {
  chatSessionId: string;
  parentMessageId: number | null;
  modelType: string | null;
  prompt: string;
  refFileIds: string[];
  thinkingEnabled: boolean;
  searchEnabled: boolean;
  clientHeaders: Record<string, string>;
  powHeaders: Record<string, string>;
}

const DEFAULT_MODEL_TYPE = 'default';
const SUPPORTED_MODEL_TYPES = new Set(['DEFAULT', 'default', 'expert', 'vision']);

export function createDeepSeekRouteUrl(
  route: DeepSeekWebRouteName,
  baseUrl: string = DEEPSEEK_WEB_ORIGIN,
): URL {
  return new URL(DEEPSEEK_WEB_ROUTES[route], baseUrl);
}

export function matchesActiveDeepSeekRoute(
  url: string,
  method: string,
  policy: DeepSeekRoutePolicy,
): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return parsed.origin === DEEPSEEK_WEB_ORIGIN &&
    parsed.pathname === DEEPSEEK_WEB_ROUTES[policy.route] &&
    method.toUpperCase() === policy.method;
}

export function encodeDeepSeekRouteRequest(
  route: DeepSeekWebRouteName,
  init: Omit<RequestInit, 'method'>,
  options: EncodeDeepSeekRouteRequestOptions = {},
): EncodedDeepSeekRequest {
  const url = createDeepSeekRouteUrl(route, options.baseUrl);
  for (const [name, value] of Object.entries(options.searchParams ?? {})) {
    url.searchParams.set(name, value);
  }
  return {
    url: url.href,
    init: {
      ...init,
      method: DEEPSEEK_ACTIVE_ROUTE_POLICY[route].method,
    },
  };
}

export function encodeCreateSessionRequest(
  clientHeaders: Record<string, string>,
): EncodedDeepSeekRequest {
  return encodeDeepSeekRouteRequest('createSession', {
    credentials: 'include',
    headers: { 'content-type': 'application/json', ...clientHeaders },
    body: JSON.stringify({}),
  });
}

export function encodePowChallengeRequest(
  clientHeaders: Record<string, string>,
  targetPath: string,
): EncodedDeepSeekRequest {
  return encodeDeepSeekRouteRequest('powChallenge', {
    credentials: 'include',
    headers: { 'content-type': 'application/json', ...clientHeaders },
    body: JSON.stringify({ target_path: targetPath }),
  });
}

export function encodeCompletionRequest(
  input: DeepSeekCompletionRequestInput,
): EncodedDeepSeekRequest {
  return encodeDeepSeekRouteRequest('completion', {
    credentials: 'include',
    headers: {
      'content-type': 'application/json',
      [DEEPSEEK_BYPASS_HOOK_HEADER]: '1',
      ...input.clientHeaders,
      ...input.powHeaders,
    },
    body: JSON.stringify({
      chat_session_id: input.chatSessionId,
      parent_message_id: input.parentMessageId,
      model_type: normalizeDeepSeekModelType(input.modelType),
      prompt: input.prompt,
      ref_file_ids: input.refFileIds,
      thinking_enabled: input.thinkingEnabled,
      search_enabled: input.searchEnabled,
      action: null,
      preempt: false,
    }),
  });
}

export function encodeHistoryRequest(
  chatSessionId: string,
  clientHeaders: Record<string, string>,
): EncodedDeepSeekRequest {
  return encodeDeepSeekRouteRequest('history', {
    credentials: 'include',
    headers: { accept: 'application/json', ...clientHeaders },
  }, { searchParams: { chat_session_id: chatSessionId } });
}

export function normalizeDeepSeekModelType(modelType: string | null): string {
  if (!modelType) return DEFAULT_MODEL_TYPE;
  if (SUPPORTED_MODEL_TYPES.has(modelType)) return modelType;
  if (modelType === 'chat' || modelType === 'deepseek_chat') return DEFAULT_MODEL_TYPE;
  if (modelType === 'reasoner' || modelType === 'deepseek_reasoner') return 'expert';
  return DEFAULT_MODEL_TYPE;
}

export function normalizeDeepSeekMessageId(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 0xFFFFFFFF) {
    return value;
  }
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const parsed = Number(trimmed);
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= 0xFFFFFFFF ? parsed : null;
}

export function buildDeepSeekWebSessionUrl(chatSessionId: string): string {
  return `${DEEPSEEK_WEB_ORIGIN}/a/chat/s/${chatSessionId}`;
}
