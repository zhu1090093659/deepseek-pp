import type {
  McpServerConfig,
  McpServerStorageState,
  McpServerTransportConfig,
  McpToolCacheEntry,
} from '../../../core/mcp/types';
import type { ToolDescriptor } from '../../../core/tool/types';
import {
  createMcpDescriptorId,
  createMcpInvocationName,
} from '../../../core/mcp/descriptor-identity';

const CREATED_AT = 1_750_000_000_000;

export const MCP_SERVER_IDS = {
  http: 'contract-http',
  sse: 'contract-sse',
  streamable: 'contract-streamable',
  bridge: 'contract-bridge',
  shell: 'contract-shell',
} as const;

const shellServer = createServer(MCP_SERVER_IDS.shell, {
  kind: 'native_messaging',
  nativeHost: 'com.deepseek.pp.shell',
}, {
  headers: [{ name: 'X-Contract', value: 'preserve' }],
  secrets: [{
    id: 'secret-contract-shell',
    kind: 'bearer',
    value: 'contract-secret-value',
  }],
  allowlist: {
    mode: 'allow',
    toolNames: ['shell_exec', 'shell_status', 'python_status', 'python_exec'],
  },
});

export const MCP_CACHE_DESCRIPTOR: ToolDescriptor = {
  id: createMcpDescriptorId(MCP_SERVER_IDS.shell, 'shell_status'),
  provider: {
    kind: 'mcp',
    id: MCP_SERVER_IDS.shell,
    displayName: shellServer.displayName,
    transport: 'native_messaging',
  },
  name: 'shell_status',
  invocationName: createMcpInvocationName(MCP_SERVER_IDS.shell, 'shell_status'),
  title: 'Shell status',
  description: 'Read the Shell MCP host status.',
  inputSchema: {
    type: 'object',
    properties: {},
    additionalProperties: false,
  },
  execution: {
    mode: 'auto',
    enabled: true,
    risk: 'low',
    timeoutMs: 2_000,
    maxResultBytes: 64_000,
  },
  annotations: {
    mcpServerId: MCP_SERVER_IDS.shell,
    mcpToolName: 'shell_status',
  },
};

export const MCP_CACHE_ENTRY: McpToolCacheEntry = {
  serverId: MCP_SERVER_IDS.shell,
  descriptors: [MCP_CACHE_DESCRIPTOR],
  refreshedAt: CREATED_AT + 100,
  expiresAt: CREATED_AT + 60_100,
  health: {
    serverId: MCP_SERVER_IDS.shell,
    status: 'ready',
    checkedAt: CREATED_AT + 100,
    latencyMs: 12,
    toolCount: 1,
    error: null,
  },
};

export const MCP_STORAGE_V1: McpServerStorageState = {
  version: 1,
  servers: [
    createServer(MCP_SERVER_IDS.http, {
      kind: 'http',
      url: 'https://mcp.example.test/http',
    }),
    createServer(MCP_SERVER_IDS.sse, {
      kind: 'sse',
      url: 'https://mcp.example.test/sse',
    }),
    createServer(MCP_SERVER_IDS.streamable, {
      kind: 'streamable_http',
      url: 'https://mcp.example.test/mcp',
    }),
    createServer(MCP_SERVER_IDS.bridge, {
      kind: 'stdio_bridge',
      url: 'http://127.0.0.1:18472/rpc',
      command: 'node',
      args: ['bridge.mjs'],
      cwd: '/tmp/mcp-contract',
      env: { CONTRACT_MODE: '1' },
    }),
    shellServer,
  ],
  toolCaches: [MCP_CACHE_ENTRY],
};

export const MCP_STORAGE_V1_ADDITIVE_ROOT = {
  ...MCP_STORAGE_V1,
  additiveField: { preserve: true },
};

export const MCP_STORAGE_V1_COLLIDING_CACHE = {
  ...MCP_STORAGE_V1,
  toolCaches: [{
    ...MCP_CACHE_ENTRY,
    descriptors: [
      {
        ...MCP_CACHE_DESCRIPTOR,
        id: createMcpDescriptorId(MCP_SERVER_IDS.shell, 'foo-bar'),
        name: 'foo-bar',
        invocationName: createMcpInvocationName(MCP_SERVER_IDS.shell, 'foo-bar'),
        annotations: {
          mcpServerId: MCP_SERVER_IDS.shell,
          mcpToolName: 'foo-bar',
        },
      },
      {
        ...MCP_CACHE_DESCRIPTOR,
        id: createMcpDescriptorId(MCP_SERVER_IDS.shell, 'foo_bar'),
        name: 'foo_bar',
        invocationName: createMcpInvocationName(MCP_SERVER_IDS.shell, 'foo_bar'),
        annotations: {
          mcpServerId: MCP_SERVER_IDS.shell,
          mcpToolName: 'foo_bar',
        },
      },
    ],
    health: { ...MCP_CACHE_ENTRY.health, toolCount: 2 },
  }],
};

export const MCP_STORAGE_FORGED_CACHE_ANNOTATION = {
  ...MCP_STORAGE_V1,
  toolCaches: [{
    ...MCP_CACHE_ENTRY,
    descriptors: [{
      ...MCP_CACHE_DESCRIPTOR,
      annotations: {
        ...MCP_CACHE_DESCRIPTOR.annotations,
        mcpToolName: 'shell_exec',
      },
    }],
  }],
};

export const MCP_STORAGE_FORGED_CACHE_TRANSPORT = {
  ...MCP_STORAGE_V1,
  toolCaches: [{
    ...MCP_CACHE_ENTRY,
    descriptors: [{
      ...MCP_CACHE_DESCRIPTOR,
      provider: {
        ...MCP_CACHE_DESCRIPTOR.provider,
        transport: 'http',
      },
    }],
  }],
};

export const MCP_STORAGE_FUTURE_ROOT = {
  ...MCP_STORAGE_V1,
  version: 2,
  futureField: { preserve: true },
};

export const MCP_STORAGE_FUTURE_SERVER = {
  ...MCP_STORAGE_V1,
  servers: [
    { ...MCP_STORAGE_V1.servers[0], version: 2, futureField: 'preserve-server' },
    ...MCP_STORAGE_V1.servers.slice(1),
  ],
};

export const MCP_STORAGE_FUTURE_TRANSPORT = {
  ...MCP_STORAGE_V1,
  servers: MCP_STORAGE_V1.servers.map((server, index) => index === 0
    ? {
        ...server,
        transport: { kind: 'websocket', url: 'wss://future.example.test/mcp' },
      }
    : server),
};

export const MCP_STORAGE_CORRUPT_SERVER = {
  ...MCP_STORAGE_V1,
  servers: [{ ...MCP_STORAGE_V1.servers[0], id: '' }, ...MCP_STORAGE_V1.servers.slice(1)],
};

export const MCP_STORAGE_DUPLICATE_SERVER = {
  ...MCP_STORAGE_V1,
  servers: [...MCP_STORAGE_V1.servers, { ...MCP_STORAGE_V1.servers[0] }],
};

export const MCP_STORAGE_ORPHAN_CACHE = {
  ...MCP_STORAGE_V1,
  toolCaches: [{
    ...MCP_CACHE_ENTRY,
    serverId: 'missing-server',
    descriptors: [],
    health: { ...MCP_CACHE_ENTRY.health, serverId: 'missing-server', toolCount: 0 },
  }],
};

function createServer(
  id: string,
  transport: McpServerTransportConfig,
  patch: Partial<McpServerConfig> = {},
): McpServerConfig {
  return {
    version: 1,
    id,
    displayName: `Contract ${id}`,
    enabled: true,
    transport,
    headers: [],
    secrets: [],
    timeouts: {
      connectMs: 10_000,
      requestMs: 60_000,
      discoveryMs: 20_000,
    },
    limits: {
      maxResultBytes: 64_000,
      maxToolCount: 128,
    },
    allowlist: {
      mode: 'all',
      toolNames: [],
    },
    execution: {
      mode: 'auto',
      enabled: true,
    },
    status: 'ready',
    lastConnectedAt: CREATED_AT,
    lastError: null,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    ...patch,
  };
}
