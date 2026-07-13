import { describe, expect, it } from 'vitest';
import {
  DEEPSEEK_WEB_ROUTE_POLICY,
  encodeCompletionRequest,
  encodeCreateSessionRequest,
  encodeHistoryRequest,
  encodePowChallengeRequest,
  matchDeepSeekWebRoute,
  normalizeDeepSeekModelType,
} from '../core/deepseek/request-codec';
import {
  consumeDeepSeekSseEvents,
  createDeepSeekSseByteDecoder,
  createDeepSeekStreamSummary,
  extractResponseUsageStatsFromParsed,
  parseSSEData,
} from '../core/deepseek/stream-codec';
import {
  DEEPSEEK_ACTIVE_COMPLETION_BODY_FIXTURE,
  DEEPSEEK_ACTIVE_ROUTE_METHOD_FIXTURES,
  DEEPSEEK_ROUTE_CONTRACT,
} from './fixtures/external-runtime/deepseek';

describe('active DeepSeek protocol codecs', () => {
  it('matches every released web route by exact origin, path, and method', () => {
    for (const fixture of DEEPSEEK_ACTIVE_ROUTE_METHOD_FIXTURES) {
      const route = fixture.name as keyof typeof DEEPSEEK_WEB_ROUTE_POLICY;
      const url = `${DEEPSEEK_ROUTE_CONTRACT.origin}${fixture.path}`;
      expect(matchDeepSeekWebRoute({ url, method: fixture.method }), fixture.name).toBe(route);
      expect(matchDeepSeekWebRoute({
        url,
        method: fixture.method === 'GET' ? 'POST' : 'GET',
      })).toBeNull();
      expect(matchDeepSeekWebRoute({ url: `https://example.test${fixture.path}`, method: fixture.method })).toBeNull();
      expect(matchDeepSeekWebRoute({ url: `${url}/suffix`, method: fixture.method })).toBeNull();
      expect(matchDeepSeekWebRoute({
        url: `https://example.test/?next=${fixture.path}`,
        method: fixture.method,
      })).toBeNull();
    }
  });

  it('encodes session, PoW, completion, and history requests without a second wire shape', () => {
    const clientHeaders = { Authorization: 'Bearer contract-token', 'X-App-Version': '2.0.0' };
    expect(encodeCreateSessionRequest(clientHeaders)).toEqual({
      url: 'https://chat.deepseek.com/api/v0/chat_session/create',
      init: {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json', ...clientHeaders },
        body: '{}',
      },
    });

    expect(encodePowChallengeRequest(clientHeaders, '/api/v0/chat/completion')).toEqual({
      url: 'https://chat.deepseek.com/api/v0/chat/create_pow_challenge',
      init: {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json', ...clientHeaders },
        body: JSON.stringify({ target_path: '/api/v0/chat/completion' }),
      },
    });

    const completion = encodeCompletionRequest({
      chatSessionId: 'session-contract',
      parentMessageId: 19,
      modelType: 'deepseek_reasoner',
      prompt: 'Preserve the active request body.',
      refFileIds: ['file-contract'],
      thinkingEnabled: true,
      searchEnabled: false,
      clientHeaders,
      powHeaders: { 'X-DS-PoW-Response': 'contract-pow' },
    });
    expect(completion).toEqual({
      url: 'https://chat.deepseek.com/api/v0/chat/completion',
      init: {
        method: 'POST',
        credentials: 'include',
        headers: {
          'content-type': 'application/json',
          'X-DPP-Bypass-Hook': '1',
          ...clientHeaders,
          'X-DS-PoW-Response': 'contract-pow',
        },
        body: JSON.stringify(DEEPSEEK_ACTIVE_COMPLETION_BODY_FIXTURE),
      },
    });
    expect(completion.init.headers).not.toHaveProperty('Idempotency-Key');
    expect(String(completion.init.body)).not.toContain('idempotency');

    expect(encodeHistoryRequest('session-contract', clientHeaders)).toEqual({
      url: 'https://chat.deepseek.com/api/v0/chat/history_messages?chat_session_id=session-contract',
      init: {
        method: 'GET',
        credentials: 'include',
        headers: { accept: 'application/json', ...clientHeaders },
      },
    });
  });

  it('preserves every released model alias and default', () => {
    expect([
      null,
      'unknown',
      'chat',
      'deepseek_chat',
      'reasoner',
      'deepseek_reasoner',
      'DEFAULT',
      'default',
      'expert',
      'vision',
    ].map((value) => normalizeDeepSeekModelType(value))).toEqual([
      'default',
      'default',
      'default',
      'default',
      'expert',
      'expert',
      'DEFAULT',
      'default',
      'expert',
      'vision',
    ]);
  });

  it('decodes every UTF-8 split point with stable ids, usage, and FINISHED state', () => {
    const wire = [
      'event: ready\ndata: {"requestMessageId":"10","response_message_id":11,"model_type":"vision"}',
      'data: {"p":"response/fragments/-1/content","v":"你好"}',
      'data: {"p":"response","o":"BATCH","v":[{"p":"accumulated_token_usage","v":33},{"p":"quasi_status","v":"FINISHED"}]}',
      'event: update_session\ndata: {"updated_at":1003}',
    ].join('\n\n');
    const bytes = new TextEncoder().encode(wire);
    for (let splitAt = 0; splitAt <= bytes.length; splitAt++) {
      const decoder = createDeepSeekSseByteDecoder();
      const events = [
        ...decoder.push(bytes.slice(0, splitAt)),
        ...decoder.push(bytes.slice(splitAt)),
        ...decoder.finish(),
      ];
      const summary = createDeepSeekStreamSummary();
      const usage = events
        .map((event) => ({ event, parsed: parseSSEData(event.data) }))
        .map(({ event, parsed }) => extractResponseUsageStatsFromParsed(parsed, event.type))
        .filter((value) => value !== null);

      expect(consumeDeepSeekSseEvents(events, summary), `split ${splitAt}`).toBe('你好');
      expect(summary, `split ${splitAt}`).toEqual({
        assistantText: '你好',
        requestMessageId: 10,
        responseMessageId: 11,
        finished: true,
      });
      expect(usage, `split ${splitAt}`).toContainEqual({ modelType: 'vision' });
      expect(usage, `split ${splitAt}`).toContainEqual({ accumulatedTokenUsage: 33 });
      expect(usage, `split ${splitAt}`).toContainEqual({ updatedAt: 1003 });
    }
  });
});
