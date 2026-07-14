export const RUNTIME_TOPOLOGY = {
  liveCommands: 121,
  declaredActions: 91,
  shared: 89,
  liveOnly: 32,
  declaredOnly: 2,
  readsPayload: 79,
  ignoresPayload: 42,
  directPayloadCasts: 12,
  decodedPayloads: 58,
  delegatedPayloads: 9,
} as const;

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
    name: 'sync command with confirmed target',
    family: 'required',
    message: {
      type: 'WEBDAV_UPLOAD_LOCAL',
      payload: {
        config: {
          provider: 'webdav',
          url: 'https://dav.contract.test/root',
          username: 'contract-user',
          password: 'contract-password',
          remotePath: 'DeepSeekPP',
          lastSyncAt: null,
          schemaVersion: 1,
          revision: 7,
        },
        expectedRevision: 7,
      },
    },
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
    name: 'status, domain rejection, or tool rejection',
    family: 'status-or-domain-error-or-tool-result',
    response: [
      { ok: true },
      { ok: false, error: 'invalid_external_payload_chunk' },
      {
        ok: false,
        summary: 'Tool authorization rejected',
        error: {
          code: 'tool_authorization_missing',
          message: 'Tool authorization is missing or closed.',
          retryable: false,
        },
      },
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
    name: 'direct payload casts do not decode external input',
    current: { type: 'SAVE_DEEPSEEK_API_KEY', payload: {} },
    target: 'decoded-command-contract-during-R4.3-R4.4',
  },
] as const;

export const RUNTIME_RESOLVED_ROUTING_CASES = [
  {
    name: 'unknown command is rejected by the registry',
    input: { type: 'UNKNOWN_COMMAND' },
    response: { ok: false, error: 'runtime_command_unknown' },
    target: 'explicit-rejection-at-R3.1-registry',
  },
  {
    name: 'declared-only tool notification cannot enter background dispatch',
    input: { type: 'TOOL_CALL_EXECUTED' },
    response: { ok: false, error: 'runtime_command_unknown' },
    target: 'explicit-rejection-at-R3.1-registry',
  },
  {
    name: 'declared-only memory notification cannot enter background dispatch',
    input: { type: 'MEMORIES_UPDATED' },
    response: { ok: false, error: 'runtime_command_unknown' },
    target: 'explicit-rejection-at-R3.1-registry',
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
