export {
  McpTransportError,
  drainSseEvents,
  ensureMcpServerOriginPermission,
  fetchWithTimeout,
  getMcpEndpointUrl,
  getMcpOriginPattern,
  normalizeJsonRpcResponse,
  readJsonRpcResponse,
  readSseJsonRpcResponse,
  requestMcpServerOriginPermission,
} from './common';

export type {
  SseEvent,
} from './common';

export {
  createMcpHttpTransport,
  createMcpStreamableHttpTransport,
} from './http';

export {
  createMcpSseTransport,
} from './sse';

export {
  createMcpBridgeTransport,
} from './bridge';

export {
  createMcpNativeMessagingTransport,
} from './native';

import type { McpProtocolTransport, McpServerConfig } from '../types';
import { createMcpBridgeTransport } from './bridge';
import { McpTransportError } from './common';
import { createMcpHttpTransport, createMcpStreamableHttpTransport } from './http';
import { createMcpNativeMessagingTransport } from './native';
import { createMcpSseTransport } from './sse';

export function createMcpTransport(server: McpServerConfig): McpProtocolTransport {
  switch (server.transport.kind) {
    case 'http':
      return createMcpHttpTransport(server);
    case 'sse':
      return createMcpSseTransport(server);
    case 'streamable_http':
      return createMcpStreamableHttpTransport(server);
    case 'stdio_bridge':
      return createMcpBridgeTransport(server);
    case 'native_messaging':
      return createMcpNativeMessagingTransport(server);
    default:
      throw new McpTransportError(
        'mcp_transport_unsupported',
        'Unsupported MCP transport.',
        { retryable: false },
      );
  }
}
