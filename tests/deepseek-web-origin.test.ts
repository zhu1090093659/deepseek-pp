import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildDeepSeekSessionUrl, getDeepSeekWebOrigin } from '../core/deepseek/adapter';

describe('DeepSeek web origin resolution', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses chat.deepseek.com when running on the DeepSeek site', () => {
    vi.stubGlobal('location', {
      hostname: 'chat.deepseek.com',
      origin: 'https://chat.deepseek.com',
    } as Location);

    expect(getDeepSeekWebOrigin()).toBe('https://chat.deepseek.com');
    expect(buildDeepSeekSessionUrl('session-1')).toBe('https://chat.deepseek.com/a/chat/s/session-1');
  });

  it('falls back to the DeepSeek origin in extension or service worker contexts', () => {
    vi.stubGlobal('location', {
      hostname: 'chhlagfdfeanaefgbdbgmdlpgaoahhbi',
      origin: 'chrome-extension://chhlagfdfeanaefgbdbgmdlpgaoahhbi',
    } as Location);

    expect(getDeepSeekWebOrigin()).toBe('https://chat.deepseek.com');
    expect(buildDeepSeekSessionUrl('session-1')).toBe('https://chat.deepseek.com/a/chat/s/session-1');
  });
});