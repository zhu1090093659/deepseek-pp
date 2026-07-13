import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  TOOL_AUTHORIZATION_TTL_MS,
  TOOL_AUTHORIZATION_STORAGE_KEY,
  ToolAuthorizationError,
  authorizeExternalToolPayloadChunk,
  authorizeToolExecution,
  completeToolExecutionAuthorization,
  closeToolAuthorization,
  createToolAuthorization,
  haveEquivalentToolDescriptorSecurity,
} from '../core/tool/authorization';
import type {
  ToolAuthorizationSubject,
  ToolCall,
  ToolDescriptor,
  ToolResult,
} from '../core/tool/types';
import { createWebSearchToolDescriptors } from '../core/tool/web-search';
import { executeRuntimeToolCall } from './helpers/production-tool-runtime';

let sessionStorage: Record<string, unknown>;

beforeEach(() => {
  sessionStorage = {};
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: vi.fn(async () => ({})),
        set: vi.fn(async () => undefined),
      },
      session: {
        get: vi.fn(async (key: string) => ({ [key]: sessionStorage[key] })),
        set: vi.fn(async (value: Record<string, unknown>) => {
          sessionStorage = structuredClone({ ...sessionStorage, ...value });
        }),
      },
    },
    permissions: {
      contains: vi.fn(async () => true),
    },
  });
});

describe('tool authorization context', () => {
  it('keeps the registered session storage identity stable', () => {
    expect(TOOL_AUTHORIZATION_STORAGE_KEY).toBe('deepseek_pp_tool_authorizations');
  });
  it('binds a legal call to the canonical descriptor and receiver-owned session', async () => {
    const descriptor = makeDescriptor();
    const grant = await createGrant([descriptor]);

    const authorized = await authorizeToolExecution(
      makeCall(),
      { kind: 'grant', grantId: grant.id, subject: SUBJECT },
      [descriptor],
    );

    expect(authorized.call).toMatchObject({
      id: 'call-1',
      descriptorId: descriptor.id,
      name: descriptor.name,
      invocationName: descriptor.invocationName,
      provider: descriptor.provider,
      source: {
        trigger: 'manual_chat',
        requestId: 'request-1',
        chatSessionId: 'chat-1',
      },
    });
    expect(authorized.descriptor).toEqual(descriptor);
  });

  it('preserves released manual/high tools when the exact policy was advertised', async () => {
    const descriptor = makeDescriptor({
      execution: { mode: 'manual', enabled: true, risk: 'high' },
    });
    const grant = await createGrant([descriptor]);

    await expect(authorizeToolExecution(
      makeCall(),
      { kind: 'grant', grantId: grant.id, subject: SUBJECT },
      [descriptor],
    )).resolves.toMatchObject({ descriptor });
  });

  it('fails visibly without rewriting malformed or future session state', async () => {
    sessionStorage.deepseek_pp_tool_authorizations = { version: 99, grants: {} };

    await expect(createGrant([makeDescriptor()]))
      .rejects.toThrow('Stored tool authorization state is invalid.');
    expect(sessionStorage.deepseek_pp_tool_authorizations).toEqual({ version: 99, grants: {} });
  });

  it('rejects nested corrupt v1 state without rewriting it', async () => {
    const corrupt = {
      version: 1,
      grants: {
        broken: {
          id: 'broken',
          requestId: 'request-1',
          trigger: 'manual_chat',
          descriptors: [],
          calls: { 'call-1': { descriptorId: 'tool', state: 'unknown' } },
        },
      },
    };
    sessionStorage.deepseek_pp_tool_authorizations = corrupt;

    await expect(createGrant([makeDescriptor()]))
      .rejects.toThrow('Stored tool authorization state is invalid.');
    expect(sessionStorage.deepseek_pp_tool_authorizations).toEqual(corrupt);
  });

  it('rejects oversized stored authorization state before rewriting it', async () => {
    const oversized = {
      version: 1,
      grants: {},
      padding: 'x'.repeat(4 * 1024 * 1024),
    };
    sessionStorage.deepseek_pp_tool_authorizations = oversized;

    await expect(createGrant([makeDescriptor()]))
      .rejects.toThrow('Stored tool authorization state is invalid.');
    expect(sessionStorage.deepseek_pp_tool_authorizations).toBe(oversized);
  });

  it('rejects stored state that exceeds the grant or per-grant call caps', async () => {
    const grant = await createGrant([makeDescriptor()]);
    const original = structuredClone(sessionStorage.deepseek_pp_tool_authorizations) as {
      version: 1;
      grants: Record<string, Record<string, unknown>>;
    };
    const template = original.grants[grant.id];
    original.grants = Object.fromEntries(
      Array.from({ length: 33 }, (_, index) => {
        const id = `grant-${index}`;
        return [id, { ...structuredClone(template), id }];
      }),
    );
    sessionStorage.deepseek_pp_tool_authorizations = original;

    await expect(createGrant([makeDescriptor()]))
      .rejects.toThrow('Stored tool authorization state is invalid.');

    const callOverflow = structuredClone(template) as Record<string, unknown> & {
      calls: Record<string, unknown>;
    };
    callOverflow.calls = Object.fromEntries(
      Array.from({ length: 129 }, (_, index) => [
        `call-${index}`,
        { descriptorId: makeDescriptor().id, state: 'collecting', retryUsed: false },
      ]),
    );
    sessionStorage.deepseek_pp_tool_authorizations = {
      version: 1,
      grants: { [grant.id]: callOverflow },
    };

    await expect(createGrant([makeDescriptor()]))
      .rejects.toThrow('Stored tool authorization state is invalid.');
  });

  it('rejects stored call-state and grant-binding invariant violations', async () => {
    const descriptor = makeDescriptor();
    const grant = await createGrant([descriptor]);
    await authorizeToolExecution(
      makeCall(),
      { kind: 'grant', grantId: grant.id, subject: SUBJECT },
      [descriptor],
    );
    const valid = structuredClone(sessionStorage.deepseek_pp_tool_authorizations) as StoredAuthorizationTestState;
    const corruptions: Array<(state: StoredAuthorizationTestState) => void> = [
      (state) => {
        const call = state.grants[grant.id].calls['call-1'];
        call.state = 'retryable';
        call.fingerprint = undefined;
        call.retryUsed = false;
      },
      (state) => {
        const call = state.grants[grant.id].calls['call-1'];
        call.state = 'retryable';
        call.retryUsed = true;
      },
      (state) => {
        const call = state.grants[grant.id].calls['call-1'];
        call.state = 'collecting';
        call.retryUsed = false;
      },
      (state) => {
        state.grants[grant.id].calls['call-1'].descriptorId = 'local:test:unknown';
      },
      (state) => {
        state.grants[grant.id].chatSessionId = 'chat-other';
      },
    ];

    for (const corrupt of corruptions) {
      const state = structuredClone(valid);
      corrupt(state);
      sessionStorage.deepseek_pp_tool_authorizations = state;
      await expect(createGrant([descriptor]))
        .rejects.toThrow('Stored tool authorization state is invalid.');
    }
  });

  it.each([
    {
      name: 'unknown descriptor',
      call: makeCall({ descriptorId: 'local:test:missing' }),
      code: 'tool_not_authorized',
    },
    {
      name: 'descriptor and name mismatch',
      call: makeCall({ name: 'other_tool' }),
      code: 'tool_descriptor_mismatch',
    },
    {
      name: 'provider mismatch',
      call: makeCall({
        provider: { kind: 'local', id: 'other', displayName: 'Other', transport: 'in_process' },
      }),
      code: 'tool_descriptor_mismatch',
    },
    {
      name: 'forged trigger',
      call: makeCall({ source: { trigger: 'automation', requestId: 'request-1', chatSessionId: 'chat-1' } }),
      code: 'tool_session_mismatch',
    },
    {
      name: 'forged request identity',
      call: makeCall({ source: { trigger: 'manual_chat', requestId: 'other', chatSessionId: 'chat-1' } }),
      code: 'tool_session_mismatch',
    },
  ])('rejects $name before execution', async ({ call, code }) => {
    const descriptor = makeDescriptor();
    const grant = await createGrant([descriptor]);

    await expect(authorizeToolExecution(
      call,
      { kind: 'grant', grantId: grant.id, subject: SUBJECT },
      [descriptor],
    )).rejects.toMatchObject({ code });
  });

  it.each([
    {
      name: 'disabled descriptor',
      current: makeDescriptor({ execution: { mode: 'auto', enabled: false, risk: 'low' } }),
    },
    {
      name: 'changed mode',
      current: makeDescriptor({ execution: { mode: 'manual', enabled: true, risk: 'low' } }),
    },
    {
      name: 'changed risk',
      current: makeDescriptor({ execution: { mode: 'auto', enabled: true, risk: 'high' } }),
    },
    {
      name: 'changed provider transport',
      current: makeDescriptor({
        provider: { kind: 'local', id: 'test', displayName: 'Test', transport: 'native_messaging' },
      }),
    },
    {
      name: 'changed input schema',
      current: makeDescriptor({
        inputSchema: { type: 'object', properties: { value: { type: 'string' } } },
      }),
    },
    {
      name: 'changed input field named description',
      current: makeDescriptor({
        inputSchema: { type: 'object', properties: { description: { type: 'integer' } } },
      }),
    },
  ])('rejects stale authorization after $name', async ({ current }) => {
    const descriptor = makeDescriptor();
    const grant = await createGrant([descriptor]);

    await expect(authorizeToolExecution(
      makeCall(),
      { kind: 'grant', grantId: grant.id, subject: SUBJECT },
      [current],
    )).rejects.toMatchObject({ code: 'tool_authorization_stale' });
  });

  it('does not stale a grant for localized schema description text alone', async () => {
    const descriptor = makeDescriptor({
      inputSchema: {
        type: 'object',
        properties: { value: { type: 'string', description: 'Original description' } },
      },
    });
    const grant = await createGrant([descriptor]);
    const localized = makeDescriptor({
      inputSchema: {
        type: 'object',
        properties: { value: { type: 'string', description: '本地化描述' } },
      },
    });

    await expect(authorizeToolExecution(
      makeCall(),
      { kind: 'grant', grantId: grant.id, subject: SUBJECT },
      [localized],
    )).resolves.toMatchObject({ descriptor: localized });
  });

  it('normalizes annotations inside draft-07 dependency and tuple schemas', async () => {
    const original = makeDescriptor({
      inputSchema: {
        type: 'object',
        dependencies: {
          mode: {
            type: 'object',
            description: 'Original dependency description',
            properties: { value: { type: 'string', description: 'Original value description' } },
          },
          enabled: ['mode'],
        },
        additionalItems: {
          type: 'string',
          description: 'Original tuple description',
        },
      } as ToolDescriptor['inputSchema'],
    });
    const localized = makeDescriptor({
      inputSchema: {
        type: 'object',
        dependencies: {
          mode: {
            type: 'object',
            description: '本地化依赖说明',
            properties: { value: { type: 'string', description: '本地化字段说明' } },
          },
          enabled: ['mode'],
        },
        additionalItems: {
          type: 'string',
          description: '本地化元组说明',
        },
      } as ToolDescriptor['inputSchema'],
    });
    const changedDependency = makeDescriptor({
      inputSchema: {
        ...localized.inputSchema,
        dependencies: {
          ...((localized.inputSchema as unknown as Record<string, unknown>).dependencies as Record<string, unknown>),
          enabled: ['other'],
        },
      } as ToolDescriptor['inputSchema'],
    });

    await expect(haveEquivalentToolDescriptorSecurity(original, localized)).resolves.toBe(true);
    await expect(haveEquivalentToolDescriptorSecurity(original, changedDependency)).resolves.toBe(false);
  });

  it('rejects expired and cross-session grants', async () => {
    const descriptor = makeDescriptor();
    const grant = await createGrant([descriptor], 100);

    await expect(authorizeToolExecution(
      makeCall(),
      { kind: 'grant', grantId: grant.id, subject: SUBJECT },
      [descriptor],
      100 + TOOL_AUTHORIZATION_TTL_MS + 1,
    )).rejects.toMatchObject({ code: 'tool_authorization_stale' });

    const liveGrant = await createGrant([descriptor]);
    await expect(authorizeToolExecution(
      makeCall(),
      {
        kind: 'grant',
        grantId: liveGrant.id,
        subject: { ...SUBJECT, documentSessionId: 'document-2' },
      },
      [descriptor],
    )).rejects.toMatchObject({ code: 'tool_session_mismatch' });
    await expect(authorizeToolExecution(
      makeCall(),
      {
        kind: 'grant',
        grantId: liveGrant.id,
        subject: { ...SUBJECT, chatSessionId: 'chat-2' },
      },
      [descriptor],
    )).rejects.toMatchObject({ code: 'tool_session_mismatch' });
  });

  it('allows the same document to transition from a new-chat route to its assigned session', async () => {
    const descriptor = makeDescriptor();
    const newChatSubject = { ...SUBJECT, chatSessionId: null };
    const grant = await createToolAuthorization({
      requestId: 'request-1',
      trigger: 'manual_chat',
      chatSessionId: null,
      subject: newChatSubject,
      descriptors: [descriptor],
    });

    await expect(authorizeToolExecution(
      makeCall({
        source: { trigger: 'manual_chat', requestId: 'request-1', chatSessionId: null },
      }),
      { kind: 'grant', grantId: grant.id, subject: SUBJECT },
      [descriptor],
    )).resolves.toMatchObject({ descriptor });

    await expect(authorizeToolExecution(
      makeCall({
        id: 'call-2',
        source: { trigger: 'manual_chat', requestId: 'request-1', chatSessionId: null },
      }),
      {
        kind: 'grant',
        grantId: grant.id,
        subject: { ...SUBJECT, chatSessionId: null },
      },
      [descriptor],
    )).rejects.toMatchObject({ code: 'tool_session_mismatch' });

    await expect(authorizeToolExecution(
      makeCall({
        id: 'call-3',
        source: { trigger: 'manual_chat', requestId: 'request-1', chatSessionId: null },
      }),
      {
        kind: 'grant',
        grantId: grant.id,
        subject: { ...SUBJECT, chatSessionId: 'chat-2' },
      },
      [descriptor],
    )).rejects.toMatchObject({ code: 'tool_session_mismatch' });

    await expect(closeToolAuthorization(
      grant.id,
      { ...SUBJECT, chatSessionId: 'chat-2' },
    )).resolves.toBeUndefined();
  });

  it('does not mint an arbitrary chat grant from a new-chat receiver', async () => {
    await expect(createToolAuthorization({
      requestId: 'request-1',
      trigger: 'manual_chat',
      chatSessionId: 'chat-forged',
      subject: { ...SUBJECT, chatSessionId: null },
      descriptors: [makeDescriptor()],
    })).rejects.toMatchObject({ code: 'tool_session_mismatch' });
  });

  it('atomically rejects sequential and concurrent replay', async () => {
    const descriptor = makeDescriptor();
    const grant = await createGrant([descriptor]);
    const context = { kind: 'grant' as const, grantId: grant.id, subject: SUBJECT };
    const first = await authorizeToolExecution(makeCall(), context, [descriptor]);
    await completeToolExecutionAuthorization(first.reservation, successResult());

    await expect(authorizeToolExecution(makeCall(), context, [descriptor]))
      .rejects.toMatchObject({ code: 'tool_call_replayed' });

    const secondGrant = await createGrant([descriptor]);
    const secondContext = { kind: 'grant' as const, grantId: secondGrant.id, subject: SUBJECT };
    const attempts = await Promise.allSettled([
      authorizeToolExecution(makeCall(), secondContext, [descriptor]),
      authorizeToolExecution(makeCall(), secondContext, [descriptor]),
    ]);
    expect(attempts.filter((attempt) => attempt.status === 'fulfilled')).toHaveLength(1);
    const rejected = attempts.find((attempt) => attempt.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({ code: 'tool_call_replayed' });
  });

  it('allows only the owning document to close a grant', async () => {
    const grant = await createGrant([makeDescriptor()]);
    await expect(closeToolAuthorization(grant.id, {
      ...SUBJECT,
      documentSessionId: 'document-2',
    })).rejects.toMatchObject({ code: 'tool_session_mismatch' });
    await expect(closeToolAuthorization(grant.id, SUBJECT)).resolves.toBeUndefined();
  });

  it('allows only the released permission retry before consuming the call', async () => {
    const descriptor = createWebSearchToolDescriptors('en')
      .find((item) => item.name === 'web_fetch')!;
    const grant = await createGrant([descriptor]);
    const context = { kind: 'grant' as const, grantId: grant.id, subject: SUBJECT };
    const call = makeWebFetchCall(descriptor);
    const first = await authorizeToolExecution(call, context, [descriptor]);
    await completeToolExecutionAuthorization(first.reservation, {
      ok: false,
      summary: 'Permission required',
      error: { code: 'fetch_permission_denied', message: 'Permission required', retryable: true },
    });

    const retry = await authorizeToolExecution(call, context, [descriptor]);
    await completeToolExecutionAuthorization(retry.reservation, successResult());
    await expect(authorizeToolExecution(call, context, [descriptor]))
      .rejects.toMatchObject({ code: 'tool_call_replayed' });
  });

  it('binds the one permission retry to the original payload and consumes a second denial', async () => {
    const descriptor = createWebSearchToolDescriptors('en')
      .find((item) => item.name === 'web_fetch')!;
    const grant = await createGrant([descriptor]);
    const context = { kind: 'grant' as const, grantId: grant.id, subject: SUBJECT };
    const first = await authorizeToolExecution(
      makeWebFetchCall(descriptor, 'https://example.test/one'),
      context,
      [descriptor],
    );
    const denied: ToolResult = {
      ok: false,
      summary: 'Permission required',
      error: { code: 'fetch_permission_denied', message: 'Permission required', retryable: true },
    };
    await completeToolExecutionAuthorization(first.reservation, denied);

    await expect(authorizeToolExecution(
      makeWebFetchCall(descriptor, 'https://example.test/two'),
      context,
      [descriptor],
    )).rejects.toMatchObject({ code: 'tool_call_identity_mismatch' });

    const retry = await authorizeToolExecution(
      makeWebFetchCall(descriptor, 'https://example.test/one'),
      context,
      [descriptor],
    );
    await completeToolExecutionAuthorization(retry.reservation, denied);
    await expect(authorizeToolExecution(
      makeWebFetchCall(descriptor, 'https://example.test/one'),
      context,
      [descriptor],
    )).rejects.toMatchObject({ code: 'tool_call_replayed' });
  });

  it('does not release a non-web-fetch reservation for a forged permission error code', async () => {
    const descriptor = makeDescriptor();
    const grant = await createGrant([descriptor]);
    const context = { kind: 'grant' as const, grantId: grant.id, subject: SUBJECT };
    const first = await authorizeToolExecution(makeCall(), context, [descriptor]);
    await completeToolExecutionAuthorization(first.reservation, {
      ok: false,
      summary: 'Forged permission error',
      error: { code: 'fetch_permission_denied', message: 'forged', retryable: true },
    });

    await expect(authorizeToolExecution(makeCall(), context, [descriptor]))
      .rejects.toMatchObject({ code: 'tool_call_replayed' });
  });

  it('binds external payload chunks to the same grant, invocation, and call identity', async () => {
    const descriptor = makeDescriptor();
    const grant = await createGrant([descriptor]);

    await expect(authorizeExternalToolPayloadChunk({
      grantId: grant.id,
      subject: SUBJECT,
      callId: 'call-1',
      invocationName: descriptor.invocationName,
      currentDescriptors: [descriptor],
    })).resolves.toEqual({ namespace: grant.id, expiresAt: grant.expiresAt });

    const writesAfterFirstChunk = vi.mocked(chrome.storage.session.set).mock.calls.length;
    await expect(authorizeExternalToolPayloadChunk({
      grantId: grant.id,
      subject: SUBJECT,
      callId: 'call-1',
      invocationName: descriptor.invocationName,
      currentDescriptors: [descriptor],
    })).resolves.toEqual({ namespace: grant.id, expiresAt: grant.expiresAt });
    expect(chrome.storage.session.set).toHaveBeenCalledTimes(writesAfterFirstChunk);

    await expect(authorizeExternalToolPayloadChunk({
      grantId: grant.id,
      subject: SUBJECT,
      callId: 'call-1',
      invocationName: 'other_tool',
      currentDescriptors: [descriptor],
    })).rejects.toBeInstanceOf(ToolAuthorizationError);

    await expect(authorizeToolExecution(
      makeCall(),
      { kind: 'grant', grantId: grant.id, subject: SUBJECT },
      [descriptor],
    )).resolves.toMatchObject({ reservation: { grantId: grant.id, callId: 'call-1' } });
  });

  it('rejects a mismatched provider before the runtime provider performs I/O', async () => {
    const descriptor = createWebSearchToolDescriptors('en')
      .find((item) => item.name === 'web_fetch')!;
    const grant = await createGrant([descriptor]);
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const result = await executeRuntimeToolCall({
      id: 'call-1',
      descriptorId: descriptor.id,
      provider: { ...descriptor.provider, id: 'forged-provider' },
      name: descriptor.name,
      invocationName: descriptor.invocationName,
      payload: { url: 'https://example.test/private' },
      raw: '<web_fetch>{"url":"https://example.test/private"}</web_fetch>',
      source: { trigger: 'manual_chat', requestId: 'request-1', chatSessionId: 'chat-1' },
    }, {
      kind: 'grant',
      grantId: grant.id,
      subject: SUBJECT,
    }, 'en');

    expect(result.error?.code).toBe('tool_descriptor_mismatch');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(chrome.storage.local.set).toHaveBeenCalledWith(expect.objectContaining({
      deepseek_pp_tool_history: expect.any(Array),
    }));
  });

  it('preserves parse-error history for a receiver-validated grant', async () => {
    const descriptor = makeDescriptor();
    const grant = await createGrant([descriptor]);
    const result = await executeRuntimeToolCall(
      makeCall({
        parseError: {
          code: 'tool_call_json_invalid',
          message: 'Invalid JSON',
          retryable: false,
        },
      }),
      { kind: 'grant', grantId: grant.id, subject: SUBJECT },
      'en',
    );

    expect(result.error?.code).toBe('tool_call_json_invalid');
    expect(chrome.storage.local.set).toHaveBeenCalledWith(expect.objectContaining({
      deepseek_pp_tool_history: expect.any(Array),
    }));
  });

  it('fails closed before provider I/O when reservation persistence fails', async () => {
    const descriptor = createWebSearchToolDescriptors('en')
      .find((item) => item.name === 'web_fetch')!;
    const grant = await createGrant([descriptor]);
    vi.mocked(chrome.storage.session.set).mockRejectedValueOnce(new Error('session write failed'));
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    await expect(executeRuntimeToolCall(
      makeWebFetchCall(descriptor),
      { kind: 'grant', grantId: grant.id, subject: SUBJECT },
      'en',
    )).rejects.toThrow('session write failed');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('preserves the provider result when completion persistence fails', async () => {
    const descriptor = createWebSearchToolDescriptors('en')
      .find((item) => item.name === 'web_fetch')!;
    const grant = await createGrant([descriptor]);
    let subsequentWrites = 0;
    vi.mocked(chrome.storage.session.set).mockImplementation(async (value: Record<string, unknown>) => {
      subsequentWrites++;
      if (subsequentWrites === 2) throw new Error('completion write failed');
      sessionStorage = structuredClone({ ...sessionStorage, ...value });
    });
    const fetchSpy = vi.fn(async () => new Response('provider-result', {
      status: 200,
      headers: { 'content-type': 'text/plain' },
    }));
    vi.stubGlobal('fetch', fetchSpy);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const result = await executeRuntimeToolCall(
      makeWebFetchCall(descriptor),
      { kind: 'grant', grantId: grant.id, subject: SUBJECT },
      'en',
    );

    expect(result.ok).toBe(true);
    expect(result.output).toMatchObject({ content: 'provider-result' });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(consoleError).toHaveBeenCalledWith(
      '[DeepSeek++] tool authorization completion persistence failed',
      expect.any(Error),
    );
  });
});

const SUBJECT: ToolAuthorizationSubject = {
  surface: 'deepseek_content',
  documentSessionId: 'document-1',
  tabId: 7,
  frameId: 0,
  chatSessionId: 'chat-1',
};

function makeDescriptor(overrides: Partial<ToolDescriptor> = {}): ToolDescriptor {
  return {
    id: 'local:test:sample_tool',
    provider: { kind: 'local', id: 'test', displayName: 'Test', transport: 'in_process' },
    name: 'sample_tool',
    invocationName: 'sample_tool',
    title: 'Sample tool',
    description: 'Sample tool.',
    inputSchema: { type: 'object', properties: {} },
    execution: { mode: 'auto', enabled: true, risk: 'low' },
    ...overrides,
  };
}

function makeCall(overrides: Partial<ToolCall> = {}): ToolCall {
  return {
    id: 'call-1',
    descriptorId: 'local:test:sample_tool',
    provider: { kind: 'local', id: 'test', displayName: 'Caller label', transport: 'in_process' },
    name: 'sample_tool',
    invocationName: 'sample_tool',
    payload: {},
    raw: '<sample_tool>{}</sample_tool>',
    source: { trigger: 'manual_chat', requestId: 'request-1', chatSessionId: 'chat-1' },
    ...overrides,
  };
}

async function createGrant(descriptors: ToolDescriptor[], now?: number) {
  return createToolAuthorization({
    requestId: 'request-1',
    trigger: 'manual_chat',
    chatSessionId: 'chat-1',
    subject: SUBJECT,
    descriptors,
    now,
  });
}

function successResult(): ToolResult {
  return { ok: true, summary: 'done' };
}

function makeWebFetchCall(
  descriptor: ToolDescriptor,
  url: string = 'https://example.test/page',
): ToolCall {
  return {
    id: 'call-1',
    descriptorId: descriptor.id,
    provider: descriptor.provider,
    name: descriptor.name,
    invocationName: descriptor.invocationName,
    payload: { url },
    raw: `<web_fetch>{"url":${JSON.stringify(url)}}</web_fetch>`,
    source: { trigger: 'manual_chat', requestId: 'request-1', chatSessionId: 'chat-1' },
  };
}

interface StoredAuthorizationTestState {
  version: 1;
  grants: Record<string, {
    chatSessionId: string | null;
    subject: ToolAuthorizationSubject;
    descriptors: Array<{ id: string }>;
    calls: Record<string, {
      descriptorId: string;
      state: 'collecting' | 'executing' | 'consumed' | 'retryable';
      fingerprint?: string;
      retryUsed: boolean;
    }>;
  }>;
}
