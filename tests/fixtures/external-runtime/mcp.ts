export const MCP_PROTOCOL_CONTRACT = {
  requestVersion: '2025-06-18',
  supportedVersions: ['2024-11-05', '2025-03-26', '2025-06-18'],
  clientCapabilities: {},
  nativeEnvelopeProtocol: 'deepseek-pp-mcp-native',
  nativeEnvelopeVersion: 1,
  transportKinds: ['http', 'sse', 'streamable_http', 'stdio_bridge', 'native_messaging'],
  handshakeMethods: ['initialize', 'notifications/initialized', 'tools/list'],
} as const;

export const MCP_PROTOCOL_NEGOTIATION_FIXTURES = [
  {
    name: 'known protocol version',
    serverVersion: MCP_PROTOCOL_CONTRACT.requestVersion,
    currentOutput: MCP_PROTOCOL_CONTRACT.requestVersion,
    classification: 'legal',
  },
  {
    name: 'supported 2025-03-26 protocol version',
    serverVersion: '2025-03-26',
    currentOutput: '2025-03-26',
    classification: 'legal',
  },
  {
    name: 'supported 2024-11-05 protocol version',
    serverVersion: '2024-11-05',
    currentOutput: '2024-11-05',
    classification: 'legal',
  },
  {
    name: 'missing server protocol version',
    serverVersion: undefined,
    currentOutput: MCP_PROTOCOL_CONTRACT.requestVersion,
    classification: 'legacy-fallback',
  },
  {
    name: 'arbitrary future server protocol version',
    serverVersion: '2099-12-31',
    currentOutput: undefined,
    classification: 'unsupported',
    errorCode: 'mcp_protocol_version_unsupported',
  },
  {
    name: 'empty advertised protocol version',
    serverVersion: '',
    currentOutput: undefined,
    classification: 'unsupported',
    errorCode: 'mcp_protocol_version_unsupported',
  },
  {
    name: 'numeric advertised protocol version',
    serverVersion: 20250618,
    currentOutput: undefined,
    classification: 'unsupported',
    errorCode: 'mcp_protocol_version_unsupported',
  },
  {
    name: 'null advertised protocol version',
    serverVersion: null,
    currentOutput: undefined,
    classification: 'unsupported',
    errorCode: 'mcp_protocol_version_unsupported',
  },
  {
    name: 'object advertised protocol version',
    serverVersion: { version: MCP_PROTOCOL_CONTRACT.requestVersion },
    currentOutput: undefined,
    classification: 'unsupported',
    errorCode: 'mcp_protocol_version_unsupported',
  },
] as const;

export const MCP_NATIVE_ENVELOPE_FIXTURE = {
  protocol: 'deepseek-pp-mcp-native',
  version: 1,
  server: {
    id: 'native-contract',
    command: 'node',
    args: ['server.mjs'],
    cwd: '/tmp/native-contract',
    env: { CONTRACT_ENV: 'visible' },
  },
  message: {
    jsonrpc: '2.0',
    method: 'notifications/initialized',
  },
} as const;

export const MCP_STRICT_RESPONSE_REJECTIONS = [
  {
    name: 'wrong JSON-RPC version',
    response: { jsonrpc: '1.0', id: 'expected-id', result: { value: true } },
  },
  {
    name: 'wrong request id',
    response: { jsonrpc: '2.0', id: 'wrong-id', result: { value: true } },
  },
  {
    name: 'result and error together',
    response: {
      jsonrpc: '2.0',
      id: 'expected-id',
      result: { value: true },
      error: { code: -32000, message: 'also present' },
    },
  },
  {
    name: 'neither result nor error',
    response: { jsonrpc: '2.0', id: 'expected-id' },
  },
  {
    name: 'malformed error object',
    response: { jsonrpc: '2.0', id: 'expected-id', error: { code: '-32000', message: null } },
  },
  {
    name: 'fractional error code',
    response: { jsonrpc: '2.0', id: 'expected-id', error: { code: -32000.5, message: 'invalid code' } },
  },
] as const;

export const MCP_CURRENT_GAPS = [] as const;

export const MCP_UNKNOWN_TRANSPORT_CONTRACT = {
  errorCode: 'mcp_transport_unsupported',
  networkRequests: 0,
} as const;
