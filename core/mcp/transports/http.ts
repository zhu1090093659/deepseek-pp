import { buildMcpRequestHeaders } from '../store';
import type {
  McpJsonRpcNotification,
  McpJsonRpcRequest,
  McpJsonRpcResponse,
  McpProtocolTransport,
  McpServerConfig,
} from '../types';
import { MCP_PROTOCOL_VERSION } from '../constants';
import {
  ensureMcpServerOriginPermission,
  fetchWithTimeout,
  getMcpEndpointUrl,
  readJsonRpcResponse,
} from './common';

interface McpHttpTransportState {
  protocolVersion?: string;
  sessionId?: string;
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
      await sendHttpMessage(server, notification, {
        timeoutMs: options?.timeoutMs,
        maxResponseBytes: options?.maxResponseBytes,
        signal: options?.signal,
        session: state,
        streamableSession: transportOptions.session,
      });
    },
  };
}

async function sendHttpMessage<TParams extends Record<string, unknown> | undefined, TResult>(
  server: McpServerConfig,
  message: McpJsonRpcRequest<TParams> | McpJsonRpcNotification,
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
  await ensureMcpServerOriginPermission(server);
  const url = getMcpEndpointUrl(server);
  const response = await fetchWithTimeout(url, {
    method: 'POST',
    credentials: 'omit',
    headers: createRequestHeaders(server, options.session, options.streamableSession ?? false),
    body: JSON.stringify(message),
    signal: options.signal,
  }, timeoutMs);
  if (options.streamableSession) updateStreamableSession(options.session, response);

  const rpcResponse = await readJsonRpcResponse<TResult>(
    response,
    'id' in message ? message as McpJsonRpcRequest<TParams> : undefined,
    { maxBytes: maxResponseBytes },
  );
  updateProtocolSession(options.session, message, rpcResponse);
  return rpcResponse;
}

function createRequestHeaders(
  server: McpServerConfig,
  session: McpHttpTransportState | undefined,
  includeStreamableSession: boolean,
): Record<string, string> {
  const headers = {
    accept: 'application/json, text/event-stream',
    'content-type': 'application/json',
    ...buildMcpRequestHeaders(server),
  };

  return {
    ...headers,
    ...(session?.protocolVersion ? { 'MCP-Protocol-Version': session.protocolVersion } : {}),
    ...(includeStreamableSession && session?.sessionId ? { 'Mcp-Session-Id': session.sessionId } : {}),
  };
}

function updateStreamableSession(
  session: McpHttpTransportState | undefined,
  response: Response,
): void {
  if (!session) return;
  const sessionId = response.headers.get('Mcp-Session-Id');
  if (sessionId) session.sessionId = sessionId;
}

function updateProtocolSession<TResult>(
  session: McpHttpTransportState | undefined,
  message: McpJsonRpcRequest<any> | McpJsonRpcNotification,
  response: McpJsonRpcResponse<TResult>,
): void {
  if (!session || message.method !== 'initialize' || response.error) return;
  const result = response.result && typeof response.result === 'object'
    ? response.result as { protocolVersion?: unknown }
    : {};
  session.protocolVersion = typeof result.protocolVersion === 'string' && result.protocolVersion
    ? result.protocolVersion
    : MCP_PROTOCOL_VERSION;
}
