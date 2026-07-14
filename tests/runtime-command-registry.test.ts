import { describe, expect, it, vi } from 'vitest';
import { createBootstrapRuntimeClient } from '../core/messaging/bootstrap-client';
import { createBackgroundErrorResponse } from '../core/messaging/background-error';
import {
  CLIENT_ONLY_RUNTIME_COMMAND_TYPES,
  TYPED_RUNTIME_COMMAND_TYPES,
  createRuntimeCommandRegistry,
  createUnknownRuntimeCommandResponse,
  definePayloadlessRuntimeCommandHandler,
  defineRuntimeCommandHandler,
  getRuntimeCommandOwner,
  type RuntimeCommandHandler,
} from '../core/messaging/runtime-command-registry';
import type { RuntimeMessageContext } from '../core/messaging/runtime-boundary';
import { createBootstrapRuntimeHandlers } from '../entrypoints/background/bootstrap-handlers';

const context: RuntimeMessageContext = {
  runtimeId: 'extension-id',
  surface: 'extension_context',
  senderUrl: 'chrome-extension://extension-id/sidepanel.html',
  senderOrigin: 'chrome-extension://extension-id',
  documentSessionId: 'document-1',
};

describe('runtime command registry', () => {
  it('owns every known runtime command exactly once', () => {
    const allTypes = [
      ...TYPED_RUNTIME_COMMAND_TYPES,
      ...CLIENT_ONLY_RUNTIME_COMMAND_TYPES,
    ];

    expect(TYPED_RUNTIME_COMMAND_TYPES).toHaveLength(121);
    expect(TYPED_RUNTIME_COMMAND_TYPES).toEqual(expect.arrayContaining([
      'GET_MEMORIES',
      'GET_ARTIFACT',
      'GET_CONFIG',
      'WHATS_NEW_DISMISSED',
      'CLEAR_PET',
      'GET_MCP_SERVERS',
      'EXECUTE_TOOL_CALL',
      'GET_PLATFORM_CAPABILITIES',
      'GET_DEEPSEEK_API_KEY_STATUS',
      'EXPORT_DEEPSEEK_CONVERSATIONS',
    ]));
    expect(CLIENT_ONLY_RUNTIME_COMMAND_TYPES).toEqual(['TOOL_CALL_EXECUTED', 'MEMORIES_UPDATED']);
    expect(new Set(allTypes).size).toBe(123);
    for (const type of TYPED_RUNTIME_COMMAND_TYPES) {
      expect(getRuntimeCommandOwner(type)).toBe('typed-handler');
    }
    for (const type of CLIENT_ONLY_RUNTIME_COMMAND_TYPES) {
      expect(getRuntimeCommandOwner(type)).toBe('client-only');
    }
    expect(getRuntimeCommandOwner('UNKNOWN_COMMAND')).toBeUndefined();
  });

  it('decodes once after a typed command matches', async () => {
    const decode = vi.fn(() => ({ type: 'GET_CONFIG' as const }));
    const handle = vi.fn(() => ({ version: '1.10.0' }));
    const registry = createRuntimeCommandRegistry({
      typedHandlers: completeTypedHandlers([
        defineRuntimeCommandHandler({ type: 'GET_CONFIG', decode, handle }),
        definePayloadlessRuntimeCommandHandler('WHATS_NEW_DISMISSED', () => ({ ok: true as const })),
      ]),
    });

    await expect(registry.dispatch({ type: 'GET_CONFIG', payload: { ignored: true } }, context))
      .resolves.toEqual({ version: '1.10.0' });
    expect(decode).toHaveBeenCalledTimes(1);
    expect(handle).toHaveBeenCalledTimes(1);
  });

  it('rejects invalid registrations instead of using last-write-wins', () => {
    const config = definePayloadlessRuntimeCommandHandler('GET_CONFIG', () => ({ version: '1.10.0' }));
    const dismissed = definePayloadlessRuntimeCommandHandler('WHATS_NEW_DISMISSED', () => ({ ok: true as const }));
    expect(() => createRuntimeCommandRegistry({
      typedHandlers: completeTypedHandlers([config, config, dismissed]),
    })).toThrow('Duplicate runtime command handler: GET_CONFIG');
    expect(() => createRuntimeCommandRegistry({
      typedHandlers: completeTypedHandlers([config, dismissed])
        .filter((handler) => handler.type !== 'WHATS_NEW_DISMISSED'),
    })).toThrow('Missing typed runtime command handler: WHATS_NEW_DISMISSED');
    expect(() => createRuntimeCommandRegistry({
      typedHandlers: completeTypedHandlers([
        config,
        dismissed,
        {
          type: 'TOOL_CALL_EXECUTED',
          handle: async () => null,
        } as unknown as RuntimeCommandHandler,
      ]),
    })).toThrow('Runtime command is not owned by the typed registry: TOOL_CALL_EXECUTED');
  });

  it('rejects unknown and client-only commands', async () => {
    const registry = createRuntimeCommandRegistry({
      typedHandlers: completeTypedHandlers(createBootstrapRuntimeHandlers({
        getVersion: () => '1.10.0',
        dismissWhatsNew: async () => undefined,
        refreshWhatsNewBadge: async () => undefined,
      })),
    });

    for (const type of ['UNKNOWN_COMMAND', ...CLIENT_ONLY_RUNTIME_COMMAND_TYPES]) {
      await expect(registry.dispatch({ type }, context))
        .resolves.toEqual(createUnknownRuntimeCommandResponse());
    }
    expect(JSON.parse(JSON.stringify(createUnknownRuntimeCommandResponse())))
      .toEqual({ ok: false, error: 'runtime_command_unknown' });
  });

  it('does not fall back when a typed handler fails', async () => {
    const registry = createRuntimeCommandRegistry({
      typedHandlers: completeTypedHandlers([
        definePayloadlessRuntimeCommandHandler('GET_CONFIG', () => {
          throw new Error('manifest unavailable');
        }),
        definePayloadlessRuntimeCommandHandler('WHATS_NEW_DISMISSED', () => ({ ok: true as const })),
      ]),
    });

    await expect(registry.dispatch({ type: 'GET_CONFIG' }, context))
      .rejects.toThrow('manifest unavailable');
  });

  it('rejects a message delivered to a mismatched typed handler', async () => {
    const handler = definePayloadlessRuntimeCommandHandler(
      'GET_CONFIG',
      () => ({ version: '1.10.0' }),
    );

    await expect(handler.handle({ type: 'WHATS_NEW_DISMISSED' }, context))
      .rejects.toThrow('Runtime command handler GET_CONFIG received WHATS_NEW_DISMISSED.');
  });
});

describe('bootstrap runtime handlers and client', () => {
  it('preserves config response bytes and ignored request siblings', async () => {
    const registry = createRuntimeCommandRegistry({
      typedHandlers: completeTypedHandlers(createBootstrapRuntimeHandlers({
        getVersion: () => '1.10.0',
        dismissWhatsNew: async () => undefined,
        refreshWhatsNewBadge: async () => undefined,
      })),
    });

    const response = await registry.dispatch({
      type: 'GET_CONFIG',
      payload: { ignored: true },
      unknownSibling: 'preserved-at-envelope',
    }, context);
    expect(JSON.stringify(response)).toBe('{"version":"1.10.0"}');
  });

  it('dismisses before badge refresh and returns success only after both settle', async () => {
    const events: string[] = [];
    const registry = createRuntimeCommandRegistry({
      typedHandlers: completeTypedHandlers(createBootstrapRuntimeHandlers({
        getVersion: () => '1.10.0',
        async dismissWhatsNew() {
          events.push('dismiss');
        },
        async refreshWhatsNewBadge() {
          events.push('refresh');
        },
      })),
    });

    const response = await registry.dispatch({ type: 'WHATS_NEW_DISMISSED' }, context);
    expect(events).toEqual(['dismiss', 'refresh']);
    expect(JSON.stringify(response)).toBe('{"ok":true}');
  });

  it('surfaces each dismiss stage failure and does not report premature success', async () => {
    const refreshAfterDismissFailure = vi.fn(async () => undefined);
    const dismissFailureRegistry = createRuntimeCommandRegistry({
      typedHandlers: completeTypedHandlers(createBootstrapRuntimeHandlers({
        getVersion: () => '1.10.0',
        dismissWhatsNew: async () => Promise.reject(new Error('storage unavailable')),
        refreshWhatsNewBadge: refreshAfterDismissFailure,
      })),
    });
    await expect(dismissFailureRegistry.dispatch({ type: 'WHATS_NEW_DISMISSED' }, context))
      .rejects.toThrow('storage unavailable');
    expect(refreshAfterDismissFailure).not.toHaveBeenCalled();
    expect(createBackgroundErrorResponse(
      { type: 'WHATS_NEW_DISMISSED' },
      new Error('storage unavailable'),
      'unused',
    )).toEqual({ ok: false, error: 'storage unavailable' });

    const badgeFailureRegistry = createRuntimeCommandRegistry({
      typedHandlers: completeTypedHandlers(createBootstrapRuntimeHandlers({
        getVersion: () => '1.10.0',
        dismissWhatsNew: async () => undefined,
        refreshWhatsNewBadge: async () => Promise.reject('badge unavailable'),
      })),
    });
    await expect(badgeFailureRegistry.dispatch({ type: 'WHATS_NEW_DISMISSED' }, context))
      .rejects.toBe('badge unavailable');
    expect(createBackgroundErrorResponse(
      { type: 'WHATS_NEW_DISMISSED' },
      'badge unavailable',
      'unused',
    )).toEqual({ ok: false, error: 'badge unavailable' });
  });

  it('keeps the client wire records and response projection unchanged', async () => {
    const sendMessage = vi.fn(async (message: { type: string }) => (
      message.type === 'GET_CONFIG' ? { version: '1.10.0' } : { ok: true }
    ));
    const client = createBootstrapRuntimeClient(sendMessage);

    await expect(client.getConfig()).resolves.toEqual({ version: '1.10.0' });
    await expect(client.dismissWhatsNew()).resolves.toEqual({ ok: true });
    expect(sendMessage.mock.calls).toEqual([
      [{ type: 'GET_CONFIG' }],
      [{ type: 'WHATS_NEW_DISMISSED' }],
    ]);
  });

  it('decodes success and released failure responses at the client boundary', async () => {
    const configFailureClient = createBootstrapRuntimeClient(async () => ({
      ok: false,
      error: 'manifest unavailable',
      ignored: true,
    }));
    await expect(configFailureClient.getConfig()).resolves.toEqual({
      ok: false,
      error: 'manifest unavailable',
    });

    const ackFailureClient = createBootstrapRuntimeClient(async () => ({
      ok: false,
      error: 'storage unavailable',
    }));
    await expect(ackFailureClient.dismissWhatsNew()).resolves.toEqual({
      ok: false,
      error: 'storage unavailable',
    });
  });

  it.each([
    ['GET_CONFIG', 'truthy primitive', 'unexpected'],
    ['GET_CONFIG', 'wrong version field', { version: 110 }],
    ['GET_CONFIG', 'malformed failure', { ok: false, error: 7 }],
    ['WHATS_NEW_DISMISSED', 'array response', [{ ok: true }]],
    ['WHATS_NEW_DISMISSED', 'wrong acknowledgement', { ok: 'true' }],
    ['WHATS_NEW_DISMISSED', 'malformed failure', { ok: false }],
  ] as const)('rejects malformed %s responses: %s', async (type, _name, response) => {
    const client = createBootstrapRuntimeClient(async () => response);
    const request = type === 'GET_CONFIG' ? client.getConfig() : client.dismissWhatsNew();
    await expect(request).rejects.toThrow(`Invalid ${type} runtime response.`);
  });
});

function completeTypedHandlers(
  handlers: readonly RuntimeCommandHandler[],
): RuntimeCommandHandler[] {
  const provided = new Set<string>(handlers.map((handler) => handler.type));
  const stubs = TYPED_RUNTIME_COMMAND_TYPES
    .filter((type) => !provided.has(type))
    .map((type) => ({
      type,
      handle: async () => null,
    } as unknown as RuntimeCommandHandler));
  return [...handlers, ...stubs];
}
