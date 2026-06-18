import { describe, expect, it } from 'vitest';
import { requireBridgeMessage, validateBridgeMessage } from '../core/messaging/schema';

describe('bridge message schema', () => {
  it('accepts known bridge messages from the expected source', () => {
    const message = validateBridgeMessage({
      source: 'deepseek-pp-main',
      type: 'AUGMENT_REQUEST_BODY',
      id: 'req-1',
      body: '{"prompt":"hello"}',
    }, 'deepseek-pp-main');

    expect(message?.type).toBe('AUGMENT_REQUEST_BODY');
    expect(message?.id).toBe('req-1');
  });

  it('accepts per-request augmentation timeout extensions', () => {
    const message = validateBridgeMessage({
      source: 'deepseek-pp-content',
      type: 'AUGMENT_REQUEST_BODY_EXTEND_TIMEOUT',
      id: 'req-1',
      timeoutMs: 190_000,
    }, 'deepseek-pp-content');

    expect(message?.type).toBe('AUGMENT_REQUEST_BODY_EXTEND_TIMEOUT');
    expect(message?.timeoutMs).toBe(190_000);
  });

  it('rejects unknown types, source mismatches, and malformed optional fields', () => {
    expect(validateBridgeMessage({ source: 'deepseek-pp-main', type: 'UNKNOWN' })).toBeNull();
    expect(validateBridgeMessage({ source: 'other', type: 'DPP_BRIDGE_READY' }, 'deepseek-pp-main')).toBeNull();
    expect(validateBridgeMessage({ source: 'deepseek-pp-main', type: 'DPP_BRIDGE_READY', ok: 'yes' })).toBeNull();
    expect(validateBridgeMessage({
      source: 'deepseek-pp-content',
      type: 'AUGMENT_REQUEST_BODY_EXTEND_TIMEOUT',
      timeoutMs: '190000',
    })).toBeNull();
  });

  it('throws a clear error for required bridge messages', () => {
    expect(() => requireBridgeMessage({ source: 'deepseek-pp-main', type: 'NOPE' }))
      .toThrow('Invalid DeepSeek++ bridge message.');
  });
});
