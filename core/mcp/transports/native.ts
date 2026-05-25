import type {
  McpJsonRpcNotification,
  McpJsonRpcRequest,
  McpJsonRpcResponse,
  McpProtocolTransport,
  McpServerConfig,
} from '../types';
import { McpTransportError, normalizeJsonRpcResponse } from './common';

interface McpNativeEnvelope {
  protocol: 'deepseek-pp-mcp-native';
  version: 1;
  server: {
    id: string;
    command?: string;
    args?: string[];
    cwd?: string;
    env?: Record<string, string>;
  };
  message: McpJsonRpcRequest<any> | McpJsonRpcNotification;
}

export function createMcpNativeMessagingTransport(server: McpServerConfig): McpProtocolTransport {
  return {
    request(request, options) {
      return sendNativeMessage(server, request, options?.timeoutMs);
    },
    async notify(notification, options) {
      await sendNativeMessage(server, notification, options?.timeoutMs);
    },
  };
}

async function sendNativeMessage<TParams extends Record<string, unknown> | undefined, TResult>(
  server: McpServerConfig,
  message: McpJsonRpcRequest<TParams> | McpJsonRpcNotification,
  timeoutMs: number = server.timeouts.requestMs,
): Promise<McpJsonRpcResponse<TResult>> {
  const nativeHost = server.transport.nativeHost;
  if (!nativeHost) {
    throw new McpTransportError('mcp_native_host_missing', 'Native messaging host is not configured.', {
      retryable: false,
    });
  }
  if (!chrome.runtime?.sendNativeMessage) {
    throw new McpTransportError('mcp_native_messaging_unavailable', 'Browser native messaging is unavailable.', {
      retryable: false,
    });
  }

  const expectedRequest = 'id' in message ? message as McpJsonRpcRequest<TParams> : undefined;
  const response = await withTimeout(
    sendNativeEnvelope(nativeHost, createNativeEnvelope(server, message)),
    timeoutMs,
  );
  return normalizeJsonRpcResponse<TResult>(response, expectedRequest);
}

function sendNativeEnvelope(host: string, envelope: McpNativeEnvelope): Promise<unknown> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendNativeMessage(host, envelope, (response) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new McpTransportError('mcp_native_host_unavailable', error.message || 'Native messaging host is unavailable.', { retryable: false }));
        return;
      }
      resolve(response);
    });
  });
}

function createNativeEnvelope(
  server: McpServerConfig,
  message: McpJsonRpcRequest<any> | McpJsonRpcNotification,
): McpNativeEnvelope {
  return {
    protocol: 'deepseek-pp-mcp-native',
    version: 1,
    server: {
      id: server.id,
      command: server.transport.command,
      args: server.transport.args,
      cwd: server.transport.cwd,
      env: server.transport.env,
    },
    message,
  };
}

function withTimeout<T>(task: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new McpTransportError('mcp_native_timeout', `Native MCP request exceeded ${timeoutMs} ms.`));
    }, timeoutMs);
    task.then(resolve, reject).finally(() => clearTimeout(timeout));
  });
}
