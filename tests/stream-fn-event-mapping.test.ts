/**
 * DS-web stream → pi AssistantMessageEventStream mapping contract (A1-T3).
 *
 * Documented mapping table (the adapter's behavior is exercised in
 * tests/stream-fn-adapter.test.ts; this file locks the protocol-level
 * invariants the pi loop relies on):
 *
 * | DS-web stream state                          | pi event emitted                          |
 * |----------------------------------------------|-------------------------------------------|
 * | turn begins                                  | `start` (empty partial)                   |
 * | first visible text chunk                     | `text_start` (text block appended)        |
 * | subsequent visible text chunk                | `text_delta` (delta = new - old)          |
 * | turn ends with visible text                  | `text_end`                                |
 * | completed XML tool call in stream            | `toolcall_start` + `toolcall_end`         |
 * | turn succeeded, tool calls present           | `done` reason `toolUse`                   |
 * | turn succeeded, no tool calls                | `done` reason `stop`                      |
 * | submitter failure (non-abort)                | `error` reason `error`, errorMessage set  |
 * | abort during turn                            | `error` reason `aborted`, stopReason abort |
 *
 * Protocol invariants asserted here:
 *  1. Every stream starts with `start` and terminates with `done` or `error`.
 *  2. `partial` snapshots are self-consistent: text blocks are cumulative,
 *     tool-call blocks are append-only, content order is stable.
 *  3. `done` carries the complete final message; `error` carries errorMessage
 *     and the partial content streamed before the failure.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AssistantMessageEvent, Context } from '@earendil-works/pi-ai';
import { createArtifactToolDescriptors } from '../core/artifact';
import type { ToolDescriptor } from '../core/types';
import type { DeepSeekStreamFnDeps } from '../core/inline-agent/pi/stream-fn-port';

const adapterMocks = vi.hoisted(() => ({
  createPowHeaders: vi.fn(),
  submitPromptStreaming: vi.fn(),
}));

vi.mock('../core/deepseek/adapter', () => ({
  createClientHeaders: () => ({ Authorization: 'Bearer test-token' }),
  createPowHeaders: adapterMocks.createPowHeaders,
  submitPromptStreaming: adapterMocks.submitPromptStreaming,
}));

const { createDeepSeekStreamFn, createDeepSeekTurnSubmitter } = await import(
  '../core/inline-agent/pi/deepseek-stream-fn'
);

const TOOL_CALL_TEXT = '<artifact_create>{"filename":"a.txt","content":"ok"}</artifact_create>';

const TEST_MODEL = {
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

function createDeps(): DeepSeekStreamFnDeps {
  return {
    submitTurn: createDeepSeekTurnSubmitter({}),
    session: {
      chatSessionId: 'chat-1',
      parentMessageId: 100,
      setParentMessageId: vi.fn(),
    },
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
  };
}

async function runScenario(): Promise<AssistantMessageEvent[]> {
  const deps = createDeps();
  const streamFn = createDeepSeekStreamFn(deps);
  const stream = await streamFn(TEST_MODEL, { messages: [] }, {});
  const events: AssistantMessageEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

describe('DS-web → pi event mapping protocol', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    adapterMocks.createPowHeaders.mockResolvedValue({ 'X-DS-PoW-Response': 'pow-1' });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('text-only turn: start → text events → done(stop), partial cumulative', async () => {
    adapterMocks.submitPromptStreaming.mockImplementationOnce(async (_input, handlers) => {
      handlers.onTextChunk('Hello ');
      handlers.onTextChunk('world.');
      return { assistantText: '', responseMessageId: 102, requestMessageId: 101, finished: true };
    });

    const events = await runScenario();
    expect(events[0]?.type).toBe('start');
    expect(events.at(-1)?.type).toBe('done');

    const deltas = events.filter((e) => e.type === 'text_delta');
    expect(deltas.map((e) => (e.type === 'text_delta' ? e.delta : ''))).toEqual(['Hello ', 'world.']);

    // Partial snapshots are cumulative.
    const textBlocks = events
      .filter((e) => e.type === 'text_delta' && e.type === 'text_delta')
      .map((e) => (e as { partial: { content: Array<{ text?: string }> } }).partial.content[0]?.text);
    expect(textBlocks).toEqual(['Hello ', 'Hello world.']);

    const done = events.at(-1);
    if (done?.type === 'done') {
      expect(done.reason).toBe('stop');
      expect(done.message.content).toEqual([{ type: 'text', text: 'Hello world.' }]);
    }
  });

  it('tool turn: start → toolcall events → done(toolUse), tool blocks append-only', async () => {
    adapterMocks.submitPromptStreaming.mockImplementationOnce(async (_input, handlers) => {
      handlers.onTextChunk(TOOL_CALL_TEXT);
      handlers.onTextChunk(TOOL_CALL_TEXT.replace('a.txt', 'b.txt'));
      return { assistantText: '', responseMessageId: 102, requestMessageId: 101, finished: true };
    });

    const events = await runScenario();
    expect(events[0]?.type).toBe('start');
    expect(events.at(-1)?.type).toBe('done');

    const toolCallEnds = events.filter((e) => e.type === 'toolcall_end');
    expect(toolCallEnds).toHaveLength(2);
    if (toolCallEnds[0]?.type === 'toolcall_end') {
      expect(toolCallEnds[0].toolCall.arguments).toEqual({ filename: 'a.txt', content: 'ok' });
    }
    if (toolCallEnds[1]?.type === 'toolcall_end') {
      expect(toolCallEnds[1].toolCall.arguments).toEqual({ filename: 'b.txt', content: 'ok' });
    }

    const done = events.at(-1);
    if (done?.type === 'done') {
      expect(done.reason).toBe('toolUse');
      expect(done.message.content.filter((b) => b.type === 'toolCall')).toHaveLength(2);
    }
  });

  it('failure turn: start → error, errorMessage set, no done event', async () => {
    vi.useFakeTimers();
    adapterMocks.submitPromptStreaming.mockRejectedValue(new Error('boom'));

    const deps = createDeps();
    const streamFn = createDeepSeekStreamFn(deps);
    const stream = await streamFn(TEST_MODEL, { messages: [] }, {});
    const events: AssistantMessageEvent[] = [];
    const drain = (async () => {
      for await (const event of stream) events.push(event);
    })();
    await vi.advanceTimersByTimeAsync(7_000);
    await drain;

    expect(events[0]?.type).toBe('start');
    expect(events.some((e) => e.type === 'done')).toBe(false);
    const last = events.at(-1);
    expect(last?.type).toBe('error');
    if (last?.type === 'error') {
      expect(last.reason).toBe('error');
      expect(last.error.errorMessage).toBe('boom');
      expect(last.error.stopReason).toBe('error');
    }
  });

  it('aborted turn: start → error(aborted) with streamed content preserved', async () => {
    const controller = new AbortController();
    adapterMocks.submitPromptStreaming.mockImplementation((_input, handlers, signal) => {
      handlers.onTextChunk('partial answer');
      return new Promise((_resolve, reject) => {
        // The real request policy rejects an already-aborted caller signal
        // instead of waiting for an abort event that can no longer fire.
        if (signal?.aborted) {
          reject(signal.reason);
          return;
        }
        signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
    });

    const deps = createDeps();
    const streamFn = createDeepSeekStreamFn(deps);
    const stream = await streamFn(TEST_MODEL, { messages: [] }, { signal: controller.signal });
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
      expect(last.error.content).toEqual([{ type: 'text', text: 'partial answer' }]);
    }
  });
});
