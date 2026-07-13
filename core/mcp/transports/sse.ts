import { buildMcpRequestHeaders } from '../store';
import type {
  McpJsonRpcNotification,
  McpJsonRpcRequest,
  McpJsonRpcResponse,
  McpProtocolTransport,
  McpServerConfig,
} from '../types';
import {
  McpTransportError,
  assertWithinByteLimit,
  drainSseEvents,
  ensureMcpServerOriginPermission,
  fetchWithTimeout,
  getMcpEndpointUrl,
  normalizeJsonRpcResponse,
} from './common';

export function createMcpSseTransport(server: McpServerConfig): McpProtocolTransport {
  return {
    request(request, options) {
      return sendSseMessage(
        server,
        request,
        options?.timeoutMs,
        options?.maxResponseBytes,
        options?.signal,
      );
    },
    async notify(notification, options) {
      await sendSseMessage(
        server,
        notification,
        options?.timeoutMs,
        options?.maxResponseBytes,
        options?.signal,
      );
    },
  };
}

async function sendSseMessage<TParams extends Record<string, unknown> | undefined, TResult>(
  server: McpServerConfig,
  message: McpJsonRpcRequest<TParams> | McpJsonRpcNotification,
  timeoutMs: number = server.timeouts.requestMs,
  maxResponseBytes: number = server.limits.maxResultBytes,
  signal?: AbortSignal,
): Promise<McpJsonRpcResponse<TResult>> {
  await ensureMcpServerOriginPermission(server);
  const sseResponse = await fetchWithTimeout(getMcpEndpointUrl(server), {
    method: 'GET',
    credentials: 'omit',
    headers: {
      accept: 'text/event-stream',
      ...buildMcpRequestHeaders(server),
    },
    signal,
  }, timeoutMs);

  if (!sseResponse.ok || !sseResponse.body) {
    throw new McpTransportError('mcp_sse_connect_failed', `MCP SSE connect failed with HTTP ${sseResponse.status}.`);
  }

  const reader = sseResponse.body.getReader();
  const decoder = new TextDecoder();
  const postUrl = await readSseEndpoint(server, reader, decoder, timeoutMs, maxResponseBytes, signal);
  await postSseMessage(server, postUrl, message, timeoutMs, signal);

  if (!('id' in message)) {
    reader.cancel().catch(() => undefined);
    return { jsonrpc: '2.0', id: null, result: undefined as TResult };
  }

  try {
    return await readSseResponseFromReader(
      reader,
      decoder,
      message as McpJsonRpcRequest<TParams>,
      maxResponseBytes,
      signal,
    );
  } finally {
    reader.cancel().catch(() => undefined);
  }
}

async function readSseEndpoint(
  server: McpServerConfig,
  reader: ReadableStreamDefaultReader<Uint8Array>,
  decoder: TextDecoder,
  timeoutMs: number,
  maxResponseBytes: number,
  signal?: AbortSignal,
): Promise<URL> {
  const deadline = Date.now() + timeoutMs;
  let buffer = '';
  let totalBytes = 0;

  while (Date.now() < deadline) {
    throwIfSignalAborted(signal);
    const { done, value } = await reader.read();
    throwIfSignalAborted(signal);
    if (done) break;
    totalBytes = assertWithinByteLimit(totalBytes, value.byteLength, maxResponseBytes, reader);
    buffer += decoder.decode(value, { stream: true });
    const drained = drainSseEvents(buffer);
    buffer = drained.remainder;
    for (const event of drained.events) {
      if (event.event !== 'endpoint') continue;
      return new URL(event.data, getMcpEndpointUrl(server));
    }
  }

  throw new McpTransportError('mcp_sse_endpoint_missing', 'MCP SSE stream did not provide a POST endpoint.');
}

async function postSseMessage(
  server: McpServerConfig,
  postUrl: URL,
  message: McpJsonRpcRequest<any> | McpJsonRpcNotification,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<void> {
  const response = await fetchWithTimeout(postUrl, {
    method: 'POST',
    credentials: 'omit',
    headers: {
      'content-type': 'application/json',
      ...buildMcpRequestHeaders(server),
    },
    body: JSON.stringify(message),
    signal,
  }, timeoutMs);

  if (!response.ok) {
    throw new McpTransportError('mcp_sse_post_failed', `MCP SSE POST failed with HTTP ${response.status}.`);
  }
}

async function readSseResponseFromReader<TResult>(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  decoder: TextDecoder,
  expectedRequest: McpJsonRpcRequest<any>,
  maxResponseBytes: number,
  signal?: AbortSignal,
): Promise<McpJsonRpcResponse<TResult>> {
  let buffer = '';
  let totalBytes = 0;

  while (true) {
    throwIfSignalAborted(signal);
    const { done, value } = await reader.read();
    throwIfSignalAborted(signal);
    if (done) break;
    totalBytes = assertWithinByteLimit(totalBytes, value.byteLength, maxResponseBytes, reader);
    buffer += decoder.decode(value, { stream: true });
    const drained = drainSseEvents(buffer);
    buffer = drained.remainder;
    for (const event of drained.events) {
      if (event.event !== 'message') continue;
      const parsed = tryParseJson(event.data);
      if (!parsed) continue;
      const normalized = normalizeJsonRpcResponse<TResult>(parsed, expectedRequest);
      if (normalized.id === expectedRequest.id) return normalized;
    }
  }

  throw new McpTransportError('mcp_sse_response_missing', 'MCP SSE stream ended without a matching response.');
}

function throwIfSignalAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  if (signal.reason instanceof Error) throw signal.reason;
  throw new DOMException('MCP SSE request was aborted.', 'AbortError');
}

function tryParseJson(value: string): unknown | null {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}
