import type {
  McpServerConfig,
  McpServerHealth,
  McpToolCacheEntry,
} from '../mcp/types';
import type {
  BrowserControlSettings,
  BrowserControlState,
  BrowserControlTarget,
} from '../browser-control/types';
import type { PlatformEnvironment } from '../platform/capabilities';
import type { SandboxRunRequest } from '../sandbox/types';
import type {
  MessageAction,
  ToolAuthorizationGrantSummary,
  ToolCallHistoryRecord,
  ToolDescriptor,
  ToolResult,
} from '../types';
import type { WebSearchToolName } from '../tool/web-search';
import type { WebToolSettings } from '../tool/web-settings';

type DeclaredRuntimeRequest<TType extends MessageAction['type']> = Extract<
  MessageAction,
  { type: TType }
>;

type Ack = { ok: true };
type DomainFailure = { ok: false; error: string };

export interface WebSearchDiagnostic {
  status: number;
  length: number;
  error?: string;
  preview?: string;
}

export type WebSearchDiagnostics = Record<string, WebSearchDiagnostic>;

export type McpServerPermissionResponse =
  | { ok: boolean; origin: string | null }
  | DomainFailure;

export interface McpServerConnectionResponse {
  ok: boolean;
  cache: McpToolCacheEntry;
  health: McpServerHealth;
}

export type HostPermissionResponse =
  | { ok: boolean; origins: string[] }
  | DomainFailure;

export interface ToolRuntimeCommandContracts {
  GET_MCP_SERVERS: {
    request: DeclaredRuntimeRequest<'GET_MCP_SERVERS'>;
    response: McpServerConfig[];
  };
  GET_MCP_SERVER: {
    request: DeclaredRuntimeRequest<'GET_MCP_SERVER'>;
    response: McpServerConfig | null;
  };
  CREATE_MCP_SERVER: {
    request: DeclaredRuntimeRequest<'CREATE_MCP_SERVER'>;
    response: McpServerConfig;
  };
  UPDATE_MCP_SERVER: {
    request: DeclaredRuntimeRequest<'UPDATE_MCP_SERVER'>;
    response: McpServerConfig | null;
  };
  DELETE_MCP_SERVER: {
    request: DeclaredRuntimeRequest<'DELETE_MCP_SERVER'>;
    response: Ack;
  };
  GET_MCP_TOOL_CACHE: {
    request: DeclaredRuntimeRequest<'GET_MCP_TOOL_CACHE'>;
    response: McpToolCacheEntry | null;
  };
  REFRESH_MCP_SERVER_TOOLS: {
    request: DeclaredRuntimeRequest<'REFRESH_MCP_SERVER_TOOLS'>;
    response: McpToolCacheEntry;
  };
  REQUEST_MCP_SERVER_PERMISSION: {
    request: { type: 'REQUEST_MCP_SERVER_PERMISSION'; payload: { serverId: string } };
    response: McpServerPermissionResponse;
  };
  TEST_MCP_SERVER_CONNECTION: {
    request: { type: 'TEST_MCP_SERVER_CONNECTION'; payload: { serverId: string } };
    response: McpServerConnectionResponse;
  };
  GET_WEB_TOOL_SETTINGS: {
    request: { type: 'GET_WEB_TOOL_SETTINGS' };
    response: WebToolSettings;
  };
  SET_WEB_TOOL_SETTING: {
    request: {
      type: 'SET_WEB_TOOL_SETTING';
      payload: { name: WebSearchToolName; enabled: boolean };
    };
    response: Ack;
  };
  GET_BROWSER_CONTROL_SETTINGS: {
    request: { type: 'GET_BROWSER_CONTROL_SETTINGS' };
    response: BrowserControlSettings;
  };
  SAVE_BROWSER_CONTROL_SETTINGS: {
    request: {
      type: 'SAVE_BROWSER_CONTROL_SETTINGS';
      payload?: Partial<BrowserControlSettings>;
    };
    response: BrowserControlSettings;
  };
  SET_BROWSER_CONTROL_ENABLED: {
    request: { type: 'SET_BROWSER_CONTROL_ENABLED'; payload: { enabled: boolean } };
    response: BrowserControlSettings;
  };
  GET_BROWSER_CONTROL_STATE: {
    request: { type: 'GET_BROWSER_CONTROL_STATE' };
    response: BrowserControlState;
  };
  SET_BROWSER_CONTROL_TARGET: {
    request: { type: 'SET_BROWSER_CONTROL_TARGET'; payload: { tabId: number } };
    response: { ok: true; target: BrowserControlTarget };
  };
  DETACH_BROWSER_CONTROL: {
    request: { type: 'DETACH_BROWSER_CONTROL' };
    response: Ack;
  };
  DIAGNOSE_WEB_SEARCH: {
    request: { type: 'DIAGNOSE_WEB_SEARCH'; payload?: { query?: string } };
    response: WebSearchDiagnostics;
  };
  REQUEST_HOST_PERMISSION: {
    request: { type: 'REQUEST_HOST_PERMISSION'; payload: { origins: string[] } };
    response: HostPermissionResponse;
  };
  GET_TOOL_DESCRIPTORS: {
    request: DeclaredRuntimeRequest<'GET_TOOL_DESCRIPTORS'>;
    response: ToolDescriptor[];
  };
  REFRESH_TOOL_DESCRIPTORS: {
    request: DeclaredRuntimeRequest<'REFRESH_TOOL_DESCRIPTORS'>;
    response: ToolDescriptor[];
  };
  CREATE_TOOL_AUTHORIZATION: {
    request: DeclaredRuntimeRequest<'CREATE_TOOL_AUTHORIZATION'>;
    response: ToolAuthorizationGrantSummary | DomainFailure;
  };
  CLOSE_TOOL_AUTHORIZATION: {
    request: DeclaredRuntimeRequest<'CLOSE_TOOL_AUTHORIZATION'>;
    response: Ack | DomainFailure;
  };
  APPEND_EXTERNAL_TOOL_PAYLOAD_CHUNK: {
    request: DeclaredRuntimeRequest<'APPEND_EXTERNAL_TOOL_PAYLOAD_CHUNK'>;
    response: Ack | DomainFailure | ToolResult;
  };
  EXECUTE_TOOL_CALL: {
    request: DeclaredRuntimeRequest<'EXECUTE_TOOL_CALL'>;
    response: ToolResult;
  };
  RUN_ARTIFACT_CODE: {
    request: { type: 'RUN_ARTIFACT_CODE'; payload: SandboxRunRequest };
    response: ToolResult;
  };
  GET_TOOL_CALL_HISTORY: {
    request: DeclaredRuntimeRequest<'GET_TOOL_CALL_HISTORY'>;
    response: ToolCallHistoryRecord[];
  };
  CLEAR_TOOL_CALL_HISTORY: {
    request: DeclaredRuntimeRequest<'CLEAR_TOOL_CALL_HISTORY'>;
    response: Ack;
  };
  GET_PLATFORM_CAPABILITIES: {
    request: DeclaredRuntimeRequest<'GET_PLATFORM_CAPABILITIES'>;
    response: PlatformEnvironment;
  };
}
