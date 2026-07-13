import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  BRIDGE_HANDSHAKE_TYPES,
  BRIDGE_MESSAGE_TYPES,
  BRIDGE_READY_TYPE,
  BRIDGE_SOURCES,
  isBridgeHandshakeMessage,
  requireBridgeMessage,
  validateBridgeMessage,
} from '../core/messaging/schema';
import {
  BRIDGE_HANDSHAKE_CONTRACT,
  CURRENT_GAP_BRIDGE_CASES,
  LEGAL_BRIDGE_CASES,
  REJECTED_BRIDGE_CASES,
} from './fixtures/runtime-contract/bridge';

const legalCases = Object.values(LEGAL_BRIDGE_CASES).flat();
const currentGapCases = Object.values(CURRENT_GAP_BRIDGE_CASES).flat();
const contentToMainTypes = new Set([
  'SYNC_HOOK_STATE',
  'AUGMENT_REQUEST_BODY_EXTEND_TIMEOUT',
  'AUGMENT_REQUEST_BODY_RESULT',
]);

describe('bridge message compatibility contract', () => {
  it('keeps one exhaustive authority for all 13 port message types', () => {
    expect(BRIDGE_MESSAGE_TYPES).toHaveLength(13);
    expect(new Set(BRIDGE_MESSAGE_TYPES).size).toBe(BRIDGE_MESSAGE_TYPES.length);
    expect(Object.keys(LEGAL_BRIDGE_CASES).sort()).toEqual([...BRIDGE_MESSAGE_TYPES].sort());
    expect(Object.keys(CURRENT_GAP_BRIDGE_CASES).sort()).toEqual([...BRIDGE_MESSAGE_TYPES].sort());
    for (const [type, cases] of Object.entries(LEGAL_BRIDGE_CASES)) {
      for (const fixture of cases) {
        expect(fixture.message.type).toBe(type);
        expect(fixture.expectedSource).toBe(contentToMainTypes.has(type)
          ? BRIDGE_SOURCES.content
          : BRIDGE_SOURCES.mainWorld);
      }
    }
  });

  it.each(legalCases)('accepts and serializes legal envelope: $name', ({ message, expectedSource }) => {
    const wireMessage = JSON.parse(JSON.stringify(message));

    expect(validateBridgeMessage(wireMessage, expectedSource)).toEqual(wireMessage);
    expect(requireBridgeMessage(wireMessage, expectedSource)).toEqual(wireMessage);
  });

  it.each(REJECTED_BRIDGE_CASES)('rejects malformed shallow envelope: $name', ({ message, expectedSource }) => {
    expect(validateBridgeMessage(message, expectedSource)).toBeNull();
    expect(() => requireBridgeMessage(message, expectedSource)).toThrow('Invalid DeepSeek++ bridge message.');
  });

  it.each(currentGapCases)(
    'characterizes shallow acceptance without making it legal: $name',
    ({ message, expectedSource, target }) => {
      expect(target).toBe('reject-after-T2.1');
      expect(validateBridgeMessage(message, expectedSource)).not.toBeNull();
    },
  );

  it.each(BRIDGE_HANDSHAKE_CONTRACT.legal)('accepts legal handshake: $name', ({ check }) => {
    expect(isBridgeHandshakeMessage(check)).toBe(true);
  });

  it.each(BRIDGE_HANDSHAKE_CONTRACT.rejected)('rejects malformed handshake: $name', ({ check }) => {
    expect(isBridgeHandshakeMessage(check)).toBe(false);
  });

  it('characterizes the same-origin source-string handshake as an unauthenticated current gap', () => {
    expect(BRIDGE_HANDSHAKE_CONTRACT.currentGap.target).toBe('authenticate-channel-after-T2.1');
    expect(isBridgeHandshakeMessage(BRIDGE_HANDSHAKE_CONTRACT.currentGap.check)).toBe(true);
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
    }
    expect(BRIDGE_HANDSHAKE_TYPES).toEqual({ request: 'DPP_BRIDGE_REQUEST', init: 'DPP_BRIDGE_INIT' });
    expect(BRIDGE_READY_TYPE).toBe(BRIDGE_HANDSHAKE_CONTRACT.ready.type);
    expect(mainWorldSource).toContain(`const BRIDGE_REQUEST_INTERVAL_MS = ${BRIDGE_HANDSHAKE_CONTRACT.retry.intervalMs}`);
    expect(mainWorldSource).toContain(`const BRIDGE_REQUEST_MAX_ATTEMPTS = ${BRIDGE_HANDSHAKE_CONTRACT.retry.maxAttempts}`);
  });
});
