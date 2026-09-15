/**
 * DeepSeek-web StreamFn adapter tests (Issue A1-T2).
 *
 * Uses the same adapter mock seam as the inline-agent tests
 * (`vi.mock('../core/deepseek/adapter')`), so the turn submitter exercises
 * the real no-chunk-retry / step-timeout semantics against mocked
 * `submitPromptStreaming`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AssistantMessageEvent, Api, Context, Message, Model } from '@earendil-works/pi-ai';
import { createArtifactToolDescriptors } from '../core/artifact';
import { DeepSeekAuthError } from '../core/deepseek/errors';
import type { ToolDescriptor } from '../core/types';
import type {
  DeepSeekSessionState,
  DeepSeekStreamFnDeps,
  DeepSeekTurnRequest,
} from '../core/inline-agent/pi/stream-fn-port';

const adapterMocks = vi.hoisted(() => ({
  createPowHeaders: vi.fn(),
  submitPromptStreaming: vi.fn(),
}));

vi.mock('../core/deepseek/adapter', () => ({
  createClientHeaders: () => ({ Authorization: 'Bearer test-token' }),
  createPowHeaders: adapterMocks.createPowHeaders,
  submitPromptStreaming: adapterMocks.submitPromptStreaming,
}));

const {
  createDeepSeekStreamFn,
  createDeepSeekTurnSubmitter,
  DEEPSEEK_INTERRUPTED_TIMEOUT_MESSAGE,
  DEEPSEEK_INTERRUPTED_ENDED_MESSAGE,
  isDeepSeekInterruptedTurnError,
} = await import('../core/inline-agent/pi/deepseek-stream-fn');

const TOOL_CALL_TEXT = '<artifact_create>{"filename":"a.txt","content":"ok"}</artifact_create>';

const TEST_MODEL: Model<Api> = {
  id: 'deepseek-chat',
  name: 'DeepSeek Chat',
  api: 'openai-completions',
  provider: 'deepseek',
  baseUrl: 'https://api.deepseek.com',
  reasoning: false,
  input: [],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 0,
  maxTokens: 0,
};

const TOOL_DESCRIPTORS: readonly ToolDescriptor[] = createArtifactToolDescriptors('en');

function createSession(initialParent: number | null = 100): DeepSeekSessionState & { updates: Array<number | null> } {
  const updates: Array<number | null> = [];
  return {
    chatSessionId: 'chat-1',
    parentMessageId: initialParent,
    setParentMessageId(id) {
      updates.push(id);
    },
    updates,
  };
}

function createDeps(
  overrides: Partial<DeepSeekStreamFnDeps> = {},
): DeepSeekStreamFnDeps & { session: ReturnType<typeof createSession> } {
  const session = createSession();
  return {
    submitTurn: createDeepSeekTurnSubmitter({}),
    session,
    serializePrompt: (context: Context) => `serialized(${context.messages.length})`,
    mapToolCall: (call, index) => ({
      type: 'toolCall',
      id: `xml:${index}`,
      name: call.invocationName,
      arguments: call.payload,
    }),
    toolDescriptors: TOOL_DESCRIPTORS,
    turnDefaults: {
      modelType: null,
      refFileIds: [],
      thinkingEnabled: false,
      searchEnabled: false,
    },
    ...overrides,
  } as DeepSeekStreamFnDeps & { session: ReturnType<typeof createSession> };
}

const EMPTY_CONTEXT: Context = { messages: [] };

function turnResult(overrides: Partial<{ responseMessageId: number | null; requestMessageId: number | null; finished: boolean }> = {}) {
  return {
    assistantText: '',
    responseMessageId: 102,
    requestMessageId: 101,
    finished: true,
    ...overrides,
  };
}

async function collectEvents(
  deps: DeepSeekStreamFnDeps,
  context: Context = EMPTY_CONTEXT,
  signal?: AbortSignal,
): Promise<AssistantMessageEvent[]> {
  const streamFn = createDeepSeekStreamFn(deps);
  const stream = await streamFn(TEST_MODEL, context, { signal });
  const events: AssistantMessageEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

describe('createDeepSeekStreamFn', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    adapterMocks.createPowHeaders.mockResolvedValue({ 'X-DS-PoW-Response': 'pow-1' });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('maps a text-only turn to text events and a done event', async () => {
    adapterMocks.submitPromptStreaming.mockImplementationOnce(async (_input, handlers) => {
      handlers.onTextChunk('Hello ');
      handlers.onTextChunk('world.');
      return turnResult();
    });

    const deps = createDeps();
    const events = await collectEvents(deps);

    const types = events.map((e) => e.type);
    expect(types).toEqual(['start', 'text_start', 'text_delta', 'text_delta', 'text_end', 'done']);

    const done = events.at(-1);
    expect(done?.type).toBe('done');
    if (done?.type === 'done') {
      expect(done.reason).toBe('stop');
      expect(done.message.content).toEqual([{ type: 'text', text: 'Hello world.' }]);
      expect(done.message.stopReason).toBe('stop');
    }
    expect(deps.session.updates).toEqual([102]);
  });

  it('maps a streamed XML tool call to toolcall events and stopReason toolUse', async () => {
    adapterMocks.submitPromptStreaming.mockImplementationOnce(async (_input, handlers) => {
      handlers.onTextChunk(TOOL_CALL_TEXT);
      return turnResult();
    });

    const deps = createDeps();
    const events = await collectEvents(deps);

    const types = events.map((e) => e.type);
    expect(types).toEqual(['start', 'toolcall_start', 'toolcall_end', 'done']);

    const done = events.at(-1);
    expect(done?.type).toBe('done');
    if (done?.type === 'done') {
      expect(done.reason).toBe('toolUse');
      expect(done.message.content).toEqual([
        {
          type: 'toolCall',
          id: 'xml:0',
          name: 'artifact_create',
          arguments: { filename: 'a.txt', content: 'ok' },
        },
      ]);
    }
    expect(deps.session.updates).toEqual([102]);
  });

  it('maps interleaved text and tool calls into ordered content blocks', async () => {
    adapterMocks.submitPromptStreaming.mockImplementationOnce(async (_input, handlers) => {
      handlers.onTextChunk('Let me check.');
      handlers.onTextChunk(TOOL_CALL_TEXT);
      handlers.onTextChunk(' Found it.');
      return turnResult();
    });

    const deps = createDeps();
    const events = await collectEvents(deps);

    const done = events.at(-1);
    expect(done?.type).toBe('done');
    if (done?.type === 'done') {
      expect(done.reason).toBe('toolUse');
      const blocks = done.message.content;
      expect(blocks[0]).toEqual({ type: 'text', text: 'Let me check. Found it.' });
      expect(blocks[1]).toMatchObject({ type: 'toolCall', name: 'artifact_create' });
    }
  });

  it('emits exactly one mismatched XML call in a mixed legacy+XML reply (no fallback duplicate)', async () => {
    // Mismatched-close recovery dedupe (review finding): the streaming parser
    // recovers the foreign-closed XML call (toolCallCount = 1), so the
    // ｜DSML｜ fallback leg must run LEGACY-ONLY extraction — a full extraction
    // would re-emit the recovered call, and mapToolCall drops parseError, so
    // the duplicate would carry a best-effort payload and could execute.
    const mixed = [
      '<artifact_create>{"filename":"a.txt"}</invoke>',
      ' Legacy: <｜DSML｜tool_calls>',
      '<｜DSML｜invoke name="artifact_create">',
      '<｜DSML｜parameter name="filename" string="true">legacy.txt</｜DSML｜parameter>',
      '</｜DSML｜invoke></｜DSML｜tool_calls>',
    ].join('');
    adapterMocks.submitPromptStreaming.mockImplementationOnce(async (_input, handlers) => {
      handlers.onTextChunk(mixed);
      return turnResult();
    });

    const events = await collectEvents(createDeps());

    const done = events.at(-1);
    expect(done?.type).toBe('done');
    if (done?.type === 'done') {
      expect(done.reason).toBe('toolUse');
      const toolCalls = done.message.content.filter((block) => block.type === 'toolCall');
      // Exactly two calls: the streaming recovery copy (createIncompleteCall-
      // style empty payload — inert without its required arguments) and the
      // legacy fallback call. No second, payload-bearing duplicate of the
      // mismatched call may be emitted by the fallback.
      expect(toolCalls).toEqual([
        { type: 'toolCall', id: 'xml:0', name: 'artifact_create', arguments: {} },
        { type: 'toolCall', id: 'xml:1', name: 'artifact_create', arguments: { filename: 'legacy.txt' } },
      ]);
    }
  });

  it('keeps full fallback extraction for a pure-legacy reply when no call was streamed', async () => {
    // toolCallCount === 0 branch: the ｜DSML｜ fallback stays a full
    // extractToolCalls run so pure-legacy replies keep parsing.
    const legacyOnly = [
      '<｜DSML｜tool_calls>',
      '<｜DSML｜invoke name="artifact_create">',
      '<｜DSML｜parameter name="filename" string="true">legacy.txt</｜DSML｜parameter>',
      '</｜DSML｜invoke>',
      '</｜DSML｜tool_calls>',
    ].join('');
    adapterMocks.submitPromptStreaming.mockImplementationOnce(async (_input, handlers) => {
      handlers.onTextChunk(legacyOnly);
      return turnResult();
    });

    const events = await collectEvents(createDeps());

    const done = events.at(-1);
    expect(done?.type).toBe('done');
    if (done?.type === 'done') {
      expect(done.reason).toBe('toolUse');
      const toolCalls = done.message.content.filter((block) => block.type === 'toolCall');
      expect(toolCalls).toEqual([
        { type: 'toolCall', id: 'xml:0', name: 'artifact_create', arguments: { filename: 'legacy.txt' } },
      ]);
    }
  });

  it('builds the turn request from session, serializer and turn defaults', async () => {
    adapterMocks.submitPromptStreaming.mockImplementationOnce(async (_input, handlers) => {
      handlers.onTextChunk('ok');
      return turnResult();
    });

    const deps = createDeps({
      turnDefaults: {
        modelType: 'expert',
        refFileIds: ['f1'],
        thinkingEnabled: true,
        searchEnabled: true,
      },
    });
    await collectEvents(deps);

    const request = adapterMocks.submitPromptStreaming.mock.calls[0]?.[0] as DeepSeekTurnRequest;
    expect(request).toMatchObject({
      chatSessionId: 'chat-1',
      parentMessageId: 100,
      modelType: 'expert',
      prompt: 'serialized(0)',
      refFileIds: ['f1'],
      thinkingEnabled: true,
      searchEnabled: true,
    });
    // The submitter enriches the port request with session auth headers.
    expect(request).toHaveProperty('clientHeaders', { Authorization: 'Bearer test-token' });
    expect(request).toHaveProperty('powHeaders', { 'X-DS-PoW-Response': 'pow-1' });
  });

  it('encodes submitter failures as an error event without throwing', async () => {
    vi.useFakeTimers();
    adapterMocks.submitPromptStreaming.mockRejectedValue(new Error('network down'));

    const deps = createDeps();
    const streamFn = createDeepSeekStreamFn(deps);
    const stream = await streamFn(TEST_MODEL, EMPTY_CONTEXT, {});
    const events: AssistantMessageEvent[] = [];
    const drain = (async () => {
      for await (const event of stream) events.push(event);
    })();
    await vi.advanceTimersByTimeAsync(7_000);
    await drain;

    // Both attempts fail with the same error; the second attempt surfaces it.
    expect(adapterMocks.submitPromptStreaming).toHaveBeenCalledTimes(2);
    const last = events.at(-1);
    expect(last?.type).toBe('error');
    if (last?.type === 'error') {
      expect(last.reason).toBe('error');
      expect(last.error.stopReason).toBe('error');
      expect(last.error.errorMessage).toBe('network down');
    }
    expect(deps.session.updates).toEqual([]);
  });

  it('encodes user abort as an aborted error event', async () => {
    const controller = new AbortController();
    adapterMocks.submitPromptStreaming.mockImplementation((_input, _handlers, signal) =>
      new Promise((_resolve, reject) => {
        // The real request policy rejects an already-aborted caller signal
        // instead of waiting for an abort event that can no longer fire.
        if (signal?.aborted) {
          reject(signal.reason);
          return;
        }
        signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
      }),
    );

    const deps = createDeps();
    const streamFn = createDeepSeekStreamFn(deps);
    const stream = await streamFn(TEST_MODEL, EMPTY_CONTEXT, { signal: controller.signal });
    const events: AssistantMessageEvent[] = [];
    const drain = (async () => {
      for await (const event of stream) events.push(event);
    })();
    controller.abort();
    await drain;

    const last = events.at(-1);
    expect(last?.type).toBe('error');
    if (last?.type === 'error') {
      expect(last.reason).toBe('aborted');
      expect(last.error.stopReason).toBe('aborted');
    }
  });

  it('retries once when the turn failed before any chunk was received', async () => {
    vi.useFakeTimers();
    adapterMocks.submitPromptStreaming
      .mockRejectedValueOnce(new Error('transient'))
      .mockImplementationOnce(async (_input, handlers) => {
        handlers.onTextChunk('recovered');
        return turnResult();
      });

    const deps = createDeps();
    const streamFn = createDeepSeekStreamFn(deps);
    const stream = await streamFn(TEST_MODEL, EMPTY_CONTEXT, {});
    const events: AssistantMessageEvent[] = [];
    const drain = (async () => {
      for await (const event of stream) events.push(event);
    })();
    await vi.advanceTimersByTimeAsync(7_000);
    await drain;

    expect(adapterMocks.submitPromptStreaming).toHaveBeenCalledTimes(2);
    expect(events.some((e) => e.type === 'error')).toBe(false);
    expect(events.at(-1)?.type).toBe('done');
  });

  it('does not retry a timed-out step after text was already received', async () => {
    vi.useFakeTimers();
    adapterMocks.submitPromptStreaming.mockImplementation((_input, handlers, signal) => {
      handlers.onTextChunk('partial...');
      return new Promise((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
    });

    const deps = createDeps();
    const streamFn = createDeepSeekStreamFn(deps);
    const stream = await streamFn(TEST_MODEL, EMPTY_CONTEXT, {});
    const events: AssistantMessageEvent[] = [];
    const drain = (async () => {
      for await (const event of stream) events.push(event);
    })();
    await vi.advanceTimersByTimeAsync(120_000);
    await drain;

    expect(adapterMocks.submitPromptStreaming).toHaveBeenCalledTimes(1);
    const last = events.at(-1);
    expect(last?.type).toBe('error');
    if (last?.type === 'error') {
      expect(last.error.errorMessage).toBe(
        'DeepSeek agent step timed out while streaming; the response was interrupted.',
      );
      expect(last.error.content).toEqual([{ type: 'text', text: 'partial...' }]);
    }
  });

  it('does not retry a timed-out step after reasoning was already received', async () => {
    // A reasoning-only turn (THINK deltas, no answer text yet) is still
    // streamed content: timing out must surface the interrupted-streaming
    // error instead of resubmitting with the same parent_message_id and
    // forking a response the server may have already committed.
    vi.useFakeTimers();
    adapterMocks.submitPromptStreaming.mockImplementation((_input, handlers, signal) => {
      handlers.onReasoningChunk?.('我先分析', '我先分析');
      return new Promise((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
    });

    const deps = createDeps();
    const streamFn = createDeepSeekStreamFn(deps);
    const stream = await streamFn(TEST_MODEL, EMPTY_CONTEXT, {});
    const events: AssistantMessageEvent[] = [];
    const drain = (async () => {
      for await (const event of stream) events.push(event);
    })();
    await vi.advanceTimersByTimeAsync(120_000);
    await drain;

    expect(adapterMocks.submitPromptStreaming).toHaveBeenCalledTimes(1);
    const last = events.at(-1);
    expect(last?.type).toBe('error');
    if (last?.type === 'error') {
      expect(last.error.errorMessage).toBe(
        'DeepSeek agent step timed out while streaming; the response was interrupted.',
      );
    }
  });

  it('never resubmits after a mid-stream network reset following text chunks', async () => {
    // A non-timeout failure after streamed content is still a committed
    // server-side turn: resubmitting with the same parent_message_id could
    // fork the chain, so the reset surfaces as the interrupted-stream error.
    adapterMocks.submitPromptStreaming.mockImplementation(async (_input, handlers) => {
      handlers.onTextChunk('partial ');
      handlers.onTextChunk('text');
      throw new TypeError('network error: load failed');
    });

    const deps = createDeps();
    const events = await collectEvents(deps);

    expect(adapterMocks.submitPromptStreaming).toHaveBeenCalledTimes(1);
    const last = events.at(-1);
    expect(last?.type).toBe('error');
    if (last?.type === 'error') {
      expect(last.error.errorMessage).toBe(DEEPSEEK_INTERRUPTED_ENDED_MESSAGE);
    }
    expect(deps.session.updates).toEqual([]);
  });

  it('never resubmits after a mid-stream network reset following reasoning-only chunks', async () => {
    adapterMocks.submitPromptStreaming.mockImplementation(async (_input, handlers) => {
      handlers.onReasoningChunk?.('我先分析', '我先分析');
      throw new TypeError('network error: load failed');
    });

    const deps = createDeps();
    const events = await collectEvents(deps);

    expect(adapterMocks.submitPromptStreaming).toHaveBeenCalledTimes(1);
    const last = events.at(-1);
    expect(last?.type).toBe('error');
    if (last?.type === 'error') {
      expect(last.error.errorMessage).toBe(DEEPSEEK_INTERRUPTED_ENDED_MESSAGE);
    }
  });

  it('forwards token speed progress through the optional dep callback', async () => {
    const progress = { modelType: 'default', tokenSpeed: 42 };
    adapterMocks.submitPromptStreaming.mockImplementationOnce(async (_input, handlers) => {
      handlers.onTokenSpeed?.(progress);
      handlers.onTextChunk('ok');
      return turnResult();
    });

    const onTokenSpeed = vi.fn();
    const deps = createDeps({ onTokenSpeed });
    await collectEvents(deps);

    expect(onTokenSpeed).toHaveBeenCalledWith(progress);
  });

  it('retries PoW once when the first solve fails, then submits the turn', async () => {
    vi.useFakeTimers();
    adapterMocks.createPowHeaders
      .mockRejectedValueOnce(new Error('pow transient'))
      .mockResolvedValueOnce({ 'X-DS-PoW-Response': 'pow-2' });
    adapterMocks.submitPromptStreaming.mockImplementationOnce(async (_input, handlers) => {
      handlers.onTextChunk('recovered');
      return turnResult();
    });

    const deps = createDeps();
    const streamFn = createDeepSeekStreamFn(deps);
    const stream = await streamFn(TEST_MODEL, EMPTY_CONTEXT, {});
    const events: AssistantMessageEvent[] = [];
    const drain = (async () => {
      for await (const event of stream) events.push(event);
    })();
    await vi.advanceTimersByTimeAsync(7_000);
    await drain;

    expect(adapterMocks.createPowHeaders).toHaveBeenCalledTimes(2);
    // Both PoW attempts run on the same forwarded turn signal.
    expect(adapterMocks.createPowHeaders.mock.calls[0][2])
      .toBe(adapterMocks.createPowHeaders.mock.calls[1][2]);
    expect(adapterMocks.submitPromptStreaming).toHaveBeenCalledTimes(1);
    expect(events.some((e) => e.type === 'error')).toBe(false);
    expect(events.at(-1)?.type).toBe('done');
  });

  it('does not retry PoW after an auth rejection', async () => {
    adapterMocks.createPowHeaders.mockRejectedValue(
      new DeepSeekAuthError('DeepSeek auth token was rejected (HTTP 401) while creating PoW challenge.'),
    );

    const deps = createDeps();
    const events = await collectEvents(deps);

    expect(adapterMocks.createPowHeaders).toHaveBeenCalledTimes(1);
    expect(adapterMocks.submitPromptStreaming).not.toHaveBeenCalled();
    const last = events.at(-1);
    expect(last?.type).toBe('error');
    if (last?.type === 'error') {
      expect(last.error.errorMessage).toBe(
        'DeepSeek auth token was rejected (HTTP 401) while creating PoW challenge.',
      );
    }
  });

  it('forwards the turn signal so an abort during PoW fails without retry', async () => {
    const controller = new AbortController();
    adapterMocks.createPowHeaders.mockImplementation((_headers, _url, signal) =>
      new Promise((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
      }),
    );

    const deps = createDeps();
    const streamFn = createDeepSeekStreamFn(deps);
    const stream = await streamFn(TEST_MODEL, EMPTY_CONTEXT, { signal: controller.signal });
    const events: AssistantMessageEvent[] = [];
    const drain = (async () => {
      for await (const event of stream) events.push(event);
    })();
    controller.abort(new DOMException('user cancelled', 'AbortError'));
    await drain;

    expect(adapterMocks.createPowHeaders).toHaveBeenCalledTimes(1);
    expect(adapterMocks.submitPromptStreaming).not.toHaveBeenCalled();
    const last = events.at(-1);
    expect(last?.type).toBe('error');
    if (last?.type === 'error') expect(last.reason).toBe('aborted');
  });
});

describe('isDeepSeekInterruptedTurnError', () => {
  it('classifies interrupted-turn and PoW-phase failure messages', () => {
    expect(isDeepSeekInterruptedTurnError(DEEPSEEK_INTERRUPTED_TIMEOUT_MESSAGE)).toBe(true);
    expect(isDeepSeekInterruptedTurnError(DEEPSEEK_INTERRUPTED_ENDED_MESSAGE)).toBe(true);
    // PoW deadline: NetworkPolicyError('network_deadline_exceeded') message.
    expect(
      isDeepSeekInterruptedTurnError('DeepSeek PoW challenge exceeded its execution deadline.'),
    ).toBe(true);
    // DeepSeekPowError shapes (solve failure wraps the WASM/timeout text,
    // non-JSON response, and server-rejected challenge creation).
    expect(
      isDeepSeekInterruptedTurnError('DeepSeek PoW challenge failed: Request exceeded 15000 ms.'),
    ).toBe(true);
    expect(
      isDeepSeekInterruptedTurnError('DeepSeek PoW challenge returned non-JSON HTTP 502: Bad Gateway'),
    ).toBe(true);
    expect(
      isDeepSeekInterruptedTurnError('Failed to create DeepSeek PoW challenge: {"biz_code":555}'),
    ).toBe(true);
    // Not interrupted turns: unrelated failures, auth rejections (need
    // re-authentication, not resume) and the no-chunk timeout-after-retry.
    expect(isDeepSeekInterruptedTurnError('network down')).toBe(false);
    expect(
      isDeepSeekInterruptedTurnError('DeepSeek auth token was rejected (HTTP 401) while creating PoW challenge.'),
    ).toBe(false);
    expect(isDeepSeekInterruptedTurnError('DeepSeek agent step timed out after retry.')).toBe(false);
  });
});
