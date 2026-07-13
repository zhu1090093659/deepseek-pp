import type { McpJsonRpcRequest, McpJsonRpcResponse, McpServerConfig } from '../types';
import { createAbortScope } from '../../network/abort';

export class McpTransportError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(code: string, message: string, options?: { retryable?: boolean }) {
    super(message);
    this.name = 'McpTransportError';
    this.code = code;
    this.retryable = options?.retryable ?? true;
  }
}

export function getMcpEndpointUrl(server: McpServerConfig): URL {
  const url = server.transport.url;
  if (!url) {
    throw new McpTransportError('mcp_endpoint_missing', 'MCP server URL is missing.', { retryable: false });
  }
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error('Unsupported protocol');
    }
    return parsed;
  } catch {
    throw new McpTransportError('mcp_endpoint_invalid', `Invalid MCP server URL: ${url}`, { retryable: false });
  }
}

export function getMcpOriginPattern(server: McpServerConfig): string {
  const url = getMcpEndpointUrl(server);
  return `${url.protocol}//${url.host}/*`;
}

export async function requestMcpServerOriginPermission(server: McpServerConfig): Promise<boolean> {
  const origins = [getMcpOriginPattern(server)];
  if (!chrome.permissions?.contains || !chrome.permissions?.request) return true;

  const granted = await chrome.permissions.contains({ origins }).catch(() => false);
  if (granted) return true;
  return chrome.permissions.request({ origins }).catch(() => false);
}

export async function ensureMcpServerOriginPermission(server: McpServerConfig): Promise<void> {
  const granted = await requestMcpServerOriginPermission(server);
  if (!granted) {
    throw new McpTransportError(
      'mcp_origin_permission_denied',
      `Host permission was not granted for ${getMcpOriginPattern(server)}.`,
      { retryable: false },
    );
  }
}

export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const callerSignal = init.signal;
  if (callerSignal?.aborted) throwSignalReason(callerSignal);
  const abortScope = createAbortScope(callerSignal, timeoutMs);
  let responseReturned = false;
  try {
    const response = await fetch(input, {
      ...init,
      signal: abortScope.signal,
    });
    abortScope.clearDeadline();
    responseReturned = true;
    if (!callerSignal) {
      abortScope.cleanup();
      return response;
    }
    return wrapResponseBodyWithCleanup(response, abortScope.cleanup);
  } catch (err) {
    if (callerSignal?.aborted) throwSignalReason(callerSignal);
    if (abortScope.timedOut()) {
      throw new McpTransportError('mcp_transport_timeout', `MCP request exceeded ${timeoutMs} ms.`);
    }
    if (err instanceof TypeError) {
      const endpoint = typeof input === 'string' || input instanceof URL ? String(input) : 'configured endpoint';
      throw new McpTransportError(
        'mcp_network_error',
        `Cannot reach MCP server at ${endpoint}. Start the local provider, verify the URL, then retry.`,
      );
    }
    throw err;
  } finally {
    if (!responseReturned) abortScope.cleanup();
  }
}

function wrapResponseBodyWithCleanup(response: Response, cleanup: () => void): Response {
  if (!response.body) {
    cleanup();
    return response;
  }

  const reader = response.body.getReader();
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const chunk = await reader.read();
        if (chunk.done) {
          cleanup();
          controller.close();
          return;
        }
        controller.enqueue(chunk.value);
      } catch (error) {
        cleanup();
        controller.error(error);
      }
    },
    async cancel(reason) {
      cleanup();
      await reader.cancel(reason);
    },
  });
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

function throwSignalReason(signal: AbortSignal): never {
  if (signal.reason instanceof Error) throw signal.reason;
  throw new DOMException('MCP request was aborted.', 'AbortError');
}

export async function readJsonRpcResponse<TResult>(
  response: Response,
  expectedRequest?: McpJsonRpcRequest<any>,
  options: { maxBytes?: number } = {},
): Promise<McpJsonRpcResponse<TResult>> {
  if (!response.ok) {
    throw new McpTransportError(
      'mcp_http_error',
      `MCP server returned HTTP ${response.status}.`,
      { retryable: response.status >= 500 },
    );
  }

  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('text/event-stream')) {
    return readSseJsonRpcResponse(response, expectedRequest, options);
  }

  const raw = await readResponseTextWithLimit(response, options.maxBytes);
  if (!raw.trim()) {
    return {
      jsonrpc: '2.0',
      id: expectedRequest?.id ?? null,
      result: undefined as TResult,
    };
  }
  return normalizeJsonRpcResponse(JSON.parse(raw), expectedRequest);
}

export async function readSseJsonRpcResponse<TResult>(
  response: Response,
  expectedRequest?: McpJsonRpcRequest<any>,
  options: { maxBytes?: number } = {},
): Promise<McpJsonRpcResponse<TResult>> {
  if (!response.body) {
    throw new McpTransportError('mcp_sse_empty_body', 'MCP SSE response did not include a body.');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let totalBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes = assertWithinByteLimit(totalBytes, value.byteLength, options.maxBytes, reader);
    buffer += decoder.decode(value, { stream: true });
    const events = drainSseEvents(buffer);
    buffer = events.remainder;
    for (const event of events.events) {
      const parsed = parseJsonEvent(event.data);
      if (!parsed) continue;
      const normalized = normalizeJsonRpcResponse<TResult>(parsed, expectedRequest);
      if (expectedRequest == null || normalized.id === expectedRequest.id || normalized.id === null) {
        return normalized;
      }
    }
  }

  throw new McpTransportError('mcp_sse_response_missing', 'MCP SSE stream ended without a matching response.');
}

export async function readResponseTextWithLimit(response: Response, maxBytes?: number): Promise<string> {
  if (!response.body) return response.text();

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let totalBytes = 0;
  let raw = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes = assertWithinByteLimit(totalBytes, value.byteLength, maxBytes, reader);
    raw += decoder.decode(value, { stream: true });
  }

  raw += decoder.decode();
  return raw;
}

export function assertWithinByteLimit(
  currentBytes: number,
  nextBytes: number,
  maxBytes: number | undefined,
  reader?: ReadableStreamDefaultReader<Uint8Array>,
): number {
  const total = currentBytes + nextBytes;
  if (maxBytes && total > maxBytes) {
    reader?.cancel().catch(() => undefined);
    throw new McpTransportError(
      'mcp_response_too_large',
      `MCP response exceeded ${maxBytes} bytes before parsing completed.`,
      { retryable: false },
    );
  }
  return total;
}

export interface SseEvent {
  event: string;
  data: string;
}

export function drainSseEvents(buffer: string): { events: SseEvent[]; remainder: string } {
  const boundary = buffer.lastIndexOf('\n\n');
  if (boundary === -1) return { events: [], remainder: buffer };
  const complete = buffer.slice(0, boundary);
  const remainder = buffer.slice(boundary + 2);
  const events = complete
    .split('\n\n')
    .map(parseSseEvent)
    .filter((event): event is SseEvent => event !== null);
  return { events, remainder };
}

export function normalizeJsonRpcResponse<TResult>(
  raw: unknown,
  expectedRequest?: McpJsonRpcRequest<any>,
): McpJsonRpcResponse<TResult> {
  if (!raw || typeof raw !== 'object') {
    throw new McpTransportError('mcp_response_invalid', 'MCP response was not a JSON object.');
  }
  const value = raw as Partial<McpJsonRpcResponse<TResult>>;
  return {
    jsonrpc: '2.0',
    id: value.id ?? expectedRequest?.id ?? null,
    result: value.result,
    error: value.error,
  };
}

function parseSseEvent(block: string): SseEvent | null {
  const lines = block.split('\n');
  let event = 'message';
  const data: string[] = [];
  for (const line of lines) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    if (line.startsWith('data:')) data.push(line.slice(5).trim());
  }
  if (data.length === 0) return null;
  return { event, data: data.join('\n') };
}

function parseJsonEvent(data: string): unknown | null {
  try {
    return JSON.parse(data);
  } catch {
    return null;
  }
}
