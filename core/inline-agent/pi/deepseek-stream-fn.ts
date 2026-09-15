/**
 * DeepSeek-web StreamFn adapter (Issue A1-T2).
 *
 * Wraps the DeepSeek web session as a pi `StreamFn` model backend:
 *
 *  - `createDeepSeekTurnSubmitter` — thin adapter over `submitPromptStreaming`
 *    that mirrors the original loop's turn semantics exactly: client headers +
 *    PoW headers created once per turn, a bounded single retry that is only
 *    allowed when no text chunk was received (retrying after streamed content
 *    could fork the conversation chain), and the 120s step timeout. The
 *    original loop's implementation is replaced by this module in Issue A3;
 *    until then the two copies share the extracted `step-control` helpers.
 *
 *  - `createDeepSeekStreamFn` — maps the DS-web text/tool-call stream into pi
 *    `AssistantMessageEventStream` protocol events. Never throws: request,
 *    model and runtime failures are encoded as protocol `error` events with a
 *    final AssistantMessage carrying stopReason "error"/"aborted"
 *    (StreamFn contract).
 *
 * The DS-web conversation chain stays the authority: `parentMessageId` is
 * read from and written back to the injected session state (never derived
 * from the pi context) — fail-closed against chain forks (risk (g)).
 */
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai';
import type {
  Api,
  AssistantMessage,
  AssistantMessageEvent,
  Model,
  ToolCall,
  Usage,
} from '@earendil-works/pi-ai';
import type { StreamFn } from '@earendil-works/pi-agent-core';
import {
  createClientHeaders,
  createPowHeaders,
  submitPromptStreaming,
  type ModelTurn,
  type SubmitPromptInput,
} from '../../deepseek/adapter';
import { extractLegacyToolCalls, extractToolCalls } from '../../interceptor/tool-parser';
import { createStreamingToolCallParser } from '../../interceptor/streaming-tool-call-parser';
import { createStreamingToolTextAccumulator } from '../../interceptor/streaming-tool-text';
import type { ToolCall as CoreToolCall } from '../../types';
import { createStepSignal, waitBetweenDeepSeekRequests } from '../step-control';
import { DeepSeekAuthError } from '../../deepseek/errors';
import type {
  DeepSeekStreamFnDeps,
  DeepSeekTurnCallbacks,
  DeepSeekTurnRequest,
  DeepSeekTurnResult,
  DeepSeekTurnSubmitter,
  ParsedXmlToolCall,
} from './stream-fn-port';

const INLINE_AGENT_MAX_STEP_ATTEMPTS = 2;
const INLINE_AGENT_POW_ATTEMPTS = 2;

/**
 * User-visible texts for an interrupted turn. Byte-stable contract: the
 * auto-resume machinery classifies interrupted turns by matching these exact
 * messages (see {@link isDeepSeekInterruptedTurnError}).
 */
export const DEEPSEEK_INTERRUPTED_TIMEOUT_MESSAGE =
  'DeepSeek agent step timed out while streaming; the response was interrupted.';
export const DEEPSEEK_INTERRUPTED_ENDED_MESSAGE =
  'DeepSeek response stream ended before completion (the response was interrupted).';

/**
 * Machine-readable classifier for "this turn was interrupted": the streamed
 * response never completed, so the next turn must resume from the session
 * chain instead of assuming a finished reply. Matches the two interrupted
 * messages above plus any PoW-phase failure text (a PoW failure means the
 * turn was never submitted, so the response was interrupted before it
 * started). Verified PoW-phase shapes:
 *  - `NetworkPolicyError('network_deadline_exceeded')` for the PoW operation:
 *    "DeepSeek PoW challenge exceeded its execution deadline."
 *  - `DeepSeekPowError`: "DeepSeek PoW challenge failed: …",
 *    "DeepSeek PoW challenge returned non-JSON HTTP …",
 *    "Failed to create DeepSeek PoW challenge: …".
 * Auth rejections are deliberately excluded (they need re-authentication,
 * not resume).
 */
export function isDeepSeekInterruptedTurnError(message: string): boolean {
  return message === DEEPSEEK_INTERRUPTED_TIMEOUT_MESSAGE
    || message === DEEPSEEK_INTERRUPTED_ENDED_MESSAGE
    || message.startsWith('DeepSeek PoW challenge')
    || message.startsWith('Failed to create DeepSeek PoW challenge');
}

export interface DeepSeekTurnSubmitterOptions {
  powWasmUrl?: string;
}

/**
 * Builds the turn submitter: one turn = one bounded PoW solve + bounded
 * no-chunk retry + 120s step timeout, mirroring the original `submitAgentTurn`.
 */
export function createDeepSeekTurnSubmitter(
  options: DeepSeekTurnSubmitterOptions = {},
): DeepSeekTurnSubmitter {
  const { powWasmUrl } = options;

  return async (request, callbacks, signal) => {
    const clientHeaders = createClientHeaders();
    const powHeaders = await createPowHeadersWithRetry(clientHeaders, powWasmUrl, signal);
    const input: SubmitPromptInput = {
      chatSessionId: request.chatSessionId,
      parentMessageId: request.parentMessageId,
      modelType: request.modelType,
      prompt: request.prompt,
      refFileIds: request.refFileIds,
      thinkingEnabled: request.thinkingEnabled,
      searchEnabled: request.searchEnabled,
      clientHeaders,
      powHeaders,
    };
    return submitWithRetry(input, callbacks, signal);
  };
}

/**
 * Builds the pi StreamFn over the DS-web backend. The returned function never
 * rejects; failures are encoded as protocol events.
 */
export function createDeepSeekStreamFn(deps: DeepSeekStreamFnDeps): StreamFn {
  const { submitTurn, session, serializePrompt, mapToolCall, toolDescriptors, turnDefaults } = deps;

  return (model, context, options) => {
    const stream = createAssistantMessageEventStream();
    const signal = options?.signal;

    const partial = createEmptyAssistantMessage(model);
    const emit = (event: AssistantMessageEvent) => stream.push(event);
    const snapshot = () => ({ ...partial, content: [...partial.content] });

    emit({ type: 'start', partial: snapshot() });

    void (async () => {
      try {
        const request: DeepSeekTurnRequest = {
          chatSessionId: session.chatSessionId,
          parentMessageId: session.parentMessageId,
          modelType: turnDefaults.modelType ?? model.id ?? null,
          prompt: serializePrompt(context),
          refFileIds: turnDefaults.refFileIds,
          thinkingEnabled: turnDefaults.thinkingEnabled,
          searchEnabled: turnDefaults.searchEnabled,
        };

        const textAccumulator = createStreamingToolTextAccumulator(toolDescriptors);
        const toolCallParser = createStreamingToolCallParser(toolDescriptors);
        let lastVisibleText = '';
        let textContentIndex: number | null = null;
        let thinkingContentIndex: number | null = null;
        let lastThinkingText = '';
        let toolCallCount = 0;
        // Raw (un-stripped) stream text for the released fallback parse:
        // legacy DSML blocks are invisible to the streaming XML parser and are
        // only recovered at flush time.
        let fallbackRawText = '';
        let fallbackRawTruncated = false;
        const FALLBACK_PARSE_MAX_CHARS = 120_000;

        const emitText = (fullText: string) => {
          const delta = fullText.slice(lastVisibleText.length);
          lastVisibleText = fullText;
          if (!delta) return;
          if (textContentIndex === null) {
            textContentIndex = partial.content.length;
            partial.content.push({ type: 'text', text: fullText });
            emit({ type: 'text_start', contentIndex: textContentIndex, partial: snapshot() });
          } else {
            partial.content[textContentIndex] = { type: 'text', text: fullText };
          }
          emit({ type: 'text_delta', contentIndex: textContentIndex, delta, partial: snapshot() });
        };

        const emitToolCall = (parsed: ParsedXmlToolCall) => {
          const toolCall = mapToolCall(parsed, toolCallCount);
          toolCallCount += 1;
          const contentIndex = partial.content.length;
          partial.content.push({ type: 'toolCall', id: toolCall.id, name: toolCall.name, arguments: {} });
          emit({ type: 'toolcall_start', contentIndex, partial: snapshot() });
          partial.content[contentIndex] = toolCall;
          emit({ type: 'toolcall_end', contentIndex, toolCall, partial: snapshot() });
        };

        const emitThinking = (fullText: string) => {
          const delta = fullText.slice(lastThinkingText.length);
          lastThinkingText = fullText;
          if (!delta) return;
          if (thinkingContentIndex === null) {
            thinkingContentIndex = partial.content.length;
            partial.content.push({ type: 'thinking', thinking: fullText });
            emit({ type: 'thinking_start', contentIndex: thinkingContentIndex, partial: snapshot() });
          } else {
            partial.content[thinkingContentIndex] = { type: 'thinking', thinking: fullText };
          }
          emit({ type: 'thinking_delta', contentIndex: thinkingContentIndex, delta, partial: snapshot() });
        };

        const onParsed = (parsed: { completed: CoreToolCall[]; failed: CoreToolCall[] }) => {
          for (const call of parsed.completed) {
            emitToolCall({ name: call.name, invocationName: call.invocationName ?? call.name, payload: call.payload });
          }
          for (const call of parsed.failed) {
            emitToolCall({ name: call.name, invocationName: call.invocationName ?? call.name, payload: call.payload });
          }
        };

        const callbacks: DeepSeekTurnCallbacks = {
          onTextChunk(text) {
            if (!fallbackRawTruncated) {
              if (fallbackRawText.length + text.length > FALLBACK_PARSE_MAX_CHARS) {
                fallbackRawTruncated = true;
                fallbackRawText = '';
              } else {
                fallbackRawText += text;
              }
            }
            emitText(textAccumulator.append(text));
            onParsed(toolCallParser.append(text));
          },
          onReasoningChunk(reasoning, fullReasoning) {
            emitThinking(fullReasoning);
          },
          onTokenSpeed(progress) {
            deps.onTokenSpeed?.(progress);
          },
        };

        const result = await submitTurn(request, callbacks, signal);

        // Fail-closed stream termination (Issue: mid-output silent stop): a
        // DeepSeek web stream is only complete once the server patches
        // FINISHED onto the response. When the stream ends without it (the
        // connection dropped or the server interrupted the response), the
        // partial text must NEVER be presented as a finished turn — surface
        // it as a visible error so the loop reports AGENT_LOOP_ERROR instead
        // of stopping on a seemingly normal message. User aborts keep their
        // silent 'aborted' semantics.
        if (!result.finished && !signal?.aborted) {
          throw new Error(DEEPSEEK_INTERRUPTED_ENDED_MESSAGE);
        }

        // The conversation chain authority: the page session, not this turn's
        // transcript, owns the next parent message id.
        session.setParentMessageId(result.responseMessageId);

        onParsed(toolCallParser.flush());
        emitText(textAccumulator.flush());
        // Dedupe invariant (mismatched-close recovery), scoped per branch:
        // - toolCallCount === 0: the streaming parser emitted nothing, so the
        //   fallback runs FULL extraction (pure-legacy and XML-only replies
        //   must still parse).
        // - toolCallCount > 0: the streaming parser already emitted every XML
        //   call it could recover (completed or failed), so the fallback is
        //   restricted to LEGACY ｜DSML｜ blocks only. Full extraction here
        //   would re-emit an XML call the streaming parser already produced,
        //   and mapToolCall drops parseError, so the duplicate copy would
        //   carry the batch best-effort payload and could execute.
        if (!fallbackRawTruncated && fallbackRawText) {
          const shouldFallback = fallbackRawText.includes('｜DSML｜')
            || (toolCallCount === 0 && fallbackRawText.includes('<'));
          if (shouldFallback) {
            const fallbackCalls = toolCallCount === 0
              ? extractToolCalls(fallbackRawText, { descriptors: toolDescriptors })
              : extractLegacyToolCalls(fallbackRawText, { descriptors: toolDescriptors });
            for (const call of fallbackCalls) {
              emitToolCall({ name: call.name, invocationName: call.invocationName ?? call.name, payload: call.payload });
            }
          }
        }
        if (textContentIndex !== null) {
          emit({
            type: 'text_end',
            contentIndex: textContentIndex,
            content: lastVisibleText,
            partial: snapshot(),
          });
        }
        if (thinkingContentIndex !== null) {
          emit({
            type: 'thinking_end',
            contentIndex: thinkingContentIndex,
            content: lastThinkingText,
            partial: snapshot(),
          });
        }

        partial.stopReason = partial.content.some((block) => block.type === 'toolCall') ? 'toolUse' : 'stop';
        emit({ type: 'done', reason: partial.stopReason, message: snapshot() });
      } catch (err) {
        const aborted = signal?.aborted ?? false;
        partial.stopReason = aborted ? 'aborted' : 'error';
        partial.errorMessage = aborted ? 'Aborted' : (err instanceof Error ? err.message : String(err));
        emit({ type: 'error', reason: partial.stopReason, error: snapshot() });
      }
    })();

    return stream;
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Solves PoW for one turn with a bounded retry. The turn signal is forwarded
 * into every attempt so a user abort cancels a pending solve immediately, and
 * transient PoW/network failures get one throttled retry; auth rejections are
 * never retried (the token must be refreshed first). The final failure is
 * rethrown unchanged — the loop layer classifies it.
 */
async function createPowHeadersWithRetry(
  clientHeaders: Record<string, string>,
  powWasmUrl: string | undefined,
  parentSignal: AbortSignal | undefined,
): Promise<Record<string, string>> {
  const signal = parentSignal ?? new AbortController().signal;
  for (let attempt = 1; attempt <= INLINE_AGENT_POW_ATTEMPTS; attempt++) {
    try {
      return await createPowHeaders(clientHeaders, powWasmUrl, signal);
    } catch (err) {
      if (signal.aborted || err instanceof DeepSeekAuthError) throw err;
      if (attempt >= INLINE_AGENT_POW_ATTEMPTS) throw err;
      await waitBetweenDeepSeekRequests(signal);
      if (signal.aborted) throw err;
    }
  }
  throw new Error('DeepSeek PoW retry loop exited without a completed attempt.');
}

/**
 * Submits one turn with a bounded single retry. A retry is only allowed when
 * the request failed before any chunk was received (text or reasoning): once
 * the server has streamed content the turn is likely committed server-side,
 * and replaying it with the same parent message could fork the conversation
 * chain — such interrupted turns surface as
 * {@link DEEPSEEK_INTERRUPTED_TIMEOUT_MESSAGE} /
 * {@link DEEPSEEK_INTERRUPTED_ENDED_MESSAGE} instead of being retried. User
 * abort is never retried. Mirrors the original loop's `submitAgentTurn`.
 */
async function submitWithRetry(
  input: SubmitPromptInput,
  callbacks: DeepSeekTurnCallbacks,
  parentSignal: AbortSignal | undefined,
): Promise<DeepSeekTurnResult> {
  const signal = parentSignal ?? new AbortController().signal;
  let receivedAnyChunk = false;

  for (let attempt = 1; attempt <= INLINE_AGENT_MAX_STEP_ATTEMPTS; attempt++) {
    const stepTimeout = createStepSignal(signal);
    try {
      const turn: ModelTurn = await submitPromptStreaming(input, {
        retainAssistantText: false,
        onTextChunk(text, fullText) {
          receivedAnyChunk = true;
          callbacks.onTextChunk(text, fullText);
        },
        onReasoningChunk(reasoning, fullReasoning) {
          // Reasoning deltas are streamed content too: a turn that only
          // streamed thinking before timing out must NOT be resubmitted with
          // the same parent_message_id (the server may have already committed
          // the response, forking the conversation chain).
          receivedAnyChunk = true;
          callbacks.onReasoningChunk?.(reasoning, fullReasoning);
        },
        onTokenSpeed: callbacks.onTokenSpeed,
      }, stepTimeout.signal);
      return {
        assistantText: turn.assistantText,
        responseMessageId: turn.responseMessageId,
        requestMessageId: turn.requestMessageId,
        finished: turn.finished,
      };
    } catch (err) {
      if (signal.aborted) throw err;
      const timeoutFired = stepTimeout.timedOut();
      // Any received chunk means the turn was likely committed server-side:
      // resubmitting with the same parent_message_id could fork the
      // conversation chain, so the interrupted turn is surfaced as an error
      // no matter what failed (RC2/M3). No-chunk failures keep their bounded
      // retry below.
      if (receivedAnyChunk) {
        throw new Error(timeoutFired ? DEEPSEEK_INTERRUPTED_TIMEOUT_MESSAGE : DEEPSEEK_INTERRUPTED_ENDED_MESSAGE);
      }
      if (attempt >= INLINE_AGENT_MAX_STEP_ATTEMPTS) {
        if (timeoutFired) throw new Error('DeepSeek agent step timed out after retry.');
        throw err;
      }
      await waitBetweenDeepSeekRequests(signal);
      if (signal.aborted) throw err;
    } finally {
      stepTimeout.clear();
    }
  }
  throw new Error('DeepSeek agent step failed without a completed attempt.');
}

function createEmptyAssistantMessage(model: Model<Api>): AssistantMessage {
  const emptyUsage: Usage = {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
  return {
    role: 'assistant',
    content: [],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: emptyUsage,
    stopReason: 'stop',
    timestamp: Date.now(),
  };
}
