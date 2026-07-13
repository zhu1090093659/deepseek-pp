export const MCP_PROTOCOL_CONTRACT = {
  requestVersion: '2025-06-18',
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

export const MCP_CURRENT_GAPS = [
  {
    name: 'response normalization accepts a wrong id and result plus error while rewriting jsonrpc',
    currentBehavior: 'shallow-normalization',
    target: 'strict-json-rpc-response-codec-after-T3.5',
  },
  {
    name: 'tool output budget counts JavaScript characters rather than UTF-8 bytes',
    currentBehavior: 'utf16-slice-can-split-surrogate-pairs',
    target: 'byte-accurate-output-budget-after-T5.1',
  },
  {
    name: 'tool pagination can append a full page beyond maxToolCount',
    currentBehavior: 'page-level-limit-check',
    target: 'explicit-shell-catalog-limit-after-T4.5',
  },
] as const;

export const MCP_UNKNOWN_TRANSPORT_CONTRACT = {
  errorCode: 'mcp_transport_unsupported',
  networkRequests: 0,
} as const;
