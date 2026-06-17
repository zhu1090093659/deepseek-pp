import { describe, expect, it } from 'vitest';
import { resolveAutomationClientHeaders } from '../core/automation/auth';

describe('automation auth helpers', () => {
  it('returns a non-retryable auth failure when headers are missing', () => {
    const result = resolveAutomationClientHeaders(
      null,
      { chatSessionId: 'session-1', parentMessageId: 12 },
      'Sign in at chat.deepseek.com first.',
    );

    expect(result.kind).toBe('failure');
    if (result.kind !== 'failure') return;
    expect(result.result).toMatchObject({
      ok: false,
      chatSessionId: 'session-1',
      parentMessageId: 12,
      error: {
        code: 'deepseek_auth_token_missing',
        message: 'Sign in at chat.deepseek.com first.',
        phase: 'auth',
        retryable: false,
      },
    });
  });

  it('returns headers when authorization is present', () => {
    const headers = { Authorization: 'Bearer cached-token' };
    const result = resolveAutomationClientHeaders(
      headers,
      { chatSessionId: null, parentMessageId: null },
      'missing',
    );

    expect(result).toEqual({ kind: 'ok', headers });
  });
});