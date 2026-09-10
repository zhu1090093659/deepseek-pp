import type {
  McpJsonRpcNotification,
  McpJsonRpcRequest,
  McpJsonRpcResponse,
  McpProtocolTransport,
  McpServerConfig,
} from '../types';
import {
  McpTransportError,
  ensureMcpServerOriginPermission,
  fetchWithTimeout,
  getMcpEndpointUrl,
  readJsonRpcResponse,
} from './common';
import { describeMcpOAuthFailure, resolveMcpRequestHeaders, shouldRetryMcpUnauthorized } from './auth';

interface McpHttpTransportState {
  protocolVersion?: string;
  sessionId?: string;
  pendingSessionId?: string;
  /** Redacted shape of the Authorization header attached to the last request. */
  lastAuthHeader?: string;
}

/**
 * Describe an Authorization header without leaking the credential. Tells apart
 * "no header at all" from "a real JWT was attached", which a bare 401 cannot.
 */
function describeAuthorizationHeader(value: string | undefined): string {
  if (!value) return 'absent';
  const space = value.indexOf(' ');
  if (space < 0) return `malformed(len=${value.length}, no scheme)`;
  const scheme = value.slice(0, space);
  const token = value.slice(space + 1);
  return `${scheme} tokenLen=${token.length} jwtSegments=${token.split('.').length}`;
}

export function createMcpHttpTransport(server: McpServerConfig): McpProtocolTransport {
  return createHttpTransport(server, { session: false });
}

export function createMcpStreamableHttpTransport(server: McpServerConfig): McpProtocolTransport {
  return createHttpTransport(server, { session: true });
}

function createHttpTransport(
  server: McpServerConfig,
  transportOptions: { session: boolean },
): McpProtocolTransport {
  const state: McpHttpTransportState = {};
  return {
    request(request, options) {
      return sendHttpMessage(server, request, {
        timeoutMs: options?.timeoutMs,
        maxResponseBytes: options?.maxResponseBytes,
        signal: options?.signal,
        session: state,
        streamableSession: transportOptions.session,
      });
    },
    async notify(notification, options) {
      await sendHttpNotification(server, notification, {
        timeoutMs: options?.timeoutMs,
        signal: options?.signal,
        session: state,
        streamableSession: transportOptions.session,
      });
    },
    commitInitialization(result) {
      state.protocolVersion = result.protocolVersion;
      if (transportOptions.session) state.sessionId = state.pendingSessionId;
      state.pendingSessionId = undefined;
    },
  };
}

async function sendHttpMessage<TParams extends Record<string, unknown> | undefined, TResult>(
  server: McpServerConfig,
  message: McpJsonRpcRequest<TParams>,
  options: {
    timeoutMs?: number;
    maxResponseBytes?: number;
    session?: McpHttpTransportState;
    streamableSession?: boolean;
    signal?: AbortSignal;
  } = {},
): Promise<McpJsonRpcResponse<TResult>> {
  const timeoutMs = options.timeoutMs ?? server.timeouts.requestMs;
  const maxResponseBytes = options.maxResponseBytes ?? server.limits.maxResultBytes;
  const streamableSession = options.streamableSession ?? false;
  await ensureMcpServerOriginPermission(server);
  const url = getMcpEndpointUrl(server);

  const post = () => postHttpMessage(server, url, message, {
    timeoutMs,
    session: options.session,
    streamableSession,
    signal: options.signal,
  });

  let response = await post();
  if (shouldRetryMcpUnauthorized(server, response.status)) {
    await response.body?.cancel().catch(() => undefined);
    response = await post();
    if (response.status === 401) {
      const challenge = response.headers.get('www-authenticate') ?? '(no WWW-Authenticate header)';
      await response.body?.cancel().catch(() => undefined);
      // A refresh succeeded but the resource server still rejects the token.
      // That cannot be repaired by refreshing again (the grant is revoked,
      // rotated, or minted for a different client), so flag it distinctly and
      // let the caller escalate to a fresh interactive authorization.
      throw new McpTransportError(
        'mcp_oauth_invalid_token',
        `MCP server returned HTTP 401. OAuth retry was still unauthorized (${describeMcpOAuthFailure(server)}). Last request Authorization: ${options.session?.lastAuthHeader ?? 'unknown'}. Server challenge: ${challenge}`,
        { retryable: false },
      );
    }
  }

  const rpcResponse = await readJsonRpcResponse<TResult>(
    response,
    message,
    { maxBytes: maxResponseBytes, timeoutMs },
  );
  capturePendingStreamableSession(
    options.session,
    response,
    message,
    rpcResponse,
    streamableSession,
  );
  return rpcResponse;
}

async function postHttpMessage(
  server: McpServerConfig,
  url: URL,
  body: unknown,
  options: {
    timeoutMs: number;
    session?: McpHttpTransportState;
    streamableSession: boolean;
    signal?: AbortSignal;
  },
): Promise<Response> {
  const authHeaders = await resolveMcpRequestHeaders(server, { signal: options.signal });
  if (options.session) {
    options.session.lastAuthHeader = describeAuthorizationHeader(authHeaders.Authorization);
  }
  return fetchWithTimeout(url, {
    method: 'POST',
    credentials: 'omit',
    headers: createRequestHeaders(authHeaders, options.session, options.streamableSession),
    body: JSON.stringify(body),
    signal: options.signal,
  }, options.timeoutMs);
}

async function sendHttpNotification(
  server: McpServerConfig,
  notification: McpJsonRpcNotification,
  options: {
    timeoutMs?: number;
    session?: McpHttpTransportState;
    streamableSession?: boolean;
    signal?: AbortSignal;
  } = {},
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? server.timeouts.requestMs;
  await ensureMcpServerOriginPermission(server);
  const url = getMcpEndpointUrl(server);
  const send = () => postHttpMessage(server, url, notification, {
    timeoutMs,
    session: options.session,
    streamableSession: options.streamableSession ?? false,
    signal: options.signal,
  });

  let response = await send();
  if (shouldRetryMcpUnauthorized(server, response.status)) {
    await response.body?.cancel().catch(() => undefined);
    response = await send();
  }

  try {
    if (!response.ok) {
      throw new McpTransportError(
        'mcp_http_error',
        `MCP server returned HTTP ${response.status}. OAuth state: ${describeMcpOAuthFailure(server)}.`,
        { retryable: response.status >= 500 },
      );
    }
  } finally {
    await response.body?.cancel().catch(() => undefined);
  }
}

function createRequestHeaders(
  base: Record<string, string>,
  session: McpHttpTransportState | undefined,
  includeStreamableSession: boolean,
): Record<string, string> {
  return {
    accept: 'application/json, text/event-stream',
    'content-type': 'application/json',
    ...base,
    ...(session?.protocolVersion ? { 'MCP-Protocol-Version': session.protocolVersion } : {}),
    ...(includeStreamableSession && session?.sessionId ? { 'Mcp-Session-Id': session.sessionId } : {}),
  };
}

function capturePendingStreamableSession<TResult>(
  session: McpHttpTransportState | undefined,
  response: Response,
  message: McpJsonRpcRequest<any>,
  rpcResponse: McpJsonRpcResponse<TResult>,
  streamableSession: boolean,
): void {
  if (!session || !streamableSession || message.method !== 'initialize' || rpcResponse.error) return;
  session.pendingSessionId = response.headers.get('Mcp-Session-Id') || undefined;
}
