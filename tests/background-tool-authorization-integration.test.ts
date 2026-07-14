import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RuntimeMessageContext } from '../core/messaging/runtime-boundary';
import {
  authorizeExternalToolPayloadChunk,
  closeToolAuthorization,
  createToolAuthorization,
  createToolAuthorizationResult,
  TOOL_AUTHORIZATION_STORAGE_KEY,
} from '../core/tool/authorization';
import { ExternalPayloadAuthorizationCache } from '../core/tool/external-payload-authorization-cache';
import {
  appendExternalizedToolPayloadChunk,
  clearExternalizedToolPayloadNamespace,
  createExternalizedToolPayload,
  takeExternalizedToolPayloadText,
} from '../core/tool/externalized-payload';
import { clearToolCallHistory, getToolCallHistory } from '../core/tool/history';
import {
  ToolProviderRegistry,
  type RuntimeToolProvider,
} from '../core/tool/provider-registry';
import {
  createInvalidToolCallResult,
  createRuntimeToolRuntime,
} from '../core/tool/runtime';
import type { ToolCall, ToolDescriptor, ToolResult } from '../core/tool/types';
import {
  createToolExecutionRuntimeHandlers,
  type ToolExecutionRuntimeHandlerDependencies,
} from '../entrypoints/background/tool-execution-handlers';

const deepSeekContext: RuntimeMessageContext = {
  runtimeId: 'extension-id',
  surface: 'deepseek_content',
  senderUrl: 'https://chat.deepseek.com/a/chat/s/chat-1',
  senderOrigin: 'https://chat.deepseek.com',
  tabId: 7,
  frameId: 0,
  documentId: 'document-1',
  documentSessionId: 'document-1',
  chatSessionId: 'chat-1',
};

const descriptor: ToolDescriptor = {
  id: 'local:test:sample_tool',
  provider: { kind: 'local', id: 'test', displayName: 'Test', transport: 'in_process' },
  name: 'sample_tool',
  invocationName: 'sample_tool',
  title: 'Sample tool',
  description: 'Sample tool.',
  inputSchema: {
    type: 'object',
    properties: { value: { type: 'string' } },
    required: ['value'],
    additionalProperties: false,
  },
  execution: { mode: 'auto', enabled: true, risk: 'low' },
};

let sessionStorage: Record<string, unknown>;
let localStorage: Record<string, unknown>;

beforeEach(() => {
  sessionStorage = {};
  localStorage = {};
  vi.stubGlobal('chrome', {
    storage: {
      session: createStorageArea(() => sessionStorage, (value) => {
        sessionStorage = value;
      }),
      local: {
        ...createStorageArea(() => localStorage, (value) => {
          localStorage = value;
        }),
        QUOTA_BYTES: 10_485_760,
      },
    },
  });
});

describe('R4.2 real tool authorization handler composition', () => {
  it('runs CREATE → APPEND → EXECUTE → replay rejection → CLOSE without bypassing state', async () => {
    let activeGrantId = '';
    const providerCalls: ToolCall[] = [];
    const provider: RuntimeToolProvider = {
      registration: { kind: 'local', id: 'test' },
      listTools: vi.fn(async () => [descriptor]),
      execute: vi.fn(async (authorizedCall) => {
        const state = sessionStorage[TOOL_AUTHORIZATION_STORAGE_KEY] as StoredAuthorizationState;
        expect(state.grants[activeGrantId].calls['call-1'].state).toBe('executing');
        providerCalls.push(authorizedCall);
        return {
          ok: true,
          summary: 'provider completed',
          output: { observed: authorizedCall.payload.value as string },
        };
      }),
    };
    const runtime = createRuntimeToolRuntime(new ToolProviderRegistry([provider]));
    const cache = new ExternalPayloadAuthorizationCache();
    const dependencies: ToolExecutionRuntimeHandlerDependencies = {
      getLocale: () => 'en',
      getToolDescriptors: runtime.getToolDescriptors,
      getAuthorizationDescriptors: runtime.getAuthorizationDescriptors,
      refreshToolDescriptors: runtime.refreshToolDescriptors,
      createToolAuthorization,
      closeToolAuthorization,
      authorizeExternalToolPayloadChunk,
      createToolAuthorizationResult,
      createInvalidToolCallResult,
      externalPayloadAuthorizationCache: cache,
      appendExternalizedToolPayloadChunk,
      clearExternalizedToolPayloadNamespace,
      executeToolCall: runtime.executeToolCall,
      runSandbox: vi.fn(async () => ({ ok: true, summary: 'sandbox done' })),
      getToolCallHistory,
      clearToolCallHistory,
      getPlatformEnvironment: () => ({
        kind: 'browser_extension',
        name: 'WebExtension',
        capabilities: {
          storage: true,
          runtimeMessaging: true,
          downloads: false,
          filePicker: false,
          folderPicker: false,
          assetUrl: true,
          sidePanel: true,
          nativeMessaging: false,
          contextMenus: false,
          alarms: false,
          tabs: true,
          tabGroups: false,
          debugger: false,
          browserControl: false,
          accessibilityTree: false,
        },
      }),
      createRequestId: () => 'trusted-request-id',
      now: () => 1_000,
      sandboxInvalidRequestSummary: () => 'Invalid sandbox request',
      broadcastToolDescriptorsUpdate: vi.fn(async () => undefined),
      broadcastMcpServersUpdate: vi.fn(async () => undefined),
      broadcastToolCallHistoryUpdate: vi.fn(async () => undefined),
    };
    const handlers = createToolExecutionRuntimeHandlers(dependencies);

    const grant = await dispatch(handlers, {
      type: 'CREATE_TOOL_AUTHORIZATION',
      payload: {
        requestId: 'request-1',
        trigger: 'manual_chat',
        chatSessionId: 'chat-1',
        descriptorIds: [descriptor.id],
      },
    }) as { id: string };
    activeGrantId = grant.id;
    expect(grant.id).toBeTruthy();

    await expect(dispatch(handlers, appendMessage(grant.id, 'call-1')))
      .resolves.toEqual({ ok: true });
    const executionCall = createExternalizedCall('call-1');
    await expect(dispatch(handlers, {
      type: 'EXECUTE_TOOL_CALL',
      payload: { ...executionCall, authorizationId: grant.id },
    })).resolves.toMatchObject({
      ok: true,
      summary: 'provider completed',
      output: { observed: 'approved' },
    });
    expect(providerCalls).toHaveLength(1);
    expect(providerCalls[0]).toMatchObject({
      id: 'call-1',
      descriptorId: descriptor.id,
      provider: descriptor.provider,
      payload: { value: 'approved' },
    });
    expect(readStoredCallState(grant.id, 'call-1')).toBe('consumed');

    await expect(dispatch(handlers, appendMessage(grant.id, 'call-1')))
      .resolves.toMatchObject({
        ok: false,
        error: { code: 'tool_call_replayed', retryable: false },
      });
    expect(provider.execute).toHaveBeenCalledTimes(1);

    await expect(dispatch(handlers, {
      type: 'EXECUTE_TOOL_CALL',
      payload: { ...executionCall, authorizationId: grant.id },
    })).resolves.toMatchObject({
      ok: false,
      error: { code: 'tool_call_replayed', retryable: false },
    });
    expect(provider.execute).toHaveBeenCalledTimes(1);

    await expect(dispatch(handlers, appendMessage(grant.id, 'call-2')))
      .resolves.toEqual({ ok: true });
    expect(takeExternalizedToolPayloadText(
      'call-2',
      descriptor.invocationName,
      grant.id,
    )).toBe('{"value":"approved"}');
    appendExternalizedToolPayloadChunk(
      'call-2',
      descriptor.invocationName,
      '{"value":"approved"}',
      grant.id,
    );

    await expect(dispatch(handlers, {
      type: 'CLOSE_TOOL_AUTHORIZATION',
      payload: { authorizationId: grant.id },
    })).resolves.toEqual({ ok: true });
    expect(readStoredGrant(grant.id)).toBeUndefined();
    expect(takeExternalizedToolPayloadText(
      'call-2',
      descriptor.invocationName,
      grant.id,
    )).toBeNull();

    await expect(dispatch(handlers, appendMessage(grant.id, 'call-2')))
      .resolves.toMatchObject({
        ok: false,
        error: { code: 'tool_authorization_missing', retryable: false },
      });
    expect(provider.execute).toHaveBeenCalledTimes(1);
  });
});

function createExternalizedCall(callId: string): ToolCall {
  return {
    id: callId,
    descriptorId: descriptor.id,
    provider: descriptor.provider,
    name: descriptor.name,
    invocationName: descriptor.invocationName,
    payload: createExternalizedToolPayload(callId, descriptor.invocationName),
    raw: '<sample_tool>{"value":"approved"}</sample_tool>',
    source: {
      trigger: 'manual_chat',
      requestId: 'request-1',
      chatSessionId: 'chat-1',
    },
  };
}

function appendMessage(authorizationId: string, callId: string): {
  type: string;
  payload: Record<string, unknown>;
} {
  return {
    type: 'APPEND_EXTERNAL_TOOL_PAYLOAD_CHUNK',
    payload: {
      authorizationId,
      callId,
      invocationName: descriptor.invocationName,
      chunk: '{"value":"approved"}',
    },
  };
}

function dispatch(
  handlers: ReturnType<typeof createToolExecutionRuntimeHandlers>,
  message: { type: string; payload?: unknown },
): Promise<unknown> {
  const handler = handlers.find((candidate) => candidate.type === message.type);
  if (!handler) throw new Error(`Handler not found: ${message.type}`);
  return handler.handle(message, deepSeekContext);
}

function createStorageArea(
  read: () => Record<string, unknown>,
  write: (value: Record<string, unknown>) => void,
) {
  return {
    get: vi.fn(async (key: string) => {
      const value = read()[key];
      return value === undefined ? {} : { [key]: structuredClone(value) };
    }),
    set: vi.fn(async (value: Record<string, unknown>) => {
      write(structuredClone({ ...read(), ...value }));
    }),
    remove: vi.fn(async (key: string) => {
      const next = { ...read() };
      delete next[key];
      write(next);
    }),
  };
}

function readStoredGrant(grantId: string): StoredAuthorizationGrant | undefined {
  const state = sessionStorage[TOOL_AUTHORIZATION_STORAGE_KEY] as StoredAuthorizationState;
  return state?.grants[grantId];
}

function readStoredCallState(grantId: string, callId: string): string | undefined {
  return readStoredGrant(grantId)?.calls[callId]?.state;
}

interface StoredAuthorizationState {
  version: 1;
  grants: Record<string, StoredAuthorizationGrant>;
}

interface StoredAuthorizationGrant {
  calls: Record<string, { state: string }>;
}
