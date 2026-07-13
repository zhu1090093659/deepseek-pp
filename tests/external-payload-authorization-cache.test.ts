import { describe, expect, it } from 'vitest';
import { ExternalPayloadAuthorizationCache } from '../core/tool/external-payload-authorization-cache';
import type { ToolAuthorizationSubject } from '../core/types';

describe('external payload authorization cache', () => {
  it('reuses only an exact receiver-owned collection binding', () => {
    const cache = new ExternalPayloadAuthorizationCache();
    const binding = {
      grantId: 'grant-1',
      callId: 'call-1',
      invocationName: 'artifact_create',
      subject: makeSubject(),
    };
    cache.remember(binding, 2_000, 1_000);

    expect(cache.has(binding, 1_500)).toBe(true);
    expect(cache.has({ ...binding, invocationName: 'local_file_write' }, 1_500)).toBe(false);
    expect(cache.has({ ...binding, subject: { ...binding.subject, documentSessionId: 'document-2' } }, 1_500)).toBe(false);
    expect(cache.has({ ...binding, subject: { ...binding.subject, chatSessionId: 'chat-2' } }, 1_500)).toBe(false);
  });

  it('expires a cached collection capability at the grant deadline', () => {
    const cache = new ExternalPayloadAuthorizationCache();
    const binding = {
      grantId: 'grant-1',
      callId: 'call-1',
      invocationName: 'artifact_create',
      subject: makeSubject(),
    };
    cache.remember(binding, 2_000, 1_000);

    expect(cache.has(binding, 1_999)).toBe(true);
    expect(cache.has(binding, 2_000)).toBe(false);
  });

  it('drops call and grant capabilities explicitly', () => {
    const cache = new ExternalPayloadAuthorizationCache();
    const first = {
      grantId: 'grant-1',
      callId: 'call-1',
      invocationName: 'artifact_create',
      subject: makeSubject(),
    };
    const second = { ...first, callId: 'call-2' };
    cache.remember(first, 2_000, 1_000);
    cache.remember(second, 2_000, 1_000);

    cache.deleteCall(first.grantId, first.callId);
    expect(cache.has(first, 1_500)).toBe(false);
    expect(cache.has(second, 1_500)).toBe(true);

    cache.deleteGrant(second.grantId);
    expect(cache.has(second, 1_500)).toBe(false);
  });
});

function makeSubject(): ToolAuthorizationSubject {
  return {
    surface: 'deepseek_content',
    documentSessionId: 'document-1',
    tabId: 7,
    frameId: 0,
    chatSessionId: 'chat-1',
  };
}
