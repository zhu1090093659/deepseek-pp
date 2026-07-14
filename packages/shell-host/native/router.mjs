import { MCP_PROTOCOL_VERSION } from './contracts.mjs';

export function createNativeRouter({ toolDefinitions, toolHandlerGroups, logger }) {
  const toolHandlers = createToolRegistry(toolDefinitions, toolHandlerGroups);
  const methodHandlers = new Map([
    ['initialize', id => jsonRpcResult(id, {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: { tools: {} },
      serverInfo: { name: 'deepseek-pp-shell', version: '1.0.0' },
      instructions: 'General-purpose shell execution host. Use shell_exec for local commands and python_exec only for short computation or validation snippets.',
    })],
    ['tools/list', id => jsonRpcResult(id, { tools: toolDefinitions })],
    ['tools/call', async (id, params) => {
      const name = params?.name;
      const args = params?.arguments ?? {};
      if (logger.hasFile) {
        const contentLength = typeof args?.content === 'string' ? args.content.length : 0;
        const argumentBytes = Buffer.byteLength(JSON.stringify(args), 'utf8');
        logger.logLine(`tools/call name=${name} argsBytes=${argumentBytes}${contentLength > 0 ? ` contentChars=${contentLength}` : ''}`);
      }
      const handler = toolHandlers.get(name);
      if (!handler) return jsonRpcError(id, -32602, `Unknown tool: ${name}`);
      return jsonRpcResult(id, await handler(args));
    }],
  ]);

  return {
    async handleEnvelope(envelope) {
      if (!envelope || envelope.protocol !== 'deepseek-pp-mcp-native' || envelope.version !== 1) {
        return jsonRpcError(null, -32600, 'Invalid envelope: expected deepseek-pp-mcp-native v1');
      }
      const message = envelope.message;
      if (!message || typeof message !== 'object' || message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
        return jsonRpcError(null, -32600, 'Invalid JSON-RPC request.');
      }
      if (!('id' in message)) return null;

      const id = message.id ?? null;
      const handler = methodHandlers.get(message.method);
      if (!handler) return jsonRpcError(id, -32601, `Unsupported method: ${message.method}`);
      return handler(id, message.params);
    },
  };
}

export function createToolRegistry(toolDefinitions, toolHandlerGroups) {
  const expectedNames = toolDefinitions.map(definition => definition.name);
  const expected = new Set(expectedNames);
  if (expected.size !== expectedNames.length) throw new Error('Shell tool catalog contains duplicate names.');

  const handlers = new Map();
  for (const group of toolHandlerGroups) {
    for (const registration of group) {
      if (!expected.has(registration.name)) {
        throw new Error(`Shell tool handler is not declared in the catalog: ${registration.name}`);
      }
      if (handlers.has(registration.name)) {
        throw new Error(`Shell tool handler registered more than once: ${registration.name}`);
      }
      handlers.set(registration.name, registration.handle);
    }
  }

  const missing = expectedNames.filter(name => !handlers.has(name));
  if (missing.length > 0) throw new Error(`Shell tool handlers missing: ${missing.join(', ')}`);
  return handlers;
}

export function jsonRpcResult(id, result) {
  return { jsonrpc: '2.0', id, result };
}

export function jsonRpcError(id, code, message, data) {
  return { jsonrpc: '2.0', id, error: { code, message, ...(data ? { data } : {}) } };
}
