export const RUNTIME_TOPOLOGY = {
  liveCommands: 121,
  declaredActions: 91,
  shared: 89,
  liveOnly: 32,
  declaredOnly: 2,
  readsPayload: 77,
  ignoresPayload: 44,
  directPayloadCasts: 71,
} as const;

export type RuntimeRequestBoundary = 'none' | 'payload-cast' | 'payload-delegated';
export type RuntimeResponseFamily =
  | 'value'
  | 'nullable-value'
  | 'ack'
  | 'status'
  | 'domain-error'
  | 'status-or-domain-error'
  | 'value-or-domain-error'
  | 'tool-result'
  | 'unrouted';
export type RuntimeErrorFamily = 'background-error' | 'tool-error' | 'none';
export type RuntimeCommandSurface = 'live-and-declared' | 'live-only' | 'declared-only';
export type RuntimePayloadPresence = 'none' | 'required' | 'optional';

export interface RuntimeCommandContract {
  surface: RuntimeCommandSurface;
  request: {
    access: RuntimeRequestBoundary;
    presence: RuntimePayloadPresence;
  };
  response: RuntimeResponseFamily;
  error: RuntimeErrorFamily;
}

function command(
  request: RuntimeRequestBoundary,
  response: RuntimeResponseFamily,
  error: RuntimeErrorFamily = 'background-error',
  surface: RuntimeCommandSurface = 'live-and-declared',
  presence: RuntimePayloadPresence = request === 'none' ? 'none' : 'required',
): RuntimeCommandContract {
  return { surface, request: { access: request, presence }, response, error };
}

export const RUNTIME_COMMAND_CONTRACTS = {
  GET_MEMORIES: command('none', 'value'),
  GET_MEMORY_BY_ID: command('payload-cast', 'nullable-value'),
  SAVE_MEMORY: command('payload-cast', 'value'),
  IMPORT_MEMORY_DRAFTS: command('payload-cast', 'status-or-domain-error'),
  UPDATE_MEMORY: command('payload-cast', 'ack'),
  DELETE_MEMORY: command('payload-cast', 'ack'),
  TOUCH_MEMORIES: command('payload-cast', 'ack', 'background-error', 'live-only'),
  GET_SKILLS: command('none', 'value'),
  GET_SKILL_LIBRARY: command('none', 'value'),
  GET_SKILL_SOURCES: command('none', 'value'),
  GET_GITHUB_SKILL_SOURCES: command('none', 'value'),
  SAVE_SKILL: command('payload-cast', 'ack'),
  DELETE_SKILL: command('payload-cast', 'ack'),
  SET_SKILL_ENABLED: command('payload-cast', 'ack'),
  SET_SKILLS_ENABLED: command('payload-cast', 'ack'),
  PREVIEW_GITHUB_SKILL_SOURCE: command('payload-cast', 'value'),
  IMPORT_GITHUB_SKILL_SOURCE: command('payload-cast', 'value'),
  PREVIEW_LOCAL_SKILL_SOURCE: command('payload-cast', 'value'),
  PICK_LOCAL_SKILL_FOLDER: command('payload-delegated', 'value', 'background-error', 'live-and-declared', 'optional'),
  IMPORT_LOCAL_SKILL_SOURCE: command('payload-cast', 'value-or-domain-error'),
  CHECK_GITHUB_SKILL_SOURCE_UPDATES: command('payload-cast', 'value'),
  UPDATE_GITHUB_SKILL_SOURCE: command('payload-cast', 'value'),
  DELETE_GITHUB_SKILL_SOURCE: command('payload-cast', 'ack'),
  GET_PRESETS: command('none', 'value'),
  SAVE_PRESET: command('payload-cast', 'ack'),
  DELETE_PRESET: command('payload-cast', 'ack'),
  SET_ACTIVE_PRESET: command('payload-cast', 'ack'),
  GET_ACTIVE_PRESET: command('none', 'nullable-value'),
  GET_PROMPT_INJECTION_SETTINGS: command('none', 'value'),
  SAVE_PROMPT_INJECTION_SETTINGS: command('payload-cast', 'value'),
  GET_SAVED_ITEMS: command('none', 'value'),
  SAVE_SAVED_ITEM: command('payload-cast', 'value'),
  DELETE_SAVED_ITEM: command('payload-cast', 'ack'),
  INSERT_SAVED_PROMPT_INTO_CHAT: command('payload-delegated', 'status-or-domain-error'),
  GET_VOICE_SETTINGS: command('none', 'value'),
  SAVE_VOICE_SETTINGS: command('payload-cast', 'value'),
  GET_VOICE_CAPABILITIES: command('none', 'value'),
  GET_MCP_SERVERS: command('none', 'value'),
  GET_MCP_SERVER: command('payload-cast', 'nullable-value'),
  CREATE_MCP_SERVER: command('payload-cast', 'value'),
  UPDATE_MCP_SERVER: command('payload-cast', 'nullable-value'),
  DELETE_MCP_SERVER: command('payload-cast', 'ack'),
  GET_MCP_TOOL_CACHE: command('payload-cast', 'nullable-value'),
  REFRESH_MCP_SERVER_TOOLS: command('payload-cast', 'value'),
  REQUEST_MCP_SERVER_PERMISSION: command('payload-cast', 'status-or-domain-error', 'background-error', 'live-only'),
  TEST_MCP_SERVER_CONNECTION: command('payload-cast', 'status', 'background-error', 'live-only'),
  GET_WEB_TOOL_SETTINGS: command('none', 'value', 'background-error', 'live-only'),
  SET_WEB_TOOL_SETTING: command('payload-cast', 'ack', 'background-error', 'live-only'),
  GET_BROWSER_CONTROL_SETTINGS: command('none', 'value', 'background-error', 'live-only'),
  SAVE_BROWSER_CONTROL_SETTINGS: command('payload-cast', 'value', 'background-error', 'live-only'),
  SET_BROWSER_CONTROL_ENABLED: command('payload-cast', 'value', 'background-error', 'live-only'),
  GET_BROWSER_CONTROL_STATE: command('none', 'value', 'background-error', 'live-only'),
  SET_BROWSER_CONTROL_TARGET: command('payload-cast', 'status', 'background-error', 'live-only'),
  DETACH_BROWSER_CONTROL: command('none', 'ack', 'background-error', 'live-only'),
  DIAGNOSE_WEB_SEARCH: command('payload-cast', 'value', 'background-error', 'live-only'),
  REQUEST_HOST_PERMISSION: command('payload-cast', 'status-or-domain-error', 'background-error', 'live-only'),
  GET_TOOL_DESCRIPTORS: command('none', 'value'),
  REFRESH_TOOL_DESCRIPTORS: command('none', 'value'),
  CREATE_TOOL_AUTHORIZATION: command('payload-cast', 'value-or-domain-error'),
  CLOSE_TOOL_AUTHORIZATION: command('payload-cast', 'ack'),
  APPEND_EXTERNAL_TOOL_PAYLOAD_CHUNK: command('payload-cast', 'status-or-domain-error'),
  EXECUTE_TOOL_CALL: command('payload-cast', 'tool-result', 'tool-error'),
  RUN_ARTIFACT_CODE: command('payload-cast', 'tool-result'),
  GET_TOOL_CALL_HISTORY: command('payload-cast', 'value', 'background-error', 'live-and-declared', 'optional'),
  CLEAR_TOOL_CALL_HISTORY: command('none', 'ack'),
  GET_PLATFORM_CAPABILITIES: command('none', 'value'),
  GET_PROJECT_CONTEXT_STATE: command('none', 'value'),
  CREATE_PROJECT_CONTEXT: command('payload-cast', 'value'),
  UPDATE_PROJECT_CONTEXT: command('payload-cast', 'value'),
  DELETE_PROJECT_CONTEXT: command('payload-cast', 'status'),
  ADD_CONVERSATION_TO_PROJECT: command('payload-cast', 'status'),
  REMOVE_CONVERSATION_FROM_PROJECT: command('payload-cast', 'ack'),
  SET_PENDING_PROJECT_CONTEXT: command('payload-cast', 'ack'),
  GET_CURRENT_DEEPSEEK_CONVERSATION: command('none', 'status-or-domain-error'),
  GET_PROJECT_CONTEXT_FOR_CONVERSATION: command('payload-cast', 'nullable-value'),
  GET_ARTIFACT: command('payload-cast', 'status-or-domain-error'),
  GET_CONFIG: command('none', 'value'),
  WHATS_NEW_DISMISSED: command('none', 'ack', 'background-error', 'live-only'),
  GET_DEEPSEEK_API_KEY_STATUS: command('none', 'status', 'background-error', 'live-only'),
  SAVE_DEEPSEEK_API_KEY: command('payload-cast', 'status', 'background-error', 'live-only'),
  CLEAR_DEEPSEEK_API_KEY: command('none', 'status', 'background-error', 'live-only'),
  GET_MULTIMODAL_SETTINGS_STATUS: command('none', 'status'),
  SAVE_MULTIMODAL_SETTINGS: command('payload-cast', 'status'),
  CLEAR_MULTIMODAL_SETTINGS: command('none', 'status'),
  ANALYZE_MULTIMODAL_MEDIA: command('payload-cast', 'status-or-domain-error'),
  GET_DEEPSEEK_THEME: command('none', 'value'),
  SET_DEEPSEEK_THEME: command('payload-cast', 'status-or-domain-error'),
  GET_MODEL_TYPE: command('none', 'nullable-value'),
  SET_MODEL_TYPE: command('payload-cast', 'ack'),
  RECORD_USAGE_TURN: command('payload-cast', 'value'),
  GET_USAGE_SUMMARY: command('payload-delegated', 'value', 'background-error', 'live-and-declared', 'optional'),
  CLEAR_USAGE_STATS: command('none', 'ack'),
  GET_BACKGROUND: command('none', 'nullable-value'),
  SAVE_BACKGROUND: command('payload-cast', 'ack'),
  CLEAR_BACKGROUND: command('none', 'ack'),
  GET_PET: command('none', 'value'),
  SAVE_PET: command('payload-cast', 'ack'),
  CLEAR_PET: command('none', 'ack'),
  GET_SYNC_CONFIG: command('none', 'nullable-value'),
  SAVE_SYNC_CONFIG: command('payload-cast', 'ack'),
  WEBDAV_TEST: command('payload-cast', 'ack'),
  SYNC_AUTHORIZE: command('payload-cast', 'status'),
  WEBDAV_UPLOAD_LOCAL: command('none', 'status'),
  WEBDAV_DOWNLOAD_REMOTE: command('none', 'status'),
  CHAT_SUBMIT_PROMPT: command('payload-cast', 'status-or-domain-error', 'background-error', 'live-only'),
  UPLOAD_DEEPSEEK_IMAGE: command('payload-delegated', 'status-or-domain-error', 'background-error', 'live-only'),
  CHAT_NEW_SESSION: command('none', 'ack', 'background-error', 'live-only'),
  GET_AUTH_STATUS: command('none', 'value', 'background-error', 'live-only'),
  GET_OFFICIAL_API_CHAT_CONFIG: command('none', 'value'),
  SAVE_OFFICIAL_API_CHAT_CONFIG: command('payload-delegated', 'value'),
  EXPORT_DEEPSEEK_CONVERSATIONS: command('payload-delegated', 'status-or-domain-error', 'background-error', 'live-only'),
  CANCEL_DEEPSEEK_EXPORT: command('payload-cast', 'status-or-domain-error', 'background-error', 'live-only'),
  AUTH_STATUS_CHANGED: command('none', 'ack', 'background-error', 'live-only'),
  GET_AUTOMATIONS: command('none', 'value', 'background-error', 'live-only'),
  GET_AUTOMATION_RUNS: command('payload-cast', 'value', 'background-error', 'live-only'),
  CREATE_AUTOMATION: command('payload-cast', 'value', 'background-error', 'live-only'),
  UPDATE_AUTOMATION: command('payload-cast', 'value-or-domain-error', 'background-error', 'live-only'),
  SET_AUTOMATION_STATUS: command('payload-cast', 'value-or-domain-error', 'background-error', 'live-only'),
  DELETE_AUTOMATION: command('payload-cast', 'ack', 'background-error', 'live-only'),
  RUN_AUTOMATION_NOW: command('payload-cast', 'value', 'background-error', 'live-only'),
  SCENARIOS_UPDATED: command('none', 'ack', 'background-error', 'live-only'),
  TOOL_CALL_EXECUTED: command('payload-cast', 'unrouted', 'none', 'declared-only'),
  MEMORIES_UPDATED: command('none', 'unrouted', 'none', 'declared-only'),
} as const satisfies Record<string, RuntimeCommandContract>;

export const RUNTIME_REQUEST_FIXTURES = [
  {
    name: 'command without payload',
    family: 'none',
    message: { type: 'GET_MEMORIES' },
  },
  {
    name: 'command with required payload',
    family: 'required',
    message: { type: 'GET_MEMORY_BY_ID', payload: { id: 7 } },
  },
  {
    name: 'command with optional payload',
    family: 'optional',
    message: { type: 'GET_TOOL_CALL_HISTORY', payload: { limit: 25 } },
  },
  {
    name: 'tool execution command',
    family: 'tool-call',
    message: {
      type: 'EXECUTE_TOOL_CALL',
      payload: {
        id: 'call-contract-1',
        name: 'unsupported_contract_tool',
        payload: {},
        raw: '<unsupported_contract_tool>{}</unsupported_contract_tool>',
        source: { trigger: 'manual_chat', requestId: 'request-contract-1' },
      },
    },
  },
  {
    name: 'sandbox execution command',
    family: 'sandbox-request',
    message: {
      type: 'RUN_ARTIFACT_CODE',
      payload: { language: 'javascript', code: 'return 42;', timeoutMs: 5_000 },
    },
  },
] as const;

export const RUNTIME_RESPONSE_FIXTURES = [
  { name: 'raw collection', family: 'value', response: [{ id: 7, name: 'Contract memory' }] },
  { name: 'nullable domain record', family: 'nullable-value', response: null },
  { name: 'created identifier', family: 'value', response: { id: 7 } },
  { name: 'acknowledgement', family: 'ack', response: { ok: true } },
  {
    name: 'status response',
    family: 'status',
    response: { ok: true, configured: true },
  },
  {
    name: 'successful tool result',
    family: 'tool-result',
    response: {
      ok: true,
      summary: 'Sandbox executed',
      detail: '42',
      output: { ok: true, stdout: '', stderr: '', result: '42', durationMs: 7, truncated: false },
    },
  },
  {
    name: 'domain rejection',
    family: 'domain-error',
    response: { ok: false, error: 'artifact_not_found' },
  },
  {
    name: 'status or domain rejection',
    family: 'status-or-domain-error',
    response: [
      { ok: true, artifact: { id: 'artifact-contract-1' } },
      { ok: false, error: 'artifact_not_found' },
    ],
  },
  {
    name: 'domain value or rejection',
    family: 'value-or-domain-error',
    response: [
      { id: 'automation-contract-1', status: 'active' },
      { ok: false, error: 'automation_not_found' },
    ],
  },
] as const;

export const RUNTIME_ERROR_FIXTURES = {
  nonObjectMessage: {
    message: 'GET_MEMORIES',
    error: 'transport failed',
    response: null,
  },
  toolHandlerRejection: {
    message: { type: 'EXECUTE_TOOL_CALL' },
    error: 'provider disconnected',
    response: {
      ok: false,
      summary: 'Tool execution failed',
      detail: 'provider disconnected',
      error: {
        code: 'background_tool_execution_failed',
        message: 'provider disconnected',
        retryable: true,
      },
    },
  },
  genericHandlerRejection: {
    message: { type: 'SAVE_MEMORY' },
    error: 'storage unavailable',
    response: { ok: false, error: 'storage unavailable' },
  },
} as const;

export const RUNTIME_CURRENT_GAPS = [
  {
    name: 'unknown command returns ambiguous null',
    current: { type: 'UNKNOWN_COMMAND' },
    target: 'explicit-rejection-after-T3.1',
  },
  {
    name: 'direct payload casts do not decode external input',
    current: { type: 'GET_MEMORY_BY_ID', payload: {} },
    target: 'decoded-command-contract-after-T3.1',
  },
  {
    name: 'declared-only actions have no live route',
    current: ['TOOL_CALL_EXECUTED', 'MEMORIES_UPDATED'],
    target: 'single-exhaustive-command-map-after-T3.1',
  },
] as const;

export const RUNTIME_RESOLVED_BOUNDARY_CASES = [
  {
    name: 'missing command type is rejected before the router',
    input: {},
    target: 'explicit-rejection-at-T2.1-boundary',
  },
] as const;

export const RUNTIME_NOTIFICATION_TYPES = [
  'STATE_UPDATED',
  'BACKGROUND_UPDATED',
  'PET_UPDATED',
  'THEME_UPDATED',
  'MCP_SERVERS_UPDATED',
  'TOOL_DESCRIPTORS_UPDATED',
  'BROWSER_CONTROL_UPDATED',
  'TOOL_CALL_HISTORY_UPDATED',
  'PROJECT_CONTEXT_UPDATED',
  'SAVED_ITEMS_UPDATED',
  'VOICE_SETTINGS_UPDATED',
  'AUTOMATIONS_UPDATED',
  'AUTOMATION_RUNS_UPDATED',
  'AUTH_STATUS_CHANGED',
  'DEEPSEEK_EXPORT_PROGRESS',
  'CHAT_STREAM_CHUNK',
  'OPEN_CHAT_WITH_TEXT',
] as const;

export const RUNTIME_TAB_RPC_TYPES = [
  'REFRESH_DEEPSEEK_AUTH',
  'GET_CURRENT_DEEPSEEK_CONVERSATION',
  'INSERT_PROMPT_TEXT',
] as const;
