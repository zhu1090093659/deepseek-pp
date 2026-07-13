import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  BRIDGE_HANDSHAKE_TYPES,
  BRIDGE_MESSAGE_TYPES,
  BRIDGE_READY_TYPE,
  BRIDGE_SOURCES,
  BRIDGE_TYPE_SOURCES,
  createBridgeSessionController,
  createBridgeSessionContext,
  isBridgeHandshakeMessage,
  isCurrentBridgeSession,
  requireBridgeMessage,
  validateBridgeMessage,
} from '../core/messaging/schema';
import {
  BRIDGE_HANDSHAKE_CONTRACT,
  MALFORMED_BRIDGE_PAYLOAD_CASES,
  LEGAL_BRIDGE_CASES,
  REJECTED_BRIDGE_CASES,
} from './fixtures/runtime-contract/bridge';
import { normalizeMcpToolDescriptor, type McpServerConfig } from '../core/mcp';

const legalCases = Object.values(LEGAL_BRIDGE_CASES).flat();
const malformedPayloadCases = Object.values(MALFORMED_BRIDGE_PAYLOAD_CASES).flat();
describe('bridge message compatibility contract', () => {
  it('keeps one exhaustive authority for all 14 port message types', () => {
    expect(BRIDGE_MESSAGE_TYPES).toHaveLength(14);
    expect(new Set(BRIDGE_MESSAGE_TYPES).size).toBe(BRIDGE_MESSAGE_TYPES.length);
    expect(Object.keys(LEGAL_BRIDGE_CASES).sort()).toEqual([...BRIDGE_MESSAGE_TYPES].sort());
    expect(Object.keys(MALFORMED_BRIDGE_PAYLOAD_CASES).sort()).toEqual([...BRIDGE_MESSAGE_TYPES].sort());
    for (const [type, cases] of Object.entries(LEGAL_BRIDGE_CASES)) {
      for (const fixture of cases) {
        expect(fixture.message.type).toBe(type);
        expect(fixture.expectedSource).toBe(BRIDGE_TYPE_SOURCES[type as keyof typeof BRIDGE_TYPE_SOURCES]);
      }
    }
  });

  it.each(legalCases)('accepts and serializes legal envelope: $name', ({ message, expectedSource }) => {
    const wireMessage = JSON.parse(JSON.stringify(message));

    expect(validateBridgeMessage(wireMessage, expectedSource)).toEqual(wireMessage);
    expect(requireBridgeMessage(wireMessage, expectedSource)).toEqual(wireMessage);
  });

  it('accepts an MCP JSON Schema object in additionalProperties', () => {
    const descriptor = normalizeMcpToolDescriptor(mcpServerFixture(), {
      name: 'lookup_labels',
      inputSchema: {
        type: 'object',
        additionalProperties: { type: 'string' },
      },
    });

    expect(validateBridgeMessage({
      source: BRIDGE_SOURCES.content,
      type: 'SYNC_HOOK_STATE',
      toolDescriptors: [descriptor],
      skillSummaries: [],
    }, BRIDGE_SOURCES.content)).not.toBeNull();
    expect(validateBridgeMessage({
      source: BRIDGE_SOURCES.content,
      type: 'SYNC_HOOK_STATE',
      toolDescriptors: [{
        ...descriptor,
        inputSchema: { ...descriptor.inputSchema, additionalProperties: 'invalid' },
      }],
      skillSummaries: [],
    }, BRIDGE_SOURCES.content)).toBeNull();
  });

  it.each(REJECTED_BRIDGE_CASES)('rejects malformed shallow envelope: $name', ({ message, expectedSource }) => {
    expect(validateBridgeMessage(message, expectedSource)).toBeNull();
    expect(() => requireBridgeMessage(message, expectedSource)).toThrow('Invalid DeepSeek++ bridge message.');
  });

  it.each(malformedPayloadCases)(
    'rejects malformed nested payload before dispatch: $name',
    ({ message, expectedSource, target }) => {
      expect(target).toBe('reject-at-T2.1-boundary');
      expect(validateBridgeMessage(message, expectedSource)).toBeNull();
      expect(() => requireBridgeMessage(message, expectedSource)).toThrow('Invalid DeepSeek++ bridge message.');
    },
  );

  it.each(legalCases)('rejects legal payload in the wrong direction: $name', ({ message, expectedSource }) => {
    const wrongSource = expectedSource === BRIDGE_SOURCES.mainWorld
      ? BRIDGE_SOURCES.content
      : BRIDGE_SOURCES.mainWorld;
    expect(validateBridgeMessage({ ...message, source: wrongSource }, wrongSource)).toBeNull();
  });

  it.each(BRIDGE_HANDSHAKE_CONTRACT.legal)('accepts legal handshake: $name', ({ check }) => {
    expect(isBridgeHandshakeMessage(check)).toBe(true);
  });

  it.each(BRIDGE_HANDSHAKE_CONTRACT.rejected)('rejects malformed handshake: $name', ({ check }) => {
    expect(isBridgeHandshakeMessage(check)).toBe(false);
  });

  it('documents that MAIN-world identity is routing, not authentication', () => {
    expect(BRIDGE_HANDSHAKE_CONTRACT.mainWorldTrustPolicy.target).toBe('treat-main-payload-as-untrusted-after-T2.1');
    expect(isBridgeHandshakeMessage(BRIDGE_HANDSHAKE_CONTRACT.mainWorldTrustPolicy.check)).toBe(true);
  });

  it('binds port dispatch to receiver-owned current document context', () => {
    const controller = createBridgeSessionController('https://chat.deepseek.com');
    const current = controller.open('content-document-1', 'https://chat.deepseek.com', true);
    const sameValuesButForeign = createBridgeSessionContext(
      'content-document-1',
      'https://chat.deepseek.com',
      'https://chat.deepseek.com',
      true,
    );

    expect(isCurrentBridgeSession({
      candidate: current,
      current,
      actualOrigin: 'https://chat.deepseek.com',
      actualTopLevel: true,
    })).toBe(true);
    expect(isCurrentBridgeSession({
      candidate: sameValuesButForeign,
      current,
      actualOrigin: 'https://chat.deepseek.com',
      actualTopLevel: true,
    })).toBe(false);
    expect(isCurrentBridgeSession({
      candidate: current,
      current: null,
      actualOrigin: 'https://chat.deepseek.com',
      actualTopLevel: true,
    })).toBe(false);
    expect(isCurrentBridgeSession({
      candidate: current,
      current,
      actualOrigin: 'https://example.test',
      actualTopLevel: true,
    })).toBe(false);
    expect(isCurrentBridgeSession({
      candidate: current,
      current,
      actualOrigin: 'https://chat.deepseek.com',
      actualTopLevel: false,
    })).toBe(false);
  });

  it('prevents stale port handlers from dispatching after close or replacement', () => {
    const controller = createBridgeSessionController('https://chat.deepseek.com');
    const dispatched: string[] = [];
    const createReceiver = (session: ReturnType<typeof controller.open>) => (value: unknown) => {
      if (!controller.accepts(session, 'https://chat.deepseek.com', true)) return;
      const message = validateBridgeMessage(value, BRIDGE_SOURCES.mainWorld);
      if (message) dispatched.push(message.type);
    };
    const staleMessages = [
      LEGAL_BRIDGE_CASES.TOOL_CALL[0].message,
      LEGAL_BRIDGE_CASES.TOOL_CALL_CHUNK[0].message,
      LEGAL_BRIDGE_CASES.MEMORIES_USED[0].message,
      LEGAL_BRIDGE_CASES.HEADERS_CAPTURED[0].message,
      LEGAL_BRIDGE_CASES.RESPONSE_COMPLETE[0].message,
    ];

    const sessionA = controller.open('document-session-a', 'https://chat.deepseek.com', true);
    const receiveA = createReceiver(sessionA);
    receiveA(staleMessages[0]);
    expect(dispatched).toEqual(['TOOL_CALL']);

    expect(controller.close(sessionA)).toBe(true);
    staleMessages.forEach(receiveA);
    expect(dispatched).toEqual(['TOOL_CALL']);

    const sessionB = controller.open('document-session-b', 'https://chat.deepseek.com', true);
    const receiveB = createReceiver(sessionB);
    staleMessages.forEach(receiveA);
    staleMessages.forEach(receiveB);
    expect(dispatched).toEqual([
      'TOOL_CALL',
      'TOOL_CALL',
      'TOOL_CALL_CHUNK',
      'MEMORIES_USED',
      'HEADERS_CAPTURED',
      'RESPONSE_COMPLETE',
    ]);
  });

  it('rejects a bridge session created for a wrong origin or child frame', () => {
    expect(() => createBridgeSessionContext(
      'content-document-1',
      'https://example.test',
      'https://chat.deepseek.com',
      true,
    )).toThrow('Invalid DeepSeek++ bridge session context.');
    expect(() => createBridgeSessionContext(
      'content-document-1',
      'https://chat.deepseek.com',
      'https://chat.deepseek.com',
      false,
    )).toThrow('Invalid DeepSeek++ bridge session context.');
  });

  it('rejects array handshakes, a wrong WindowProxy, subframes, and extra ports', () => {
    const source = {};
    const base = {
      value: { source: BRIDGE_SOURCES.mainWorld, type: BRIDGE_HANDSHAKE_TYPES.request },
      actualOrigin: 'https://chat.deepseek.com',
      expectedOrigin: 'https://chat.deepseek.com',
      expectedSource: BRIDGE_SOURCES.mainWorld,
      expectedType: BRIDGE_HANDSHAKE_TYPES.request,
      alreadyConnected: false,
      actualWindowSource: source,
      expectedWindowSource: source,
      actualTopLevel: true,
      requireTopLevel: true,
    } as const;

    expect(isBridgeHandshakeMessage(base)).toBe(true);
    expect(isBridgeHandshakeMessage({ ...base, value: Object.assign([], base.value) })).toBe(false);
    expect(isBridgeHandshakeMessage({ ...base, actualWindowSource: {} })).toBe(false);
    expect(isBridgeHandshakeMessage({ ...base, actualTopLevel: false })).toBe(false);
    expect(isBridgeHandshakeMessage({ ...base, requireTransferredPort: true, transferredPortCount: 2 })).toBe(false);
  });

  it('uses shared handshake constants and freezes the retry budget', () => {
    const contentSource = readFileSync('entrypoints/content.ts', 'utf8');
    const mainWorldSource = readFileSync('entrypoints/main-world.content.ts', 'utf8');

    for (const source of [contentSource, mainWorldSource]) {
      expect(source).toContain('const MAIN_WORLD_SOURCE = BRIDGE_SOURCES.mainWorld');
      expect(source).toContain('const CONTENT_SOURCE = BRIDGE_SOURCES.content');
      expect(source).toContain('const BRIDGE_REQUEST_TYPE = BRIDGE_HANDSHAKE_TYPES.request');
      expect(source).toContain('const BRIDGE_INIT_TYPE = BRIDGE_HANDSHAKE_TYPES.init');
      expect(source).toContain('isBridgeHandshakeMessage({');
      expect(source).toContain('actualWindowSource: event.source');
      expect(source).toContain('expectedWindowSource: window');
      expect(source).toContain('requireTopLevel: true');
    }
    expect(BRIDGE_HANDSHAKE_TYPES).toEqual({ request: 'DPP_BRIDGE_REQUEST', init: 'DPP_BRIDGE_INIT' });
    expect(BRIDGE_READY_TYPE).toBe(BRIDGE_HANDSHAKE_CONTRACT.ready.type);
    expect(mainWorldSource).toContain(`const BRIDGE_REQUEST_INTERVAL_MS = ${BRIDGE_HANDSHAKE_CONTRACT.retry.intervalMs}`);
    expect(mainWorldSource).toContain(`const BRIDGE_REQUEST_MAX_ATTEMPTS = ${BRIDGE_HANDSHAKE_CONTRACT.retry.maxAttempts}`);
    expect(contentSource).toContain("window.addEventListener('pagehide', () => disconnectMainWorldPort())");
    expect(mainWorldSource).toContain("window.addEventListener('pagehide', () => disconnectContentPort())");
    expect(mainWorldSource).toContain('if (event.persisted && !contentPort) startBridgeRequests()');
    expect(mainWorldSource).toContain("pending.reject(new Error('DeepSeek++ main/content bridge disconnected.'))");
  });
});

function mcpServerFixture(): McpServerConfig {
  return {
    version: 1,
    id: 'schema-contract',
    displayName: 'Schema Contract',
    enabled: true,
    transport: { kind: 'streamable_http', url: 'https://example.test/mcp' },
    headers: [],
    secrets: [],
    timeouts: { connectMs: 5_000, requestMs: 60_000, discoveryMs: 10_000 },
    limits: { maxResultBytes: 128_000, maxToolCount: 16 },
    allowlist: { mode: 'all', toolNames: [] },
    execution: { mode: 'auto', enabled: true },
    status: 'ready',
    lastConnectedAt: null,
    lastError: null,
    createdAt: 0,
    updatedAt: 0,
  };
}
