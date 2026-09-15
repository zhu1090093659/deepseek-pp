/**
 * pi-agent-core loop adapter (Issue A3-T1, B2-T5 dual backend).
 *
 * Drives the pi `runAgentLoop` over the selected model backend's StreamFn
 * and tool bridge, translating pi AgentEvents into the released AGENT_*
 * page protocol (locked by `tests/inline-agent-event-protocol-golden.test.ts`):
 *
 *  - one model request = one pi turn; a "step" = a request plus at most one
 *    nudge request (the released nudge semantics);
 *  - text deltas → AGENT_STREAM_CHUNK (12k clamp), tool execution start →
 *    AGENT_TOOL_DETECTED, step end → AGENT_STEP_COMPLETE, run end →
 *    AGENT_LOOP_COMPLETE / AGENT_LOOP_ERROR, abort → silent complete;
 *  - chain authority depends on the backend (B2):
 *      * `web` (default, released): the DS page conversation chain —
 *        `parentMessageId` lives in session state, tool calls without a
 *        continuable chain are blocked (beforeToolCall) and surfaced as an
 *        error, matching the original loop;
 *      * `official-api`: no page chain exists — the pi Context transcript
 *        IS the chain, so fail-closed checks verify the Context carries a
 *        valid assistant message before tools run.
 *
 * The released wire prompt contract (`<original_task>`/`<tool_results>`/
 * `<task_complete>`/nudge prompts) is preserved on the web path via
 * `buildContinuationPrompt` / `buildNudgePrompt` — pi's own prompt templates
 * are never used. The official-API path sends the pi Context as
 * OpenAI-compatible messages (mapMessages), which is the backend's native
 * shape; no page-injection template is involved either way.
 */
import type { Api, AssistantMessage, Model, Message, ToolResultMessage } from '@earendil-works/pi-ai';
import type { AgentMessage } from '@earendil-works/pi-agent-core';
import type { StreamFn, AgentEvent, AgentLoopConfig } from '@earendil-works/pi-agent-core';
import { runAgentLoop } from '@earendil-works/pi-agent-core';
import { DEFAULT_LOCALE, translate, type SupportedLocale } from '../../i18n';
import type { ToolCall, ToolDescriptor, ToolExecutionRecord, ToolProviderIdentity } from '../../types';
import { createClientHeaders } from '../../deepseek/adapter';
import { getDeepSeekApiKey } from '../../chat/api-key';
import { getOfficialApiChatConfig } from '../../chat/official-api-config';
import { createDeepSeekTurnSubmitter, isDeepSeekInterruptedTurnError } from './deepseek-stream-fn';
import { createDeepSeekWebProvider, deepSeekWebProviderToStreamFn } from './deepseek-web-provider';
import { createDeepSeekApiProvider, createDeepSeekApiMessageMapper, deepSeekApiProviderToStreamFn } from './official-api-provider';
import type { DeepSeekSessionState, DeepSeekStreamFnDeps } from './stream-fn-port';
import {
  createPiAgentTools,
  createPiLoopBudgetMap,
  piToolResultToExecutionRecord,
} from './tool-bridge';
import {
  buildContinuationPrompt,
  buildNudgePrompt,
  buildResumePrompt,
  extractTaskCompleteSignal,
  shouldNudge,
} from '../prompt';
import { stripRetiredArtifactProtocolBlocks } from '../retired-artifact';
import type {
  InlineAgentStartPayload,
  InlineAgentReasoningChunkMsg,
  InlineAgentStepCompleteMsg,
  InlineAgentStreamChunkMsg,
  InlineAgentToolDetectedMsg,
} from '../types';
import { INLINE_AGENT_MAX_RESUMES, INLINE_AGENT_MAX_STEPS } from '../types';
import { waitBetweenDeepSeekRequests } from '../step-control';

export type PostFn = (type: string, data: unknown) => void;
export type ExecuteToolFn = (call: ToolCall) => Promise<ToolExecutionRecord>;

const INLINE_AGENT_STREAM_EVENT_MAX_CHARS = 12000;
const TRUNCATION_SUFFIX = '\n...[truncated]';

export interface PiLoopAdapterDeps {
  payload: InlineAgentStartPayload;
  post: PostFn;
  executeTool: ExecuteToolFn;
  signal: AbortSignal;
}

/** Runs the pi engine with the released inline-agent semantics. */
export async function runPiInlineAgentLoop(deps: PiLoopAdapterDeps): Promise<void> {
  const { payload, post, executeTool, signal } = deps;
  const { loopId, chatSessionId, toolDescriptors, promptOptions } = payload;
  const { powWasmUrl } = payload;
  const locale = payload.locale ?? DEFAULT_LOCALE;

  // ------------------------------------------------------------------ state
  const session: DeepSeekSessionState = {
    chatSessionId,
    parentMessageId: payload.parentMessageId,
    setParentMessageId: (id) => {
      session.parentMessageId = id;
    },
  };

  // Chain authority by backend (B2): the web path uses the DS page session
  // chain (`parentMessageId`); the official-API path has no page chain — the
  // pi Context transcript IS the chain, so `hasContinuableChain` is
  // trivially true there and fail-closed checks verify the Context carries a
  // valid assistant message instead (beforeToolCall).
  const backend = payload.modelBackend ?? 'web';
  const hasContinuableChain = (): boolean => {
    if (backend === 'official-api') return true;
    return session.parentMessageId !== null;
  };
  const chainResponseMessageId = (): number | null =>
    backend === 'official-api' ? null : session.parentMessageId;
  const collectedExecutions: ToolExecutionRecord[] = [...payload.toolExecutions];
  const executedInStep: ToolExecutionRecord[] = [];
  const descriptorByName = new Map<string, ToolDescriptor>(toolDescriptors.map((d) => [d.invocationName, d]));
  const nudge = {
    active: false, // serializer should build a nudge prompt for the current turn
    pendingTurn: false, // prepareNextTurn queued a nudge; the next turn is a nudge turn
    currentTurnIsNudge: false, // the turn now streaming is a nudge turn
    nudgedInStep: false, // this step already consumed its single nudge
    count: 0, // total nudges issued (token-speed request ids)
    lastAssistantText: '',
  };
  // Auto-resume (fix/v1.14.1-tool-loop): the engine run now starting
  // continues an interrupted turn. `active` is a one-shot flag: the resumed
  // run's first DeepSeek request serializes the resume prompt, and steering
  // stays quiet until that run's first turn has ended (see `turn_end`).
  const resume = {
    active: false,
    count: 0, // resumes issued so far (drives the resume prompt's attempt line)
  };

  let stepIndex = 0; // completed steps (0-based index of the current step)
  let lastStepCompleted = false; // whether the current step already posted STEP_COMPLETE
  let stepText = ''; // current turn's visible text
  let lastPostedText = '';
  let stepReasoning = ''; // current step's accumulated reasoning text (per-turn thinking deltas)
  let lastPostedReasoning = '';
  let finalizeDone = false;
  let resolvedFinalText: string | null = null;
  let stopNotice: string | null = null;
  let lastTurnWasError = false;
  let lastErrorMessage = '';
  let lastTurnText = '';
  let lastTurnHasTools = false;
  let turnsElapsed = 0;

  const clampStreamEventText = (value: string): string =>
    value.length > INLINE_AGENT_STREAM_EVENT_MAX_CHARS
      ? `${value.slice(0, INLINE_AGENT_STREAM_EVENT_MAX_CHARS)}${TRUNCATION_SUFFIX}`
      : value;

  const postStreamChunk = (nextText: string) => {
    const fullText = clampStreamEventText(nextText);
    if (fullText === lastPostedText) return;
    lastPostedText = fullText;
    post('AGENT_STREAM_CHUNK', {
      loopId,
      stepIndex,
      text: '',
      fullText,
    } satisfies InlineAgentStreamChunkMsg);
  };

  const postReasoningChunk = (nextReasoning: string) => {
    const fullText = clampStreamEventText(nextReasoning);
    if (fullText === lastPostedReasoning) return;
    lastPostedReasoning = fullText;
    post('AGENT_REASONING_CHUNK', {
      loopId,
      stepIndex,
      fullText,
    } satisfies InlineAgentReasoningChunkMsg);
  };

  const postStepComplete = () => {
    post('AGENT_STEP_COMPLETE', {
      loopId,
      stepIndex,
      responseMessageId: chainResponseMessageId(),
      toolExecutions: [...executedInStep],
    } satisfies InlineAgentStepCompleteMsg);
  };

  const postToolDetected = (toolCallId: string, toolName: string, args: unknown) => {
    const descriptor = descriptorByName.get(toolName);
    post('AGENT_TOOL_DETECTED', {
      loopId,
      stepIndex,
      call: {
        id: toolCallId,
        name: descriptor?.name ?? toolName,
        invocationName: toolName,
        payload: (args ?? {}) as Record<string, unknown>,
        raw: '',
      },
    } satisfies InlineAgentToolDetectedMsg);
  };

  const providerFor = (toolName: string): ToolProviderIdentity =>
    descriptorByName.get(toolName)?.provider ?? {
      kind: 'local',
      id: 'unknown',
      displayName: 'Unknown',
      transport: 'in_process',
    };

  // ------------------------------------------------------------- DS backend
  // Shared per-run stream wiring: model selection + pacing wrapper. The web
  // path keeps the released semantics byte-for-byte (golden); the
  // official-api path is a peer backend over the same pi loop.
  let requestCount = 0;
  const mapToolCall = (call: { name: string; invocationName: string; payload: Record<string, unknown> }, index: number) => ({
    type: 'toolCall' as const,
    // XML indexes restart at zero for every model response. A single inline
    // run intentionally reuses one background authorization grant, so the raw
    // `xml:${index}` id made the first tool in turn 2 look like a replay of the
    // first tool in turn 1. Bind the id to the model-request sequence while
    // keeping it stable for any parsing/retry inside that same request.
    id: `turn:${requestCount}:xml:${index}`,
    name: call.invocationName,
    arguments: call.payload,
  });

  let streamFn: StreamFn;
  let model: Model<Api>;
  if (backend === 'official-api') {
    // B2: official API backend. No page chain: the pi Context transcript is
    // the chain (fail-closed checks in beforeToolCall/shouldStopAfterTurn
    // use the Context, see below).
    const provider = createDeepSeekApiProvider({
      getApiKey: () => getDeepSeekApiKey(),
      getConfig: () => getOfficialApiChatConfig(),
      mapMessages: createDeepSeekApiMessageMapper(),
    }, {
      toolDescriptors,
      mapToolCall,
    });
    model = provider.getModels()[0];
    streamFn = deepSeekApiProviderToStreamFn(provider);
  } else {
    const submitter = createDeepSeekTurnSubmitter({ powWasmUrl });
    const streamFnDeps = {
      submitTurn: submitter,
      session,
      serializePrompt: () => {
        // Auto-resume: the resumed run's first DS request carries the resume
        // prompt instead of continuation bytes. The flag clears on that
        // run's first `turn_end`, so later requests keep the released
        // continuation/nudge semantics.
        if (resume.active) {
          return buildResumePrompt(payload.originalPrompt, resume.count, locale);
        }
        if (nudge.active) {
          nudge.active = false;
          nudge.currentTurnIsNudge = true;
          return buildNudgePrompt(payload.originalPrompt, nudge.lastAssistantText, collectedExecutions, nudge.count, locale);
        }
        return buildContinuationPrompt(payload.originalPrompt, collectedExecutions, locale);
      },
      mapToolCall,
      toolDescriptors,
      turnDefaults: {
        modelType: promptOptions.modelType,
        refFileIds: promptOptions.refFileIds,
        thinkingEnabled: promptOptions.thinkingEnabled,
        searchEnabled: promptOptions.searchEnabled,
      },
      onTokenSpeed: (progress) => {
        post('AGENT_TOKEN_SPEED', {
          ...progress,
          requestId: `agent:${loopId}:step:${stepIndex}${nudge.currentTurnIsNudge ? `:nudge:${nudge.count}` : ''}`,
          chatSessionId,
          modelType: progress.modelType ?? promptOptions.modelType,
        });
      },
    } satisfies DeepSeekStreamFnDeps;

    // The deepseek-web backend is registered as a first-class pi-ai provider
    // (B1): the loop consumes the released `runAgentLoop` seam through
    // `provider.stream` instead of a hand-built StreamFn. The provider owns no
    // session state (the injected `session` is the chain authority) and its
    // auth surface is ambient: `createClientHeaders` resolves the page session
    // headers or throws when the login token is missing — provider auth
    // resolution reports that as "not configured".
    const provider = createDeepSeekWebProvider({
      ...streamFnDeps,
      resolveAuthHeaders: () => {
        try {
          return createClientHeaders();
        } catch {
          return undefined;
        }
      },
    });
    model = provider.getModels()[0];
    streamFn = deepSeekWebProviderToStreamFn(provider);
  }

  // One 2.5–6.5s throttle delay before every DS request except the first
  // (released request pacing).
  const pacedStreamFn: StreamFn = async (model, context, options) => {
    if (requestCount > 0) {
      await waitBetweenDeepSeekRequests(signal);
    }
    requestCount += 1;
    return streamFn(model, context, options);
  };

  const piTools = createPiAgentTools({
    descriptors: toolDescriptors,
    executeTool,
    callSource: {
      requestId: payload.capabilityScopeRequestId ?? `agent:${loopId}`,
      chatSessionId,
    },
  });

  const budget = createPiLoopBudgetMap();
  const config: AgentLoopConfig = {
    model,
    toolExecution: 'sequential',
    convertToLlm: (messages: AgentMessage[]): Message[] =>
      messages.filter((m) => m.role === 'user' || m.role === 'assistant' || m.role === 'toolResult'),
    shouldStopAfterTurn: ({ message }) => {
      lastTurnText = extractText(message);
      lastTurnHasTools = message.content.some((block) => block.type === 'toolCall');
      if (stepIndex >= budget.maxSteps) {
        if (stopNotice === null && collectedExecutions.length > 0) {
          stopNotice = buildInlineAgentBudgetNotice(locale, stepIndex);
        }
        return true;
      }
      const text = lastTurnText;
      const hasTools = lastTurnHasTools;

      if (!hasContinuableChain()) {
        if (hasTools) {
          throw new Error(chainErrorText(nudge.currentTurnIsNudge));
        }
        if (!text.trim()) {
          throw new Error('DeepSeek returned an empty agent continuation without a continuable response message.');
        }
        resolvedFinalText = text;
        return true;
      }
      if (hasTools) return false;

      if (extractTaskCompleteSignal(text)) {
        resolvedFinalText = text;
        return true;
      }
      // Nudge decisions run on the USER-VISIBLE text: retired artifact XML
      // (an internal control protocol the loop cannot execute) is stripped
      // first, so a turn whose visible tail still promises a deliverable
      // ("now creating a report for you" with nothing renderable following)
      // is nudged instead of ending on an empty promise — the deliverable
      // must never be silently swallowed.
      const nudging = shouldNudge(
        payload.originalPrompt,
        collectedExecutions,
        stripRetiredArtifactProtocolBlocks(text),
      );
      if (nudge.currentTurnIsNudge) {
        if (nudging) {
          stopNotice = buildInlineAgentBudgetNotice(locale, stepIndex + 1);
        } else {
          resolvedFinalText = text;
        }
        return true;
      }
      if (nudging) return false; // getSteeringMessages issues the single-step nudge
      resolvedFinalText = text;
      return true;
    },
    // The pi inner loop only continues with another LLM call when tools were
    // executed or steering messages are pending. The released nudge semantics
    // (one no-tool correction request per step) are implemented as steering:
    // after a no-tool turn that still needs nudging, shouldStopAfterTurn
    // returns false and getSteeringMessages returns the nudge prompt message.
    getSteeringMessages: async () => {
      // The pi loop polls steering before the first turn too; the released
      // nudge semantics only apply after a real turn has run.
      if (turnsElapsed === 0) return [];
      // A resumed run opens with the resume prompt as its user message; the
      // engine's pre-first-turn steering poll must not stack a nudge on top
      // of it (the resume prompt IS the steering for that turn).
      if (resume.active) return [];
      if (!lastTurnHasTools && !nudge.nudgedInStep && hasContinuableChain()
        && !extractTaskCompleteSignal(lastTurnText)
        && shouldNudge(
          payload.originalPrompt,
          collectedExecutions,
          stripRetiredArtifactProtocolBlocks(lastTurnText),
        )) {
        nudge.count += 1;
        nudge.nudgedInStep = true;
        nudge.pendingTurn = true;
        nudge.active = true;
        // The nudge shows the model what the USER saw: retired artifact XML
        // is internal protocol, so the model sees the visible tail (e.g. the
        // empty promise) and re-delivers in a renderable form.
        nudge.lastAssistantText = stripRetiredArtifactProtocolBlocks(lastTurnText);
        return [{
          role: 'user',
          content: buildNudgePrompt(
            payload.originalPrompt,
            nudge.lastAssistantText,
            collectedExecutions,
            nudge.count,
            locale,
          ),
          timestamp: Date.now(),
        }];
      }
      return [];
    },
    beforeToolCall: async ({ context }) => {
      if (!hasContinuableChain()) {
        return { block: true, reason: chainErrorText(nudge.currentTurnIsNudge) };
      }
      // Official-API backend: the pi Context transcript IS the chain, so
      // also fail closed unless the Context carries a valid assistant
      // message (the model actually produced a turn before tools run).
      if (backend === 'official-api' && !contextHasAssistantMessage(context)) {
        return { block: true, reason: chainErrorText(nudge.currentTurnIsNudge) };
      }
      return undefined;
    },
  };

  // --------------------------------------------------------------- event sink
  const handleEvent = async (event: AgentEvent): Promise<void> => {
    switch (event.type) {
      case 'turn_start':
        nudge.currentTurnIsNudge = false;
        // Released semantics: each request's visible text replaces the
        // previous one within a step (nudge text is not concatenated).
        stepText = '';
        lastPostedText = '';
        // Post-abort the pi engine may still start one more turn after a
        // tool batch; the released loop never emits that ghost step.
        if (signal.aborted && turnsElapsed > 0) return;
        if (nudge.pendingTurn) {
          nudge.pendingTurn = false;
        } else {
          lastStepCompleted = false;
          stepReasoning = '';
          lastPostedReasoning = '';
          post('AGENT_STEP_STARTED', { loopId, stepIndex });
        }
        break;
      case 'message_update': {
        const assistantEvent = event.assistantMessageEvent;
        const delta = assistantEvent.type === 'text_delta' ? assistantEvent.delta : '';
        if (delta) {
          stepText += delta;
          postStreamChunk(stepText);
        }
        if (assistantEvent.type === 'thinking_delta' && assistantEvent.delta) {
          stepReasoning += assistantEvent.delta;
          postReasoningChunk(stepReasoning);
        }
        break;
      }
      case 'tool_execution_start':
        postToolDetected(event.toolCallId, event.toolName, event.args);
        break;
      case 'tool_execution_end': {
        const descriptor = descriptorByName.get(event.toolName);
        const resultMessage: ToolResultMessage = {
          role: 'toolResult',
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          content: [{ type: 'text', text: extractResultText(event.result) }],
          details: (event.result as { details?: unknown } | undefined)?.details,
          isError: event.isError,
          timestamp: Date.now(),
        };
        executedInStep.push(piToolResultToExecutionRecord({
          toolName: descriptor?.name ?? event.toolName,
          provider: providerFor(event.toolName),
          message: resultMessage,
        }));
        break;
      }
      case 'turn_end': {
        // The resume prompt is a one-shot for the resumed run's first
        // request; from this turn's end on, continuation/nudge semantics
        // apply again. Cleared before the error branch so a resumed run that
        // dies again starts its next gate evaluation clean.
        resume.active = false;
        turnsElapsed += 1;
        const turnMessage = event.message as AssistantMessage;
        if (turnMessage.stopReason === 'error' || turnMessage.stopReason === 'aborted') {
          lastTurnWasError = true;
          lastErrorMessage = turnMessage.errorMessage ?? 'DeepSeek agent turn failed.';
          stepText = '';
          lastPostedText = '';
          return;
        }
        const hasTools = turnMessage.content.some((block) => block.type === 'toolCall');
        if (hasTools) {
          // Fail-closed: tools without a continuable chain were blocked in
          // beforeToolCall; surface the refusal as the released error.
          if (!hasContinuableChain()) {
            throw new Error(chainErrorText(nudge.currentTurnIsNudge));
          }
          collectedExecutions.push(...executedInStep);
          postStepComplete();
          stepIndex += 1;
          lastStepCompleted = true;
          stepText = '';
          lastPostedText = '';
          executedInStep.length = 0;
          nudge.nudgedInStep = false;
        } else {
          stepText = extractText(turnMessage);
          postStreamChunk(stepText);
        }
        break;
      }
      case 'agent_end':
        // Finalization is the auto-resume driver's job: after the engine
        // settles, the driver decides between finalize and one more resume
        // run (see the run section below).
        break;
      default:
        break;
    }
  };

  const finalize = () => {
    if (finalizeDone) return;
    finalizeDone = true;

    if (signal.aborted || lastTurnWasError && signal.aborted) {
      post('AGENT_LOOP_COMPLETE', {
        loopId,
        totalSteps: stepIndex,
        totalTools: collectedExecutions.length,
        finalText: '',
      });
      return;
    }
    if (lastTurnWasError) {
      post('AGENT_LOOP_ERROR', {
        loopId,
        stepIndex,
        totalTools: collectedExecutions.length,
        error: lastErrorMessage,
      });
      return;
    }
    if (stopNotice === null && resolvedFinalText === null && collectedExecutions.length > 0
      && stepIndex >= INLINE_AGENT_MAX_STEPS) {
      stopNotice = buildInlineAgentBudgetNotice(locale, stepIndex);
    }
    if (!lastStepCompleted) {
      postStepComplete();
    }
    let finalText = '';
    if (resolvedFinalText !== null) {
      finalText = resolvedFinalText;
    } else if (!signal.aborted && stopNotice !== null) {
      finalText = stopNotice;
    }
    post('AGENT_LOOP_COMPLETE', {
      loopId,
      totalSteps: lastStepCompleted ? stepIndex : stepIndex + 1,
      totalTools: collectedExecutions.length,
      finalText,
    });
  };

  // ------------------------------------------------------------------- run
  // Auto-resume driver (fix/v1.14.1-tool-loop): each engine run is one
  // `runAgentLoop` call. An interrupted turn (server cut / timeout after
  // streamed chunks / PoW failure) leaves the conversation chain continuable
  // — `session.parentMessageId` is only committed on success — so instead of
  // ending the run as AGENT_LOOP_ERROR, a FRESH engine run may continue it
  // with a resume prompt, capped at INLINE_AGENT_MAX_RESUMES and gated below
  // (never after abort, tool executions in the dead step, or a nudge turn).
  // Thrown errors (e.g. a `shouldStopAfterTurn` chain refusal) are never
  // resume-eligible: they bypass the gate entirely via the catch below.
  try {
    let nextMessages: Message[] = [{
      role: 'user',
      content: payload.originalPrompt,
      timestamp: Date.now(),
    }];
    let resumeCount = 0;
    for (;;) {
      // Per-run error bookkeeping: only the error of the run that just
      // streamed may drive the gate below (a successful resumed run must
      // finalize as complete, not inherit the interrupted run's error).
      lastTurnWasError = false;
      lastErrorMessage = '';
      await runAgentLoop(
        nextMessages,
        { systemPrompt: '', messages: [], tools: piTools },
        config,
        handleEvent,
        signal,
        pacedStreamFn,
      );
      if (finalizeDone) break; // engine already finalized (defensive)
      if (!lastTurnWasError) {
        finalize();
        break;
      }
      if (signal.aborted) {
        finalize(); // silent abort — NEVER resume
        break;
      }
      const resumeEligible =
        resumeCount < INLINE_AGENT_MAX_RESUMES
        && isDeepSeekInterruptedTurnError(lastErrorMessage)
        && executedInStep.length === 0 // no tool executions in the dead step — no double execution
        && !nudge.currentTurnIsNudge;
      if (!resumeEligible) {
        finalize(); // posts AGENT_LOOP_ERROR with the classified message
        break;
      }
      // Resume: a fresh engine run continues the chain at the same step
      // index (the interrupted step never posted STEP_COMPLETE). Per-step
      // bookkeeping resets; stepIndex, turnsElapsed, collectedExecutions and
      // the session chain carry over, and the resume request is paced like
      // any continuation (requestCount persists).
      resumeCount += 1;
      nudge.nudgedInStep = false;
      nudge.currentTurnIsNudge = false;
      lastStepCompleted = false;
      stepText = '';
      lastPostedText = '';
      executedInStep.length = 0;
      resume.active = true;
      resume.count = resumeCount;
      // The resumed run's own `turn_start` re-posts AGENT_STEP_STARTED at
      // the same stepIndex; upsert-by-index (content.ts/renderer.ts)
      // replaces the dead streaming step in DOM and trace — no new event
      // types. `postStreamChunk('')` is a no-op safety flush that keeps the
      // next stream chunk posting.
      postStreamChunk('');
      nextMessages = [{
        role: 'user',
        content: buildResumePrompt(payload.originalPrompt, resumeCount, locale),
        timestamp: Date.now(),
      }];
    }
  } catch (err) {
    if (finalizeDone) return;
    finalizeDone = true;
    if (signal.aborted) {
      post('AGENT_LOOP_COMPLETE', {
        loopId,
        totalSteps: stepIndex,
        totalTools: collectedExecutions.length,
        finalText: '',
      });
      return;
    }
    post('AGENT_LOOP_ERROR', {
      loopId,
      stepIndex,
      totalTools: collectedExecutions.length,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

function extractText(message: { content: Array<{ type: string; text?: string }> }): string {
  return message.content
    .filter((block): block is { type: 'text'; text: string } => block.type === 'text')
    .map((block) => block.text)
    .join('');
}

function extractResultText(result: unknown): string {
  const content = (result as { content?: Array<{ type?: string; text?: string }> } | undefined)?.content;
  if (!content) return '';
  return content
    .filter((block): block is { type: 'text'; text: string } => block.type === 'text')
    .map((block) => block.text)
    .join('');
}

function chainErrorText(nudgeTurn: boolean): string {
  return nudgeTurn
    ? 'DeepSeek returned nudge tool calls without a continuable response message; refusing to execute tools outside the conversation chain.'
    : 'DeepSeek returned agent tool calls without a continuable response message; refusing to execute tools outside the conversation chain.';
}

/**
 * Official-API fail-closed check: the pi Context transcript is the chain, so
 * tools may only run after the model actually produced an assistant message
 * in this loop (a valid turn), not on an empty/seed Context.
 */
function contextHasAssistantMessage(context: { messages: ReadonlyArray<{ role: string }> }): boolean {
  return context.messages.some((message) => message.role === 'assistant');
}

function buildInlineAgentBudgetNotice(locale: SupportedLocale, completedSteps: number): string {
  return translate(locale, 'content.agent.budgetReached', { count: completedSteps });
}
