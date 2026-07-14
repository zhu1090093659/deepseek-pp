import type { OfficialApiChatConfig } from '../../core/chat/official-api-config-contract';
import type { ChatLoopProvider, InterruptedChatLoop } from '../../core/chat/active-loop';
import type { ModelTurn, SubmitPromptInput } from '../../core/deepseek/automation-client-port';
import type { DeepSeekUploadedFile } from '../../core/deepseek/contracts';
import type {
  OfficialDeepSeekCallbacks,
  OfficialDeepSeekMessage,
  OfficialDeepSeekTurn,
  SubmitOfficialDeepSeekInput,
} from '../../core/deepseek/official-api';
import { extractToolCalls } from '../../core/interceptor/tool-parser';
import {
  materializeDeepSeekImageUpload,
  type EncodedDeepSeekImageUploadRequest,
} from '../../core/messaging/deepseek-runtime-request-codec';
import type { RuntimeToolCallOptions } from '../../core/tool/runtime';
import type {
  ToolCall,
  ToolDescriptor,
  ToolResult,
} from '../../core/tool/types';
import type { ToolExecutionRecord } from '../../core/types';

const MAX_CHAT_TOOL_STEPS = 20;

export interface ChatStreamChunk {
  text: string;
  done: boolean;
  error?: string;
  reasoningText?: string;
  phase?: 'reasoning' | 'answer';
}

export interface ChatPromptBuildRequest {
  prompt: string;
  isFirstMessage: boolean;
  messageCount: number;
}

export interface ChatPromptBuildResult {
  augmented: string;
  enabledDescriptors: ToolDescriptor[];
}

export interface ChatRuntimeServiceDependencies {
  getChatEnabled(): Promise<boolean>;
  getDeepSeekApiKey(): Promise<string | null>;
  getOfficialApiChatConfig(): Promise<OfficialApiChatConfig>;
  loadClientHeaders(preferredTabId?: number): Promise<Record<string, string> | null>;
  getModelType(): Promise<string | null>;
  buildPrompt(request: ChatPromptBuildRequest): Promise<ChatPromptBuildResult>;
  executeToolCall(call: ToolCall, options: RuntimeToolCallOptions): Promise<ToolResult>;
  createChatSession(headers: Record<string, string>, signal: AbortSignal): Promise<string>;
  createPowHeaders(
    headers: Record<string, string>,
    signal: AbortSignal,
  ): Promise<Record<string, string>>;
  createUploadPowHeaders(
    headers: Record<string, string>,
    signal: AbortSignal,
  ): Promise<Record<string, string>>;
  submitWebPrompt(
    input: SubmitPromptInput,
    callbacks: { onTextChunk?(text: string, fullText: string): void },
    signal: AbortSignal,
  ): Promise<ModelTurn>;
  submitOfficialPrompt(
    input: SubmitOfficialDeepSeekInput,
    callbacks: OfficialDeepSeekCallbacks,
    signal: AbortSignal,
  ): Promise<OfficialDeepSeekTurn>;
  uploadFile(
    input: {
      file: Blob;
      filename: string;
      modelType: string | null;
      clientHeaders: Record<string, string>;
      powHeaders: Record<string, string>;
    },
    signal: AbortSignal,
  ): Promise<DeepSeekUploadedFile>;
  markChatLoopStarted(provider: ChatLoopProvider): Promise<void>;
  markChatLoopFinished(): Promise<void>;
  reconcileInterruptedChatLoop(): Promise<InterruptedChatLoop | null>;
  broadcastChunk(chunk: ChatStreamChunk, excludeTabId?: number): void;
  continueWithToolResults(toolResults: string): string;
  maxToolStepsMessage(): string;
  missingAuthMessage(): string;
  interruptedMessage(): string;
  reportError(code: string, error: unknown): void;
}

export interface ChatSubmitRequest {
  text: string;
  config?: OfficialApiChatConfig;
  refFileIds: string[];
}

export interface ChatRuntimeService {
  submitPrompt(
    request: ChatSubmitRequest,
    excludeTabId?: number,
  ): Promise<{ ok: true } | { ok: false; error: string }>;
  uploadImage(
    request: EncodedDeepSeekImageUploadRequest,
    excludeTabId?: number,
  ): Promise<{ ok: true; file: DeepSeekUploadedFile } | { ok: false; error: string }>;
  resetSession(): Promise<void>;
  reconcileInterruptedOnWake(): Promise<void>;
}

interface ActiveChatTurn {
  generation: number;
  controller: AbortController;
  settled: Promise<void>;
  terminal?: { chunk: ChatStreamChunk; excludeTabId?: number };
}

interface PendingChatAdmission {
  generation: number;
}

interface ActiveChatUpload {
  controller: AbortController;
  settled: Promise<void>;
}

export function createChatRuntimeService(
  dependencies: ChatRuntimeServiceDependencies,
): ChatRuntimeService {
  let chatSessionId: string | null = null;
  let chatParentMessageId: number | null = null;
  let officialApiChatMessages: OfficialDeepSeekMessage[] = [];
  let activeTurn: ActiveChatTurn | null = null;
  let pendingAdmission: PendingChatAdmission | null = null;
  let generation = 0;
  let resetOperation: Promise<void> | null = null;
  let wakeReconcileOperation: Promise<void> | null = null;
  let wakeReconciled = false;
  const activeUploads = new Set<ActiveChatUpload>();

  const assertTurnActive = (turn: ActiveChatTurn): void => {
    if (
      activeTurn === turn
      && turn.generation === generation
      && !turn.controller.signal.aborted
    ) return;
    if (turn.controller.signal.reason instanceof Error) throw turn.controller.signal.reason;
    throw new DOMException('Chat turn was cancelled.', 'AbortError');
  };

  const emitChunk = (
    turn: ActiveChatTurn,
    chunk: ChatStreamChunk,
    excludeTabId?: number,
  ): void => {
    if (
      activeTurn !== turn
      || turn.generation !== generation
      || turn.controller.signal.aborted
    ) return;
    if (chunk.done) {
      turn.terminal ??= { chunk, excludeTabId };
      return;
    }
    dependencies.broadcastChunk(chunk, excludeTabId);
  };

  const buildPrompt = (prompt: string): Promise<ChatPromptBuildResult> => (
    dependencies.buildPrompt({
      prompt,
      isFirstMessage: chatSessionId === null && officialApiChatMessages.length === 0,
      messageCount: officialApiChatMessages.length + 1,
    })
  );

  const executeChatTool = async (
    turn: ActiveChatTurn,
    call: ToolCall,
  ): Promise<ToolExecutionRecord> => {
    assertTurnActive(turn);
    const result = await dependencies.executeToolCall(call, {
      signal: turn.controller.signal,
      assertActive: () => assertTurnActive(turn),
    });
    assertTurnActive(turn);
    if (!result.ok && result.error?.details?.externalOutcome === 'ambiguous') {
      throw new Error(result.error.message || result.detail || result.summary);
    }
    return {
      name: call.name,
      result: {
        ok: result.ok,
        summary: result.summary,
        detail: result.detail,
        output: result.output,
        truncated: result.truncated,
        error: result.error,
      },
    };
  };

  const runWebToolLoop = async (
    turn: ActiveChatTurn,
    input: Omit<SubmitPromptInput, 'powHeaders'>,
    toolDescriptors: ToolDescriptor[],
    excludeTabId?: number,
  ): Promise<void> => {
    let currentInput = input;

    for (let step = 0; step < MAX_CHAT_TOOL_STEPS; step++) {
      assertTurnActive(turn);
      let accumulated = '';
      const powHeaders = await dependencies.createPowHeaders(
        currentInput.clientHeaders,
        turn.controller.signal,
      );
      assertTurnActive(turn);
      const result = await dependencies.submitWebPrompt({
        ...currentInput,
        powHeaders,
      }, {
        onTextChunk(newText, fullText) {
          accumulated = fullText;
          emitChunk(turn, { text: newText, done: false }, excludeTabId);
        },
      }, turn.controller.signal);
      assertTurnActive(turn);

      chatParentMessageId = result.responseMessageId;
      const fullText = accumulated || result.assistantText;
      if (!fullText) {
        emitChunk(turn, { text: '', done: true }, excludeTabId);
        return;
      }

      const toolCalls = extractToolCalls(fullText, { descriptors: toolDescriptors });
      if (toolCalls.length === 0) {
        emitChunk(turn, { text: fullText, done: true }, excludeTabId);
        return;
      }

      const executions: ToolExecutionRecord[] = [];
      for (const call of toolCalls) executions.push(await executeChatTool(turn, call));
      const continuationPrompt = dependencies.continueWithToolResults(
        serializeToolExecutions(executions),
      );
      currentInput = {
        ...currentInput,
        prompt: continuationPrompt,
        parentMessageId: chatParentMessageId,
      };
    }

    emitChunk(
      turn,
      { text: dependencies.maxToolStepsMessage(), done: true },
      excludeTabId,
    );
  };

  const runWebPrompt = async (
    turn: ActiveChatTurn,
    request: ChatSubmitRequest,
    excludeTabId?: number,
  ): Promise<void> => {
    const headers = await dependencies.loadClientHeaders(excludeTabId);
    assertTurnActive(turn);
    if (!headers) {
      emitChunk(
        turn,
        { text: '', done: true, error: dependencies.missingAuthMessage() },
        excludeTabId,
      );
      return;
    }

    if (!chatSessionId) {
      const nextSessionId = await dependencies.createChatSession(
        headers,
        turn.controller.signal,
      );
      assertTurnActive(turn);
      chatSessionId = nextSessionId;
      chatParentMessageId = null;
    }

    const promptContext = await buildPrompt(request.text);
    assertTurnActive(turn);
    const storedModelType = await dependencies.getModelType();
    assertTurnActive(turn);
    const modelType = request.refFileIds.length > 0 ? 'vision' : storedModelType;

    await runWebToolLoop(turn, {
      chatSessionId,
      parentMessageId: chatParentMessageId,
      modelType,
      prompt: promptContext.augmented,
      refFileIds: request.refFileIds,
      thinkingEnabled: false,
      searchEnabled: false,
      clientHeaders: headers,
    }, promptContext.enabledDescriptors, excludeTabId);
  };

  const runOfficialToolLoop = async (
    turn: ActiveChatTurn,
    input: SubmitOfficialDeepSeekInput,
    toolDescriptors: ToolDescriptor[],
    excludeTabId?: number,
  ): Promise<OfficialDeepSeekMessage[]> => {
    let currentMessages = [...input.messages];

    for (let step = 0; step < MAX_CHAT_TOOL_STEPS; step++) {
      assertTurnActive(turn);
      let accumulated = '';
      let reasoningAccumulated = '';
      const result = await dependencies.submitOfficialPrompt({
        ...input,
        messages: currentMessages,
      }, {
        onTextChunk(newText, fullText) {
          accumulated = fullText;
          emitChunk(
            turn,
            { text: newText, done: false, phase: 'answer' },
            excludeTabId,
          );
        },
        onReasoningChunk(newText, fullText) {
          reasoningAccumulated = fullText;
          emitChunk(turn, {
            text: '',
            reasoningText: newText,
            done: false,
            phase: 'reasoning',
          }, excludeTabId);
        },
      }, turn.controller.signal);
      assertTurnActive(turn);

      const fullText = accumulated || result.assistantText;
      if (!fullText) {
        emitChunk(turn, { text: '', done: true }, excludeTabId);
        return currentMessages;
      }

      currentMessages = [
        ...currentMessages,
        {
          role: 'assistant',
          content: fullText,
          reasoningContent: reasoningAccumulated || result.reasoningText || undefined,
        },
      ];
      const toolCalls = extractToolCalls(fullText, { descriptors: toolDescriptors });
      if (toolCalls.length === 0) {
        emitChunk(turn, { text: '', done: true }, excludeTabId);
        return currentMessages;
      }

      const executions: ToolExecutionRecord[] = [];
      for (const call of toolCalls) executions.push(await executeChatTool(turn, call));
      currentMessages = [
        ...currentMessages,
        {
          role: 'user',
          content: dependencies.continueWithToolResults(serializeToolExecutions(executions)),
        },
      ];
    }

    emitChunk(
      turn,
      { text: dependencies.maxToolStepsMessage(), done: true },
      excludeTabId,
    );
    return currentMessages;
  };

  const runOfficialPrompt = async (
    turn: ActiveChatTurn,
    request: ChatSubmitRequest,
    apiKey: string,
    excludeTabId?: number,
  ): Promise<void> => {
    const promptContext = await buildPrompt(request.text);
    assertTurnActive(turn);
    const config = request.config ?? await dependencies.getOfficialApiChatConfig();
    assertTurnActive(turn);
    const messages = await runOfficialToolLoop(turn, {
      apiKey,
      config,
      messages: [
        ...officialApiChatMessages,
        { role: 'user', content: promptContext.augmented },
      ],
    }, promptContext.enabledDescriptors, excludeTabId);
    assertTurnActive(turn);
    officialApiChatMessages = messages;
  };

  const runChatTurn = async (
    turn: ActiveChatTurn,
    request: ChatSubmitRequest,
    excludeTabId?: number,
  ): Promise<void> => {
    let markerStarted = false;
    try {
      const apiKey = await dependencies.getDeepSeekApiKey();
      assertTurnActive(turn);
      const provider: ChatLoopProvider = apiKey ? 'official-api' : 'web';
      await dependencies.markChatLoopStarted(provider);
      markerStarted = true;
      assertTurnActive(turn);

      if (apiKey) {
        await runOfficialPrompt(turn, request, apiKey, excludeTabId);
      } else {
        await runWebPrompt(turn, request, excludeTabId);
      }
    } catch (error) {
      if (!isExpectedCancellation(turn, activeTurn, generation)) {
        const message = error instanceof Error ? error.message : String(error);
        emitChunk(turn, { text: '', done: true, error: message }, excludeTabId);
        if (
          message.includes('auth')
          || message.includes('token')
          || message.includes('401')
        ) {
          chatSessionId = null;
        }
      }
    } finally {
      if (markerStarted) {
        try {
          await dependencies.markChatLoopFinished();
        } catch (error) {
          dependencies.reportError('chat_loop_finish_failed', error);
        }
      }
      const terminal = turn.terminal;
      const shouldPublishTerminal = Boolean(
        terminal
        && activeTurn === turn
        && turn.generation === generation
        && !turn.controller.signal.aborted,
      );
      if (activeTurn === turn) activeTurn = null;
      if (shouldPublishTerminal && terminal) {
        dependencies.broadcastChunk(terminal.chunk, terminal.excludeTabId);
      }
    }
  };

  const submitPrompt: ChatRuntimeService['submitPrompt'] = async (request, excludeTabId) => {
    await ensureWakeReconciled();
    if (activeTurn || pendingAdmission || resetOperation) {
      return { ok: false, error: 'chat_already_running' };
    }

    const admission: PendingChatAdmission = { generation };
    pendingAdmission = admission;
    let enabled: boolean;
    try {
      enabled = await dependencies.getChatEnabled();
    } catch (error) {
      if (pendingAdmission !== admission || admission.generation !== generation) {
        return { ok: false, error: 'chat_already_running' };
      }
      pendingAdmission = null;
      throw error;
    }
    if (pendingAdmission !== admission || admission.generation !== generation || resetOperation) {
      return { ok: false, error: 'chat_already_running' };
    }
    if (!enabled) {
      pendingAdmission = null;
      return { ok: false, error: 'chat_disabled' };
    }
    if (!request.text.trim()) {
      pendingAdmission = null;
      return { ok: false, error: 'empty_prompt' };
    }

    const turn: ActiveChatTurn = {
      generation,
      controller: new AbortController(),
      settled: Promise.resolve(),
    };
    activeTurn = turn;
    pendingAdmission = null;
    turn.settled = runChatTurn(turn, request, excludeTabId);
    return { ok: true };
  };

  const runImageUpload = async (
    request: EncodedDeepSeekImageUploadRequest,
    controller: AbortController,
    excludeTabId?: number,
  ): Promise<{ ok: true; file: DeepSeekUploadedFile } | { ok: false; error: string }> => {
    const enabled = await dependencies.getChatEnabled();
    assertSignalActive(controller.signal);
    if (!enabled) return { ok: false, error: 'chat_disabled' };
    const materialized = materializeDeepSeekImageUpload(request);
    assertSignalActive(controller.signal);
    const headers = await dependencies.loadClientHeaders(excludeTabId);
    assertSignalActive(controller.signal);
    if (!headers) return { ok: false, error: dependencies.missingAuthMessage() };
    const powHeaders = await dependencies.createUploadPowHeaders(headers, controller.signal);
    assertSignalActive(controller.signal);
    const file = await dependencies.uploadFile({
      file: materialized.file,
      filename: materialized.name,
      modelType: 'vision',
      clientHeaders: headers,
      powHeaders,
    }, controller.signal);
    assertSignalActive(controller.signal);
    return { ok: true, file };
  };

  const uploadImage: ChatRuntimeService['uploadImage'] = async (request, excludeTabId) => {
    await ensureWakeReconciled();
    if (resetOperation) return { ok: false, error: 'chat_already_running' };

    const entry: ActiveChatUpload = {
      controller: new AbortController(),
      settled: Promise.resolve(),
    };
    activeUploads.add(entry);
    const operation = runImageUpload(request, entry.controller, excludeTabId);
    entry.settled = operation.then(() => undefined, () => undefined);
    try {
      return await operation;
    } finally {
      activeUploads.delete(entry);
    }
  };

  const performSessionReset = async (): Promise<void> => {
    generation += 1;
    pendingAdmission = null;
    const turn = activeTurn;
    const uploads = [...activeUploads];
    turn?.controller.abort(new DOMException('Chat session was reset.', 'AbortError'));
    for (const upload of uploads) {
      upload.controller.abort(new DOMException('Chat session was reset.', 'AbortError'));
    }
    await Promise.all([
      turn?.settled ?? Promise.resolve(),
      ...uploads.map((upload) => upload.settled),
    ]);
    chatSessionId = null;
    chatParentMessageId = null;
    officialApiChatMessages = [];
  };

  const beginSessionReset = (): Promise<void> => {
    if (resetOperation) return resetOperation;
    resetOperation = performSessionReset().finally(() => {
      resetOperation = null;
    });
    return resetOperation;
  };

  const resetSession = async (): Promise<void> => {
    const generationBeforeRecovery = generation;
    await ensureWakeReconciled();
    if (generation !== generationBeforeRecovery) return;
    await beginSessionReset();
  };

  const reconcileInterruptedOnWake = (): Promise<void> => {
    if (wakeReconciled) return Promise.resolve();
    if (wakeReconcileOperation) return wakeReconcileOperation;

    const operation = (async () => {
      const interrupted = await dependencies.reconcileInterruptedChatLoop();
      if (interrupted) {
        await beginSessionReset();
        dependencies.broadcastChunk({
          text: '',
          done: true,
          error: dependencies.interruptedMessage(),
        });
      }
      wakeReconciled = true;
    })();
    wakeReconcileOperation = operation.finally(() => {
      wakeReconcileOperation = null;
    });
    return wakeReconcileOperation;
  };

  async function ensureWakeReconciled(): Promise<void> {
    if (wakeReconciled) return;
    await reconcileInterruptedOnWake();
  }

  return Object.freeze({
    submitPrompt,
    uploadImage,
    resetSession,
    reconcileInterruptedOnWake,
  });
}

function serializeToolExecutions(executions: readonly ToolExecutionRecord[]): string {
  return executions.map((execution) => (
    `<${execution.name}_result>\n${JSON.stringify(execution.result)}\n</${execution.name}_result>`
  )).join('\n');
}

function isExpectedCancellation(
  turn: ActiveChatTurn,
  activeTurn: ActiveChatTurn | null,
  generation: number,
): boolean {
  return turn.controller.signal.aborted
    || activeTurn !== turn
    || turn.generation !== generation;
}

function assertSignalActive(signal: AbortSignal): void {
  if (!signal.aborted) return;
  if (signal.reason instanceof Error) throw signal.reason;
  throw new DOMException('Chat operation was cancelled.', 'AbortError');
}
