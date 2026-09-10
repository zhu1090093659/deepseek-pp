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
import { resolveMcpRequestHeaders, shouldRetryMcpUnauthorized } from './auth';

interface McpHttpTransportState {
  protocolVersion?: string;
  sessionId?: string;
  pendingSessionId?: string;
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
        `MCP server returned HTTP ${response.status}.`,
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
