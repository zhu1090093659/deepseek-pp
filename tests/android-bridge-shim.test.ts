import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ANDROID_MINIMUM_CONTRACT } from './fixtures/external-runtime/android';

const shim = readFileSync(resolve(process.cwd(), 'android/web/android-bridge-shim.js'), 'utf8');

describe('Android bridge shim', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('uses one versioned transport and preserves an existing downloads surface', async () => {
    const downloads = { download: () => 7 };
    const fixture = executeShim({ chrome: { downloads } });

    await expect(fixture.window.chrome.runtime.sendMessage({ type: 'GET_MEMORIES' })).resolves.toEqual([]);
    expect(fixture.requests).toEqual([expect.objectContaining({
      protocol: ANDROID_MINIMUM_CONTRACT.bridgeProtocol,
      version: ANDROID_MINIMUM_CONTRACT.bridgeVersion,
      command: 'runtime.sendMessage',
      payload: { message: { type: 'GET_MEMORIES' } },
    })]);
    expect(fixture.window.chrome.downloads).toBe(downloads);
    expect(fixture.window.chrome.runtime.getURL('/content-scripts/content.js'))
      .toBe('file:///android_asset/dpp/content-scripts/content.js');
  });

  it('batches allowlisted storage operations and preserves object defaults', async () => {
    const fixture = executeShim({
      results: {
        'storage.get': { values: { deepseek_pp_locale_preference: 'zh-CN' } },
      },
    });
    const storage = fixture.window.chrome.storage.local;

    await expect(storage.get({
      deepseek_pp_locale_preference: 'auto',
      deepseek_pp_history_organizer: { enabled: false },
    })).resolves.toEqual({
      deepseek_pp_locale_preference: 'zh-CN',
      deepseek_pp_history_organizer: { enabled: false },
    });
    await storage.set({ deepseek_pp_history_organizer: { enabled: true } });
    await storage.remove(['deepseek_pp_history_organizer', 'deepseek_pp_floating_chat_enabled']);

    expect(fixture.requests.map((request) => [request.command, request.payload])).toEqual([
      ['storage.get', { keys: ['deepseek_pp_locale_preference', 'deepseek_pp_history_organizer'] }],
      ['storage.set', { values: { deepseek_pp_history_organizer: { enabled: true } } }],
      ['storage.remove', { keys: ['deepseek_pp_history_organizer', 'deepseek_pp_floating_chat_enabled'] }],
    ]);
  });

  it('rejects malformed native responses instead of returning undefined', async () => {
    const fixture = executeShim({ rawResponse: 'not-json' });
    await expect(fixture.window.chrome.runtime.sendMessage({ type: 'GET_MEMORIES' }))
      .rejects.toThrow('android_bridge_invalid_response');
  });

  it('rejects explicit transport errors by stable code', async () => {
    const fixture = executeShim({ errorCode: 'android_bridge_command_unsupported' });
    await expect(fixture.window.chrome.runtime.sendMessage({ type: 'GET_MEMORIES' }))
      .rejects.toThrow('android_bridge_command_unsupported');
  });

  it('is idempotent when the bundle is injected twice', async () => {
    const fixture = executeShim();
    runShim(fixture.window);
    await expect(fixture.window.chrome.runtime.sendMessage({ type: 'GET_SKILLS' })).resolves.toEqual([]);
    expect(fixture.requests).toHaveLength(1);
  });

  it('correlates concurrent responses out of order and ignores unknown ids', async () => {
    const requests: Array<Record<string, any>> = [];
    const bridge: Record<string, any> = {
      postMessage(raw: string) {
        requests.push(JSON.parse(raw));
      },
    };
    const window = { AndroidBridge: bridge, chrome: {} } as Record<string, any>;
    runShim(window);

    const memories = window.chrome.runtime.sendMessage({ type: 'GET_MEMORIES' });
    const skills = window.chrome.runtime.sendMessage({ type: 'GET_SKILLS' });
    bridge.onmessage({ data: response('unknown', ['ignored']) });
    bridge.onmessage({ data: response(requests[1].id, ['skill']) });
    bridge.onmessage({ data: response(requests[0].id, ['memory']) });

    await expect(Promise.all([memories, skills])).resolves.toEqual([['memory'], ['skill']]);
  });

  it('rejects success responses that omit the result field', async () => {
    const fixture = executeShim({ omitResult: true });
    await expect(fixture.window.chrome.runtime.sendMessage({ type: 'GET_MEMORIES' }))
      .rejects.toThrow('android_bridge_invalid_response');
  });

  it('rejects requests that exceed the response deadline', async () => {
    vi.useFakeTimers();
    const bridge = { postMessage() {} } as Record<string, any>;
    const window = { AndroidBridge: bridge, chrome: {} } as Record<string, any>;
    runShim(window);
    const request = window.chrome.runtime.sendMessage({ type: 'GET_MEMORIES' });
    const assertion = expect(request).rejects.toThrow('android_bridge_response_timeout');
    await vi.advanceTimersByTimeAsync(10_000);
    await assertion;
  });

  it('does not install browser shims when the safe bridge is absent', () => {
    const window = {} as Record<string, any>;
    runShim(window);
    expect(window.chrome).toBeUndefined();
  });
});

function executeShim(options: {
  chrome?: Record<string, any>;
  results?: Record<string, unknown>;
  rawResponse?: string;
  errorCode?: string;
  omitResult?: boolean;
} = {}) {
  const requests: Array<Record<string, any>> = [];
  const bridge: Record<string, any> = {
    postMessage(raw: string) {
      const request = JSON.parse(raw) as Record<string, any>;
      requests.push(request);
      queueMicrotask(() => {
        const data = options.rawResponse ?? JSON.stringify({
          protocol: ANDROID_MINIMUM_CONTRACT.bridgeProtocol,
          version: ANDROID_MINIMUM_CONTRACT.bridgeVersion,
          id: request.id,
          ok: !options.errorCode,
          ...(options.errorCode
            ? { error: { code: options.errorCode } }
            : options.omitResult
              ? {}
              : { result: options.results?.[request.command] ?? [] }),
        });
        bridge.onmessage({ data });
      });
    },
  };
  const window = {
    AndroidBridge: bridge,
    chrome: options.chrome ?? {},
  } as Record<string, any>;
  runShim(window);
  return { window, requests };
}

function response(id: string, result: unknown): string {
  return JSON.stringify({
    protocol: ANDROID_MINIMUM_CONTRACT.bridgeProtocol,
    version: ANDROID_MINIMUM_CONTRACT.bridgeVersion,
    id,
    ok: true,
    result,
  });
}

function runShim(window: Record<string, any>) {
  const execute = new Function('window', 'setTimeout', 'clearTimeout', shim);
  execute(window, setTimeout, clearTimeout);
}
