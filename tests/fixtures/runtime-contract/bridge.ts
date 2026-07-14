import type { BridgeMessageType } from '../../../core/messaging/schema';

export interface BridgeContractCase {
  name: string;
  expectedSource: 'deepseek-pp-main' | 'deepseek-pp-content';
  message: Record<string, unknown>;
}

type LegalBridgeCases = {
  [Type in BridgeMessageType]: ReadonlyArray<Omit<BridgeContractCase, 'message'> & {
    message: { source: string; type: Type; [key: string]: unknown };
  }>;
};

const MAIN = 'deepseek-pp-main';
const CONTENT = 'deepseek-pp-content';

const TOOL_PROVIDER = {
  kind: 'mcp',
  id: 'browser-tools',
  displayName: 'Browser Tools',
  transport: 'streamable_http',
};

const TOOL_CALL = {
  id: 'call-contract-1',
  descriptorId: 'mcp:browser-tools:capture_page',
  provider: TOOL_PROVIDER,
  name: 'capture_page',
  invocationName: 'mcp_browser_tools_capture_page',
  payload: { url: 'https://example.test/contracts' },
  raw: '<mcp_browser_tools_capture_page>{"url":"https://example.test/contracts"}</mcp_browser_tools_capture_page>',
  source: { trigger: 'manual_chat', requestId: 'request-contract-1' },
  createdAt: 1_752_384_000_000,
};

const STARTED_TOOL_CALL = {
  id: 'call-contract-1',
  descriptorId: 'mcp:browser-tools:capture_page',
  provider: TOOL_PROVIDER,
  name: 'capture_page',
  invocationName: 'mcp_browser_tools_capture_page',
  payload: {},
  raw: '<mcp_browser_tools_capture_page>',
  source: { trigger: 'manual_chat', requestId: 'request-contract-1' },
  createdAt: 1_752_384_000_000,
};

export const LEGAL_BRIDGE_CASES = {
  SYNC_HOOK_STATE: [{
    name: 'content synchronizes hook state',
    expectedSource: CONTENT,
    message: {
      source: CONTENT,
      type: 'SYNC_HOOK_STATE',
      toolDescriptors: [{
        id: 'mcp:browser-tools:capture_page',
        provider: TOOL_PROVIDER,
        name: 'capture_page',
        invocationName: 'mcp_browser_tools_capture_page',
        title: 'Capture page',
        description: 'Capture a page.',
        inputSchema: { type: 'object', properties: {} },
        execution: { mode: 'auto', enabled: true, risk: 'medium' },
      }],
      skillSummaries: [{ name: 'reviewer', description: 'Review contracts.' }],
      skillPopupCopy: { hint: 'Type a Skill name.' },
    },
  }],
  SYNC_HOOK_STATE_REQUEST: [{
    name: 'main requests an authoritative hook-state resynchronization',
    expectedSource: MAIN,
    message: { source: MAIN, type: 'SYNC_HOOK_STATE_REQUEST' },
  }],
  AUGMENT_REQUEST_BODY: [{
    name: 'main requests body augmentation',
    expectedSource: MAIN,
    message: {
      source: MAIN,
      type: 'AUGMENT_REQUEST_BODY',
      id: 'augment-1',
      requestId: 'request-contract-1',
      body: '{"prompt":"hello"}',
    },
  }],
  AUGMENT_REQUEST_BODY_EXTEND_TIMEOUT: [{
    name: 'content extends an augmentation timeout',
    expectedSource: CONTENT,
    message: { source: CONTENT, type: 'AUGMENT_REQUEST_BODY_EXTEND_TIMEOUT', id: 'augment-1', timeoutMs: 190_000 },
  }],
  AUGMENT_REQUEST_BODY_RESULT: [{
    name: 'content returns an augmented body',
    expectedSource: CONTENT,
    message: {
      source: CONTENT,
      type: 'AUGMENT_REQUEST_BODY_RESULT',
      id: 'augment-1',
      ok: true,
      result: {
        body: '{"prompt":"augmented"}',
        agentTaskPrompt: 'hello',
        requestId: 'request-authorized-1',
        toolDescriptors: [{
          id: 'mcp:browser-tools:capture_page',
          provider: TOOL_PROVIDER,
          name: 'capture_page',
          invocationName: 'mcp_browser_tools_capture_page',
          title: 'Capture page',
          description: 'Capture a page.',
          inputSchema: { type: 'object', properties: {} },
          execution: { mode: 'auto', enabled: true, risk: 'medium' },
        }],
      },
    },
  }],
  TOOL_CALL_STARTED: [{
    name: 'main announces a started tool call',
    expectedSource: MAIN,
    message: { source: MAIN, type: 'TOOL_CALL_STARTED', data: STARTED_TOOL_CALL },
  }],
  TOOL_CALL_CHUNK: [{
    name: 'main sends an externalized tool payload chunk',
    expectedSource: MAIN,
    message: {
      source: MAIN,
      type: 'TOOL_CALL_CHUNK',
      data: {
        id: 'call-artifact-1',
        invocationName: 'artifact_create',
        requestId: 'request-contract-1',
        chunk: '{"filename":"report.md","content":"',
      },
    },
  }],
  TOOL_CALL: [{
    name: 'main completes a tool call',
    expectedSource: MAIN,
    message: { source: MAIN, type: 'TOOL_CALL', data: TOOL_CALL },
  }],
  RESTORE_TOOL_CALLS: [{
    name: 'main restores tool execution records',
    expectedSource: MAIN,
    message: {
      source: MAIN,
      type: 'RESTORE_TOOL_CALLS',
      records: [{
        id: 'restore-contract-1',
        calls: [TOOL_CALL],
        executions: [{
          callId: 'call-contract-1',
          name: 'capture_page',
          provider: TOOL_PROVIDER,
          result: { ok: true, summary: 'Captured page', output: { title: 'Contracts' } },
        }],
        source: 'history',
        createdAt: 1_752_384_000_000,
      }],
    },
  }],
  RESPONSE_COMPLETE: [{
    name: 'main reports a completed response',
    expectedSource: MAIN,
    message: {
      source: MAIN,
      type: 'RESPONSE_COMPLETE',
      payload: {
        requestId: 'request-contract-1',
        text: 'done',
        originalPrompt: 'hello',
        agentTaskPrompt: 'hello',
        chatSessionId: 'chat-contract-1',
        parentMessageId: 10,
        assistantMessageId: 11,
        promptOptions: {
          modelType: 'deepseek-chat',
          searchEnabled: false,
          thinkingEnabled: true,
          refFileIds: [],
        },
      },
    },
  }],
  REQUEST_TERMINAL: [{
    name: 'main reports a terminal request lifecycle',
    expectedSource: MAIN,
    message: {
      source: MAIN,
      type: 'REQUEST_TERMINAL',
      payload: { requestId: 'request-contract-1' },
    },
  }],
  RESPONSE_TOKEN_SPEED: [{
    name: 'main reports token speed',
    expectedSource: MAIN,
    message: {
      source: MAIN,
      type: 'RESPONSE_TOKEN_SPEED',
      payload: {
        requestId: 'request-contract-1',
        chatSessionId: 'chat-contract-1',
        assistantMessageId: 11,
        active: false,
        estimatedTokens: 42,
        accumulatedTokens: null,
        tokensPerSecond: 12.5,
        elapsedMs: 3_360,
        textLength: 168,
        tokenSource: 'estimated',
        speedSource: 'estimated',
        modelType: 'deepseek-chat',
      },
    },
  }],
  MEMORIES_USED: [{
    name: 'main reports used memory ids',
    expectedSource: MAIN,
    message: { source: MAIN, type: 'MEMORIES_USED', ids: [7, 9] },
  }],
  HEADERS_CAPTURED: [{
    name: 'main reports captured DeepSeek headers',
    expectedSource: MAIN,
    message: {
      source: MAIN,
      type: 'HEADERS_CAPTURED',
      headers: { Authorization: 'Bearer contract-placeholder', 'X-App-Version': '2.0.0' },
    },
  }, {
    name: 'main reports that no DeepSeek headers were captured',
    expectedSource: MAIN,
    message: { source: MAIN, type: 'HEADERS_CAPTURED', headers: null },
  }],
  NAVIGATION_CHANGED: [{
    name: 'main reports a document navigation',
    expectedSource: MAIN,
    message: { source: MAIN, type: 'NAVIGATION_CHANGED' },
  }],
  DPP_BRIDGE_READY: [{
    name: 'main acknowledges the transferred port',
    expectedSource: MAIN,
    message: { source: MAIN, type: 'DPP_BRIDGE_READY' },
  }],
} satisfies LegalBridgeCases;

export const REJECTED_BRIDGE_CASES: ReadonlyArray<{
  name: string;
  expectedSource?: string;
  message: unknown;
}> = [
  { name: 'null envelope', message: null },
  { name: 'array envelope', message: [] },
  { name: 'missing source', message: { type: 'DPP_BRIDGE_READY' } },
  { name: 'wrong source', expectedSource: MAIN, message: { source: CONTENT, type: 'DPP_BRIDGE_READY' } },
  { name: 'unknown type', message: { source: MAIN, type: 'DPP_UNKNOWN' } },
  { name: 'non-string id', message: { source: MAIN, type: 'AUGMENT_REQUEST_BODY', id: 7, body: '{}' } },
  { name: 'non-string body', message: { source: MAIN, type: 'AUGMENT_REQUEST_BODY', id: 'augment-1', body: {} } },
  { name: 'non-string request id', message: { source: MAIN, type: 'AUGMENT_REQUEST_BODY', id: 'augment-1', requestId: 7, body: '{}' } },
  { name: 'non-boolean ok', message: { source: CONTENT, type: 'AUGMENT_REQUEST_BODY_RESULT', id: 'augment-1', ok: 'yes' } },
  { name: 'non-string error', message: { source: CONTENT, type: 'AUGMENT_REQUEST_BODY_RESULT', id: 'augment-1', ok: false, error: {} } },
  { name: 'non-positive timeout', message: { source: CONTENT, type: 'AUGMENT_REQUEST_BODY_EXTEND_TIMEOUT', id: 'augment-1', timeoutMs: 0 } },
  { name: 'non-finite timeout', message: { source: CONTENT, type: 'AUGMENT_REQUEST_BODY_EXTEND_TIMEOUT', id: 'augment-1', timeoutMs: Number.POSITIVE_INFINITY } },
];

type MalformedBridgePayloadCases = {
  [Type in BridgeMessageType]: ReadonlyArray<BridgeContractCase & {
    message: { source: string; type: Type; [key: string]: unknown };
    target: 'reject-at-T2.1-boundary';
  }>;
};

export const MALFORMED_BRIDGE_PAYLOAD_CASES = {
  SYNC_HOOK_STATE: [{
    name: 'hook state has invalid descriptor and Skill collections',
    expectedSource: CONTENT,
    message: { source: CONTENT, type: 'SYNC_HOOK_STATE', toolDescriptors: {}, skillSummaries: 'invalid' },
    target: 'reject-at-T2.1-boundary',
  }],
  SYNC_HOOK_STATE_REQUEST: [{
    name: 'hook-state resync request travels in the wrong direction',
    expectedSource: CONTENT,
    message: { source: CONTENT, type: 'SYNC_HOOK_STATE_REQUEST' },
    target: 'reject-at-T2.1-boundary',
  }],
  AUGMENT_REQUEST_BODY: [{
    name: 'augmentation request omits correlation id and body',
    expectedSource: MAIN,
    message: { source: MAIN, type: 'AUGMENT_REQUEST_BODY' },
    target: 'reject-at-T2.1-boundary',
  }],
  AUGMENT_REQUEST_BODY_EXTEND_TIMEOUT: [{
    name: 'timeout extension omits correlation id',
    expectedSource: CONTENT,
    message: { source: CONTENT, type: 'AUGMENT_REQUEST_BODY_EXTEND_TIMEOUT', timeoutMs: 190_000 },
    target: 'reject-at-T2.1-boundary',
  }],
  AUGMENT_REQUEST_BODY_RESULT: [{
    name: 'augmentation result omits ok and has an invalid result',
    expectedSource: CONTENT,
    message: { source: CONTENT, type: 'AUGMENT_REQUEST_BODY_RESULT', id: 'augment-1', result: 'not-a-result' },
    target: 'reject-at-T2.1-boundary',
  }, {
    name: 'augmentation result has a malformed request tool catalog',
    expectedSource: CONTENT,
    message: {
      source: CONTENT,
      type: 'AUGMENT_REQUEST_BODY_RESULT',
      id: 'augment-1',
      ok: true,
      result: { body: '{}', agentTaskPrompt: 'hello', toolDescriptors: [{}] },
    },
    target: 'reject-at-T2.1-boundary',
  }],
  TOOL_CALL_STARTED: [{
    name: 'started tool event has a non-record call',
    expectedSource: MAIN,
    message: { source: MAIN, type: 'TOOL_CALL_STARTED', data: 'not-a-tool-call' },
    target: 'reject-at-T2.1-boundary',
  }],
  TOOL_CALL_CHUNK: [{
    name: 'tool chunk has invalid correlation and chunk fields',
    expectedSource: MAIN,
    message: { source: MAIN, type: 'TOOL_CALL_CHUNK', data: { id: 7, invocationName: null, chunk: {} } },
    target: 'reject-at-T2.1-boundary',
  }],
  TOOL_CALL: [{
    name: 'tool event missing data',
    expectedSource: MAIN,
    message: { source: MAIN, type: 'TOOL_CALL' },
    target: 'reject-at-T2.1-boundary',
  }],
  RESTORE_TOOL_CALLS: [{
    name: 'restore event has a non-array records field',
    expectedSource: MAIN,
    message: { source: MAIN, type: 'RESTORE_TOOL_CALLS', records: {} },
    target: 'reject-at-T2.1-boundary',
  }],
  RESPONSE_COMPLETE: [{
    name: 'response completion has an invalid nested payload',
    expectedSource: MAIN,
    message: { source: MAIN, type: 'RESPONSE_COMPLETE', payload: { requestId: 7, text: null } },
    target: 'reject-at-T2.1-boundary',
  }],
  REQUEST_TERMINAL: [{
    name: 'request terminal event has no correlation identity',
    expectedSource: MAIN,
    message: { source: MAIN, type: 'REQUEST_TERMINAL', payload: { requestId: '' } },
    target: 'reject-at-T2.1-boundary',
  }],
  RESPONSE_TOKEN_SPEED: [{
    name: 'token speed event has an invalid nested payload',
    expectedSource: MAIN,
    message: { source: MAIN, type: 'RESPONSE_TOKEN_SPEED', payload: { active: 'yes', tokensPerSecond: 'fast' } },
    target: 'reject-at-T2.1-boundary',
  }],
  MEMORIES_USED: [{
    name: 'memory event has non-numeric ids',
    expectedSource: MAIN,
    message: { source: MAIN, type: 'MEMORIES_USED', ids: ['memory-7'] },
    target: 'reject-at-T2.1-boundary',
  }],
  HEADERS_CAPTURED: [{
    name: 'captured headers event has a non-record headers field',
    expectedSource: MAIN,
    message: { source: MAIN, type: 'HEADERS_CAPTURED', headers: ['Authorization'] },
    target: 'reject-at-T2.1-boundary',
  }],
  NAVIGATION_CHANGED: [{
    name: 'navigation event travels in the wrong direction',
    expectedSource: CONTENT,
    message: { source: CONTENT, type: 'NAVIGATION_CHANGED' },
    target: 'reject-at-T2.1-boundary',
  }],
  DPP_BRIDGE_READY: [{
    name: 'ready acknowledgement travels in the wrong direction',
    expectedSource: CONTENT,
    message: { source: CONTENT, type: 'DPP_BRIDGE_READY' },
    target: 'reject-at-T2.1-boundary',
  }],
} satisfies MalformedBridgePayloadCases;

export const BRIDGE_HANDSHAKE_CONTRACT = {
  legal: [
    {
      name: 'content accepts a same-origin MAIN request before connecting',
      check: {
        value: { source: MAIN, type: 'DPP_BRIDGE_REQUEST' },
        actualOrigin: 'https://chat.deepseek.com',
        expectedOrigin: 'https://chat.deepseek.com',
        expectedSource: MAIN,
        expectedType: 'DPP_BRIDGE_REQUEST',
        alreadyConnected: false,
      },
    },
    {
      name: 'main accepts a same-origin content init with a transferred port',
      check: {
        value: { source: CONTENT, type: 'DPP_BRIDGE_INIT' },
        actualOrigin: 'https://chat.deepseek.com',
        expectedOrigin: 'https://chat.deepseek.com',
        expectedSource: CONTENT,
        expectedType: 'DPP_BRIDGE_INIT',
        alreadyConnected: false,
        requireTransferredPort: true,
        transferredPortCount: 1,
      },
    },
    {
      name: 'main accepts a same-origin content disconnect for its active port',
      check: {
        value: { source: CONTENT, type: 'DPP_BRIDGE_DISCONNECT' },
        actualOrigin: 'https://chat.deepseek.com',
        expectedOrigin: 'https://chat.deepseek.com',
        expectedSource: CONTENT,
        expectedType: 'DPP_BRIDGE_DISCONNECT',
        alreadyConnected: true,
        allowWhileConnected: true,
        forbidTransferredPorts: true,
        transferredPortCount: 0,
      },
    },
    {
      name: 'content accepts a same-origin MAIN disconnect for its active port',
      check: {
        value: { source: MAIN, type: 'DPP_BRIDGE_DISCONNECT' },
        actualOrigin: 'https://chat.deepseek.com',
        expectedOrigin: 'https://chat.deepseek.com',
        expectedSource: MAIN,
        expectedType: 'DPP_BRIDGE_DISCONNECT',
        alreadyConnected: true,
        allowWhileConnected: true,
        forbidTransferredPorts: true,
        transferredPortCount: 0,
      },
    },
  ],
  rejected: [
    {
      name: 'wrong origin',
      check: {
        value: { source: MAIN, type: 'DPP_BRIDGE_REQUEST' },
        actualOrigin: 'https://example.test',
        expectedOrigin: 'https://chat.deepseek.com',
        expectedSource: MAIN,
        expectedType: 'DPP_BRIDGE_REQUEST',
        alreadyConnected: false,
      },
    },
    {
      name: 'wrong source',
      check: {
        value: { source: CONTENT, type: 'DPP_BRIDGE_REQUEST' },
        actualOrigin: 'https://chat.deepseek.com',
        expectedOrigin: 'https://chat.deepseek.com',
        expectedSource: MAIN,
        expectedType: 'DPP_BRIDGE_REQUEST',
        alreadyConnected: false,
      },
    },
    {
      name: 'wrong type',
      check: {
        value: { source: MAIN, type: 'DPP_BRIDGE_INIT' },
        actualOrigin: 'https://chat.deepseek.com',
        expectedOrigin: 'https://chat.deepseek.com',
        expectedSource: MAIN,
        expectedType: 'DPP_BRIDGE_REQUEST',
        alreadyConnected: false,
      },
    },
    {
      name: 'init missing transferred port',
      check: {
        value: { source: CONTENT, type: 'DPP_BRIDGE_INIT' },
        actualOrigin: 'https://chat.deepseek.com',
        expectedOrigin: 'https://chat.deepseek.com',
        expectedSource: CONTENT,
        expectedType: 'DPP_BRIDGE_INIT',
        alreadyConnected: false,
        requireTransferredPort: true,
        transferredPortCount: 0,
      },
    },
    {
      name: 'duplicate handshake after connection',
      check: {
        value: { source: MAIN, type: 'DPP_BRIDGE_REQUEST' },
        actualOrigin: 'https://chat.deepseek.com',
        expectedOrigin: 'https://chat.deepseek.com',
        expectedSource: MAIN,
        expectedType: 'DPP_BRIDGE_REQUEST',
        alreadyConnected: true,
      },
    },
    {
      name: 'disconnect carrying a transferred port',
      check: {
        value: { source: CONTENT, type: 'DPP_BRIDGE_DISCONNECT' },
        actualOrigin: 'https://chat.deepseek.com',
        expectedOrigin: 'https://chat.deepseek.com',
        expectedSource: CONTENT,
        expectedType: 'DPP_BRIDGE_DISCONNECT',
        alreadyConnected: true,
        allowWhileConnected: true,
        forbidTransferredPorts: true,
        transferredPortCount: 1,
      },
    },
  ],
  mainWorldTrustPolicy: {
    name: 'same-origin page code still shares MAIN world identity after transport hardening',
    check: {
      value: { source: MAIN, type: 'DPP_BRIDGE_REQUEST' },
      actualOrigin: 'https://chat.deepseek.com',
      expectedOrigin: 'https://chat.deepseek.com',
      expectedSource: MAIN,
      expectedType: 'DPP_BRIDGE_REQUEST',
      alreadyConnected: false,
    },
    target: 'treat-main-payload-as-untrusted-after-T2.1',
  },
  request: { source: MAIN, type: 'DPP_BRIDGE_REQUEST' },
  init: { source: CONTENT, type: 'DPP_BRIDGE_INIT' },
  disconnect: { type: 'DPP_BRIDGE_DISCONNECT' },
  ready: { source: MAIN, type: 'DPP_BRIDGE_READY' },
  originPolicy: 'window.location.origin',
  retry: { intervalMs: 50, maxAttempts: 100 },
} as const;
