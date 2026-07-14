export type RuntimeRequestBoundary =
  | 'none'
  | 'payload-cast'
  | 'payload-delegated'
  | 'payload-decoded';
export type RuntimeResponseFamily =
  | 'value'
  | 'nullable-value'
  | 'ack'
  | 'status'
  | 'domain-error'
  | 'status-or-domain-error'
  | 'status-or-domain-error-or-tool-result'
  | 'value-or-domain-error'
  | 'tool-result'
  | 'unrouted';
export type RuntimeErrorFamily = 'background-error' | 'tool-error' | 'none';
export type RuntimeCommandSurface = 'live-and-declared' | 'live-only' | 'declared-only';
export type RuntimePayloadPresence = 'none' | 'required' | 'optional';
export type RuntimeCommandOwner = 'typed-handler' | 'client-only';

export interface RuntimeCommandContract {
  owner: RuntimeCommandOwner;
  surface: RuntimeCommandSurface;
  request: {
    access: RuntimeRequestBoundary;
    presence: RuntimePayloadPresence;
  };
  response: RuntimeResponseFamily;
  error: RuntimeErrorFamily;
}

function command(
  owner: RuntimeCommandOwner,
  request: RuntimeRequestBoundary,
  response: RuntimeResponseFamily,
  error: RuntimeErrorFamily = 'background-error',
  surface: RuntimeCommandSurface = 'live-and-declared',
  presence: RuntimePayloadPresence = request === 'none' ? 'none' : 'required',
): RuntimeCommandContract {
  return { owner, surface, request: { access: request, presence }, response, error };
}

function typedCommand(
  request: RuntimeRequestBoundary,
  response: RuntimeResponseFamily,
  error: RuntimeErrorFamily = 'background-error',
  surface: RuntimeCommandSurface = 'live-and-declared',
  presence: RuntimePayloadPresence = request === 'none' ? 'none' : 'required',
): RuntimeCommandContract {
  return command('typed-handler', request, response, error, surface, presence);
}

export const RUNTIME_COMMAND_CONTRACTS = {
  GET_MEMORIES: typedCommand('none', 'value'),
  GET_MEMORY_BY_ID: typedCommand('payload-decoded', 'nullable-value'),
  SAVE_MEMORY: typedCommand('payload-decoded', 'value'),
  IMPORT_MEMORY_DRAFTS: typedCommand('payload-decoded', 'status-or-domain-error'),
  UPDATE_MEMORY: typedCommand('payload-decoded', 'ack'),
  DELETE_MEMORY: typedCommand('payload-decoded', 'ack'),
  TOUCH_MEMORIES: typedCommand('payload-decoded', 'ack', 'background-error', 'live-only'),
  GET_SKILLS: typedCommand('none', 'value'),
  GET_SKILL_LIBRARY: typedCommand('none', 'value'),
  GET_SKILL_SOURCES: typedCommand('none', 'value'),
  GET_GITHUB_SKILL_SOURCES: typedCommand('none', 'value'),
  SAVE_SKILL: typedCommand('payload-decoded', 'ack'),
  DELETE_SKILL: typedCommand('payload-decoded', 'ack'),
  SET_SKILL_ENABLED: typedCommand('payload-decoded', 'ack'),
  SET_SKILLS_ENABLED: typedCommand('payload-decoded', 'ack'),
  PREVIEW_GITHUB_SKILL_SOURCE: typedCommand('payload-decoded', 'value'),
  IMPORT_GITHUB_SKILL_SOURCE: typedCommand('payload-decoded', 'value'),
  PREVIEW_LOCAL_SKILL_SOURCE: typedCommand('payload-decoded', 'value'),
  PICK_LOCAL_SKILL_FOLDER: typedCommand('payload-decoded', 'value', 'background-error', 'live-and-declared', 'optional'),
  IMPORT_LOCAL_SKILL_SOURCE: typedCommand('payload-decoded', 'value-or-domain-error'),
  CHECK_GITHUB_SKILL_SOURCE_UPDATES: typedCommand('payload-decoded', 'value'),
  UPDATE_GITHUB_SKILL_SOURCE: typedCommand('payload-decoded', 'value'),
  DELETE_GITHUB_SKILL_SOURCE: typedCommand('payload-decoded', 'ack'),
  GET_PRESETS: typedCommand('none', 'value'),
  SAVE_PRESET: typedCommand('payload-decoded', 'ack'),
  DELETE_PRESET: typedCommand('payload-decoded', 'ack'),
  SET_ACTIVE_PRESET: typedCommand('payload-decoded', 'ack'),
  GET_ACTIVE_PRESET: typedCommand('none', 'nullable-value'),
  GET_PROMPT_INJECTION_SETTINGS: typedCommand('none', 'value'),
  SAVE_PROMPT_INJECTION_SETTINGS: typedCommand('payload-decoded', 'value'),
  GET_SAVED_ITEMS: typedCommand('none', 'value'),
  SAVE_SAVED_ITEM: typedCommand('payload-decoded', 'value'),
  DELETE_SAVED_ITEM: typedCommand('payload-decoded', 'ack'),
  INSERT_SAVED_PROMPT_INTO_CHAT: typedCommand('payload-decoded', 'status-or-domain-error'),
  GET_VOICE_SETTINGS: typedCommand('none', 'value'),
  SAVE_VOICE_SETTINGS: typedCommand('payload-decoded', 'value'),
  GET_VOICE_CAPABILITIES: typedCommand('none', 'value'),
  GET_MCP_SERVERS: typedCommand('none', 'value'),
  GET_MCP_SERVER: typedCommand('payload-decoded', 'nullable-value'),
  CREATE_MCP_SERVER: typedCommand('payload-decoded', 'value'),
  UPDATE_MCP_SERVER: typedCommand('payload-decoded', 'nullable-value'),
  DELETE_MCP_SERVER: typedCommand('payload-decoded', 'ack'),
  GET_MCP_TOOL_CACHE: typedCommand('payload-decoded', 'nullable-value'),
  REFRESH_MCP_SERVER_TOOLS: typedCommand('payload-decoded', 'value'),
  REQUEST_MCP_SERVER_PERMISSION: typedCommand('payload-decoded', 'status-or-domain-error', 'background-error', 'live-only'),
  TEST_MCP_SERVER_CONNECTION: typedCommand('payload-decoded', 'status', 'background-error', 'live-only'),
  GET_WEB_TOOL_SETTINGS: typedCommand('none', 'value', 'background-error', 'live-only'),
  SET_WEB_TOOL_SETTING: typedCommand('payload-decoded', 'ack', 'background-error', 'live-only'),
  GET_BROWSER_CONTROL_SETTINGS: typedCommand('none', 'value', 'background-error', 'live-only'),
  SAVE_BROWSER_CONTROL_SETTINGS: typedCommand('payload-decoded', 'value', 'background-error', 'live-only', 'optional'),
  SET_BROWSER_CONTROL_ENABLED: typedCommand('payload-decoded', 'value', 'background-error', 'live-only'),
  GET_BROWSER_CONTROL_STATE: typedCommand('none', 'value', 'background-error', 'live-only'),
  SET_BROWSER_CONTROL_TARGET: typedCommand('payload-decoded', 'status', 'background-error', 'live-only'),
  DETACH_BROWSER_CONTROL: typedCommand('none', 'ack', 'background-error', 'live-only'),
  DIAGNOSE_WEB_SEARCH: typedCommand('payload-decoded', 'value', 'background-error', 'live-only', 'optional'),
  REQUEST_HOST_PERMISSION: typedCommand('payload-decoded', 'status-or-domain-error', 'background-error', 'live-only'),
  GET_TOOL_DESCRIPTORS: typedCommand('none', 'value'),
  REFRESH_TOOL_DESCRIPTORS: typedCommand('none', 'value'),
  CREATE_TOOL_AUTHORIZATION: typedCommand('payload-decoded', 'value-or-domain-error'),
  CLOSE_TOOL_AUTHORIZATION: typedCommand('payload-decoded', 'status-or-domain-error'),
  APPEND_EXTERNAL_TOOL_PAYLOAD_CHUNK: typedCommand(
    'payload-decoded',
    'status-or-domain-error-or-tool-result',
  ),
  EXECUTE_TOOL_CALL: typedCommand('payload-decoded', 'tool-result', 'tool-error'),
  RUN_ARTIFACT_CODE: typedCommand('payload-decoded', 'tool-result'),
  GET_TOOL_CALL_HISTORY: typedCommand('payload-decoded', 'value', 'background-error', 'live-and-declared', 'optional'),
  CLEAR_TOOL_CALL_HISTORY: typedCommand('none', 'ack'),
  GET_PLATFORM_CAPABILITIES: typedCommand('none', 'value'),
  GET_PROJECT_CONTEXT_STATE: typedCommand('none', 'value'),
  CREATE_PROJECT_CONTEXT: typedCommand('payload-decoded', 'value'),
  UPDATE_PROJECT_CONTEXT: typedCommand('payload-decoded', 'value'),
  DELETE_PROJECT_CONTEXT: typedCommand('payload-decoded', 'status'),
  ADD_CONVERSATION_TO_PROJECT: typedCommand('payload-decoded', 'status'),
  REMOVE_CONVERSATION_FROM_PROJECT: typedCommand('payload-decoded', 'ack'),
  SET_PENDING_PROJECT_CONTEXT: typedCommand('payload-decoded', 'ack'),
  GET_CURRENT_DEEPSEEK_CONVERSATION: typedCommand('none', 'status-or-domain-error'),
  GET_PROJECT_CONTEXT_FOR_CONVERSATION: typedCommand('payload-decoded', 'nullable-value'),
  GET_ARTIFACT: typedCommand('payload-decoded', 'status-or-domain-error'),
  GET_CONFIG: typedCommand('none', 'value'),
  WHATS_NEW_DISMISSED: typedCommand('none', 'ack', 'background-error', 'live-only'),
  GET_DEEPSEEK_API_KEY_STATUS: typedCommand('none', 'status', 'background-error', 'live-only'),
  SAVE_DEEPSEEK_API_KEY: typedCommand('payload-decoded', 'status', 'background-error', 'live-only'),
  CLEAR_DEEPSEEK_API_KEY: typedCommand('none', 'status', 'background-error', 'live-only'),
  GET_MULTIMODAL_SETTINGS_STATUS: typedCommand('none', 'status'),
  SAVE_MULTIMODAL_SETTINGS: typedCommand('payload-decoded', 'status'),
  CLEAR_MULTIMODAL_SETTINGS: typedCommand('none', 'status'),
  ANALYZE_MULTIMODAL_MEDIA: typedCommand('payload-decoded', 'status-or-domain-error'),
  GET_DEEPSEEK_THEME: typedCommand('none', 'nullable-value'),
  SET_DEEPSEEK_THEME: typedCommand('payload-decoded', 'status-or-domain-error'),
  GET_MODEL_TYPE: typedCommand('none', 'nullable-value'),
  SET_MODEL_TYPE: typedCommand('payload-decoded', 'ack'),
  RECORD_USAGE_TURN: typedCommand('payload-decoded', 'value'),
  GET_USAGE_SUMMARY: typedCommand('payload-decoded', 'value', 'background-error', 'live-and-declared', 'optional'),
  CLEAR_USAGE_STATS: typedCommand('none', 'ack'),
  GET_BACKGROUND: typedCommand('none', 'nullable-value'),
  SAVE_BACKGROUND: typedCommand('payload-decoded', 'ack'),
  CLEAR_BACKGROUND: typedCommand('none', 'ack'),
  GET_PET: typedCommand('none', 'value'),
  SAVE_PET: typedCommand('payload-decoded', 'ack'),
  CLEAR_PET: typedCommand('none', 'ack'),
  GET_SYNC_CONFIG: typedCommand('none', 'nullable-value'),
  SAVE_SYNC_CONFIG: typedCommand('payload-decoded', 'status-or-domain-error'),
  WEBDAV_TEST: typedCommand('payload-decoded', 'status-or-domain-error'),
  SYNC_AUTHORIZE: typedCommand('payload-decoded', 'status-or-domain-error'),
  WEBDAV_UPLOAD_LOCAL: typedCommand('payload-decoded', 'status-or-domain-error'),
  WEBDAV_DOWNLOAD_REMOTE: typedCommand('payload-decoded', 'status-or-domain-error'),
  CHAT_SUBMIT_PROMPT: typedCommand('payload-decoded', 'status-or-domain-error', 'background-error', 'live-only'),
  UPLOAD_DEEPSEEK_IMAGE: typedCommand('payload-decoded', 'status-or-domain-error', 'background-error', 'live-only'),
  CHAT_NEW_SESSION: typedCommand('none', 'ack', 'background-error', 'live-only'),
  GET_AUTH_STATUS: typedCommand('none', 'value', 'background-error', 'live-only'),
  GET_OFFICIAL_API_CHAT_CONFIG: typedCommand('none', 'value'),
  SAVE_OFFICIAL_API_CHAT_CONFIG: typedCommand('payload-decoded', 'value'),
  EXPORT_DEEPSEEK_CONVERSATIONS: typedCommand('payload-decoded', 'status-or-domain-error', 'background-error', 'live-only', 'optional'),
  CANCEL_DEEPSEEK_EXPORT: typedCommand('payload-decoded', 'status-or-domain-error', 'background-error', 'live-only'),
  AUTH_STATUS_CHANGED: typedCommand('none', 'ack', 'background-error', 'live-only'),
  GET_AUTOMATIONS: typedCommand('none', 'value', 'background-error', 'live-only'),
  GET_AUTOMATION_RUNS: typedCommand('payload-decoded', 'value', 'background-error', 'live-only'),
  CREATE_AUTOMATION: typedCommand('payload-decoded', 'value', 'background-error', 'live-only'),
  UPDATE_AUTOMATION: typedCommand('payload-decoded', 'value-or-domain-error', 'background-error', 'live-only'),
  SET_AUTOMATION_STATUS: typedCommand('payload-decoded', 'value-or-domain-error', 'background-error', 'live-only'),
  DELETE_AUTOMATION: typedCommand('payload-decoded', 'ack', 'background-error', 'live-only'),
  RUN_AUTOMATION_NOW: typedCommand('payload-decoded', 'value', 'background-error', 'live-only'),
  SCENARIOS_UPDATED: typedCommand('payload-decoded', 'value', 'background-error', 'live-only', 'optional'),
  TOOL_CALL_EXECUTED: command('client-only', 'payload-cast', 'unrouted', 'none', 'declared-only'),
  MEMORIES_UPDATED: command('client-only', 'none', 'unrouted', 'none', 'declared-only', 'none'),
} as const satisfies Record<string, RuntimeCommandContract>;

export const TYPED_RUNTIME_COMMAND_TYPES = commandTypesOwnedBy('typed-handler');
export const CLIENT_ONLY_RUNTIME_COMMAND_TYPES = commandTypesOwnedBy('client-only');

export function getRuntimeCommandOwner(type: string): RuntimeCommandOwner | undefined {
  if (!Object.hasOwn(RUNTIME_COMMAND_CONTRACTS, type)) return undefined;
  return RUNTIME_COMMAND_CONTRACTS[type as keyof typeof RUNTIME_COMMAND_CONTRACTS].owner;
}

function commandTypesOwnedBy(owner: RuntimeCommandOwner): readonly string[] {
  return Object.freeze(Object.entries(RUNTIME_COMMAND_CONTRACTS)
    .filter(([, contract]) => contract.owner === owner)
    .map(([type]) => type));
}
