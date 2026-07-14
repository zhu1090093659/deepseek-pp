import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  DEEPSEEK_RUNTIME_PAYLOAD_DECODERS,
  stageDeepSeekImageUpload,
} from '../core/messaging/deepseek-runtime-request-codec';
import type { RuntimeMessageContext } from '../core/messaging/runtime-boundary';
import {
  getRuntimeCommandOwner,
  type RuntimeCommandHandler,
} from '../core/messaging/runtime-command-registry';
import type { ModelTurn } from '../core/deepseek/automation-client-port';
import type { ConversationExport } from '../core/export/types';
import type { ToolDescriptor, ToolResult } from '../core/tool/types';
import {
  createChatRuntimeService,
  type ChatRuntimeServiceDependencies,
} from '../entrypoints/background/chat-runtime-service';
import {
  createConversationExportRuntimeHandlers,
  type ConversationExportRuntimeHandlerDependencies,
} from '../entrypoints/background/conversation-export-handlers';
import {
  createDeepSeekAuthRuntimeHandlers,
  type DeepSeekAuthRuntimeHandlerDependencies,
} from '../entrypoints/background/deepseek-auth-handlers';
import {
  createDeepSeekRuntimeHandlers,
} from '../entrypoints/background/deepseek-runtime-handlers';
import {
  createMultimodalRuntimeHandlers,
  type MultimodalRuntimeHandlerDependencies,
} from '../entrypoints/background/multimodal-handlers';

const R43_COMMANDS = [
  'GET_DEEPSEEK_API_KEY_STATUS',
  'SAVE_DEEPSEEK_API_KEY',
  'CLEAR_DEEPSEEK_API_KEY',
  'GET_MULTIMODAL_SETTINGS_STATUS',
  'SAVE_MULTIMODAL_SETTINGS',
  'CLEAR_MULTIMODAL_SETTINGS',
  'ANALYZE_MULTIMODAL_MEDIA',
  'CHAT_SUBMIT_PROMPT',
  'UPLOAD_DEEPSEEK_IMAGE',
  'CHAT_NEW_SESSION',
  'GET_AUTH_STATUS',
  'GET_OFFICIAL_API_CHAT_CONFIG',
  'SAVE_OFFICIAL_API_CHAT_CONFIG',
  'EXPORT_DEEPSEEK_CONVERSATIONS',
  'CANCEL_DEEPSEEK_EXPORT',
  'AUTH_STATUS_CHANGED',
] as const;

const R43_PAYLOAD_COMMANDS = [
  'SAVE_DEEPSEEK_API_KEY',
  'SAVE_MULTIMODAL_SETTINGS',
  'ANALYZE_MULTIMODAL_MEDIA',
  'CHAT_SUBMIT_PROMPT',
  'UPLOAD_DEEPSEEK_IMAGE',
  'SAVE_OFFICIAL_API_CHAT_CONFIG',
  'EXPORT_DEEPSEEK_CONVERSATIONS',
  'CANCEL_DEEPSEEK_EXPORT',
] as const;

const extensionContext: RuntimeMessageContext = {
  runtimeId: 'extension-id',
  surface: 'extension_context',
  senderUrl: 'chrome-extension://extension-id/sidepanel.html',
  senderOrigin: 'chrome-extension://extension-id',
  tabId: 17,
  documentId: 'sidepanel-document-1',
  documentSessionId: 'sidepanel-document-1',
};

describe('R4.3 DeepSeek runtime ownership', () => {
  it('creates exactly the assigned 16 typed handlers and eight receiving decoders', () => {
    const handlers = createDeepSeekRuntimeHandlers({
      auth: createAuthDependencies(),
      multimodal: createMultimodalDependencies(),
      chat: {
        service: createChatRuntimeService(createChatDependencies()),
        getOfficialApiChatConfig: vi.fn(async () => officialConfig()),
        saveOfficialApiChatConfig: vi.fn(async (config) => config),
      },
      conversationExport: createExportDependencies(),
    });
    const types = handlers.map((handler) => handler.type);

    expect(types).toHaveLength(16);
    expect(new Set(types).size).toBe(16);
    expect([...types].sort()).toEqual([...R43_COMMANDS].sort());
    expect(Object.keys(DEEPSEEK_RUNTIME_PAYLOAD_DECODERS).sort())
      .toEqual([...R43_PAYLOAD_COMMANDS].sort());
    for (const type of types) expect(getRuntimeCommandOwner(type)).toBe('typed-handler');

    const background = readFileSync('entrypoints/background.ts', 'utf8');
    for (const type of R43_COMMANDS) expect(background).not.toContain(`case '${type}'`);
  });

  it('keeps malformed multimodal input in the released domain response family', async () => {
    const dependencies = createMultimodalDependencies();
    const handlers = createMultimodalRuntimeHandlers(dependencies);

    await expect(dispatch(handlers, {
      type: 'ANALYZE_MULTIMODAL_MEDIA',
      payload: { prompt: 'inspect', media: [] },
    })).resolves.toEqual({
      ok: false,
      analyses: [],
      error: 'No multimodal media was provided.',
    });
    expect(dependencies.getMcpServers).not.toHaveBeenCalled();
    expect(dependencies.executeToolCall).not.toHaveBeenCalled();
    expect(dependencies.broadcastToolCallHistoryUpdate).toHaveBeenCalledWith(17);
  });

  it('rejects invalid multimodal settings before storage and preserves an empty patch', async () => {
    const dependencies = createMultimodalDependencies();
    const handlers = createMultimodalRuntimeHandlers(dependencies);

    await expect(dispatch(handlers, {
      type: 'SAVE_MULTIMODAL_SETTINGS',
      payload: { openaiApiKey: 7 },
    })).rejects.toThrow('SAVE_MULTIMODAL_SETTINGS.payload.openaiApiKey must be a string');
    expect(dependencies.saveSettings).not.toHaveBeenCalled();

    await dispatch(handlers, { type: 'SAVE_MULTIMODAL_SETTINGS', payload: {} });
    expect(dependencies.saveSettings).toHaveBeenCalledWith({});
  });

  it('decodes image aliases and verifies actual bytes before chat or network I/O', async () => {
    const chatDependencies = createChatDependencies();
    const service = createChatRuntimeService(chatDependencies);
    const handlers = createDeepSeekRuntimeHandlers({
      auth: createAuthDependencies(),
      multimodal: createMultimodalDependencies(),
      chat: {
        service,
        getOfficialApiChatConfig: vi.fn(async () => officialConfig()),
        saveOfficialApiChatConfig: vi.fn(async (config) => config),
      },
      conversationExport: createExportDependencies(),
    });

    await dispatch(handlers, {
      type: 'UPLOAD_DEEPSEEK_IMAGE',
      payload: {
        dataUrl: 'data:image/png;base64,AQID',
        type: 'image/png',
        size: 3,
      },
    });
    expect(chatDependencies.uploadFile).toHaveBeenCalledOnce();
    const request = vi.mocked(chatDependencies.uploadFile).mock.calls[0]![0];
    expect(request).toMatchObject({ filename: 'image' });
    expect(request.file).toBeInstanceOf(Blob);
    expect(request.file.size).toBe(3);
    expect(request.file.type).toBe('image/png');

    vi.mocked(chatDependencies.loadClientHeaders).mockClear();
    await expect(dispatch(handlers, {
      type: 'UPLOAD_DEEPSEEK_IMAGE',
      payload: {
        dataUrl: 'data:image/png;base64,AQID',
        mimeType: 'image/png',
        sizeBytes: 2,
      },
    })).rejects.toThrow('Image upload payload size changed during transfer');
    expect(chatDependencies.loadClientHeaders).not.toHaveBeenCalled();
    expect(chatDependencies.uploadFile).toHaveBeenCalledTimes(1);
  });

  it('keeps the released chat-disabled precedence before image validation or allocation', async () => {
    const chatDependencies = createChatDependencies();
    vi.mocked(chatDependencies.getChatEnabled).mockResolvedValue(false);
    const handlers = createDeepSeekRuntimeHandlers({
      auth: createAuthDependencies(),
      multimodal: createMultimodalDependencies(),
      chat: {
        service: createChatRuntimeService(chatDependencies),
        getOfficialApiChatConfig: vi.fn(async () => officialConfig()),
        saveOfficialApiChatConfig: vi.fn(async (config) => config),
      },
      conversationExport: createExportDependencies(),
    });

    await expect(dispatch(handlers, {
      type: 'UPLOAD_DEEPSEEK_IMAGE',
      payload: { dataUrl: 'not-a-data-url', mimeType: 7, sizeBytes: -1 },
    })).resolves.toEqual({ ok: false, error: 'chat_disabled' });
    expect(chatDependencies.loadClientHeaders).not.toHaveBeenCalled();
    expect(chatDependencies.uploadFile).not.toHaveBeenCalled();
  });
});

describe('DeepSeek auth handlers', () => {
  it('preserves committed mutation order and does not pretend to roll back menu failure', async () => {
    const events: string[] = [];
    const dependencies = createAuthDependencies();
    vi.mocked(dependencies.saveDeepSeekApiKey).mockImplementation(async () => {
      events.push('save');
    });
    vi.mocked(dependencies.resetChatSession).mockImplementation(async () => {
      events.push('reset');
    });
    vi.mocked(dependencies.refreshContextMenus).mockImplementation(async () => {
      events.push('menus');
      throw new Error('menus unavailable');
    });
    vi.mocked(dependencies.broadcastChatAuthStatus).mockImplementation(async () => {
      events.push('broadcast');
    });

    await expect(dispatch(createDeepSeekAuthRuntimeHandlers(dependencies), {
      type: 'SAVE_DEEPSEEK_API_KEY',
      payload: { apiKey: ' key ' },
    })).rejects.toThrow('menus unavailable');
    expect(events).toEqual(['save', 'reset', 'menus']);
    expect(dependencies.saveDeepSeekApiKey).toHaveBeenCalledWith(' key ');
  });
});

describe('interactive chat coordinator', () => {
  it('acks immediately, preserves disabled-before-empty precedence, and shares one signal', async () => {
    const completion = deferred<ModelTurn>();
    const dependencies = createChatDependencies();
    vi.mocked(dependencies.submitWebPrompt).mockReturnValue(completion.promise);
    const service = createChatRuntimeService(dependencies);

    vi.mocked(dependencies.getChatEnabled).mockResolvedValueOnce(false).mockResolvedValue(true);
    await expect(service.submitPrompt({ text: '', refFileIds: [] }, 17))
      .resolves.toEqual({ ok: false, error: 'chat_disabled' });
    await expect(service.submitPrompt({ text: '', refFileIds: [] }, 17))
      .resolves.toEqual({ ok: false, error: 'empty_prompt' });

    await expect(service.submitPrompt({ text: 'hello', refFileIds: ['file-1'] }, 17))
      .resolves.toEqual({ ok: true });
    expect(dependencies.submitWebPrompt).toHaveBeenCalledOnce();
    expect(dependencies.markChatLoopFinished).not.toHaveBeenCalled();
    const sessionSignal = vi.mocked(dependencies.createChatSession).mock.calls[0]![1];
    const powSignal = vi.mocked(dependencies.createPowHeaders).mock.calls[0]![1];
    const completionSignal = vi.mocked(dependencies.submitWebPrompt).mock.calls[0]![2];
    expect(powSignal).toBe(sessionSignal);
    expect(completionSignal).toBe(sessionSignal);
    expect(vi.mocked(dependencies.submitWebPrompt).mock.calls[0]![0])
      .toMatchObject({ modelType: 'vision', refFileIds: ['file-1'] });

    completion.resolve(modelTurn('done', 101));
    await waitForCall(dependencies.markChatLoopFinished);
  });

  it('rejects concurrent turns and prevents late chunks after a session reset', async () => {
    const dependencies = createChatDependencies();
    let firstCallbacks: { onTextChunk?(text: string, fullText: string): void } | undefined;
    vi.mocked(dependencies.createChatSession)
      .mockResolvedValueOnce('old-session')
      .mockResolvedValueOnce('new-session');
    vi.mocked(dependencies.submitWebPrompt)
      .mockImplementationOnce((_input, callbacks, signal) => {
        firstCallbacks = callbacks;
        return new Promise<ModelTurn>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        });
      })
      .mockResolvedValueOnce(modelTurn('new answer', 202));
    const service = createChatRuntimeService(dependencies);

    await expect(service.submitPrompt({ text: 'old', refFileIds: [] }, 17))
      .resolves.toEqual({ ok: true });
    await waitForCall(dependencies.submitWebPrompt);
    await expect(service.submitPrompt({ text: 'overlap', refFileIds: [] }, 17))
      .resolves.toEqual({ ok: false, error: 'chat_already_running' });

    await service.resetSession();
    firstCallbacks?.onTextChunk?.('late', 'late');
    expect(dependencies.broadcastChunk).not.toHaveBeenCalled();

    await expect(service.submitPrompt({ text: 'new', refFileIds: [] }, 17))
      .resolves.toEqual({ ok: true });
    await waitForCalls(dependencies.submitWebPrompt, 2);
    expect(vi.mocked(dependencies.submitWebPrompt).mock.calls[1]![0])
      .toMatchObject({ chatSessionId: 'new-session', parentMessageId: null });
    await waitForCalls(dependencies.markChatLoopFinished, 2);
  });

  it('invalidates prompt admission while the feature gate is pending across reset', async () => {
    const gate = deferred<boolean>();
    const dependencies = createChatDependencies();
    vi.mocked(dependencies.getChatEnabled)
      .mockReturnValueOnce(gate.promise)
      .mockResolvedValue(true);
    const service = createChatRuntimeService(dependencies);

    const stale = service.submitPrompt({ text: 'stale', refFileIds: [] }, 17);
    await waitForCall(dependencies.getChatEnabled);
    await service.resetSession();
    await expect(service.submitPrompt({ text: 'fresh', refFileIds: [] }, 17))
      .resolves.toEqual({ ok: true });
    gate.resolve(true);

    await expect(stale).resolves.toEqual({ ok: false, error: 'chat_already_running' });
    await waitForCall(dependencies.submitWebPrompt);
    expect(dependencies.buildPrompt).toHaveBeenCalledOnce();
    expect(dependencies.buildPrompt).toHaveBeenCalledWith(expect.objectContaining({ prompt: 'fresh' }));
  });

  it('blocks chat admission until wake reconciliation finishes', async () => {
    const reconcile = deferred<{
      provider: 'web';
      startedAt: number;
      interruptedAt: number;
    } | null>();
    const dependencies = createChatDependencies();
    vi.mocked(dependencies.reconcileInterruptedChatLoop).mockReturnValue(reconcile.promise);
    const service = createChatRuntimeService(dependencies);

    const recovery = service.reconcileInterruptedOnWake();
    const submit = service.submitPrompt({ text: 'after recovery', refFileIds: [] }, 17);
    expect(dependencies.getChatEnabled).not.toHaveBeenCalled();

    reconcile.resolve({ provider: 'web', startedAt: 1, interruptedAt: 2 });
    await recovery;
    await expect(submit).resolves.toEqual({ ok: true });
    expect(dependencies.broadcastChunk).toHaveBeenNthCalledWith(1, {
      text: '',
      done: true,
      error: 'Interrupted',
    });
    await waitForCall(dependencies.submitWebPrompt);
  });

  it('retries wake reconciliation after a transient read failure', async () => {
    const dependencies = createChatDependencies();
    vi.mocked(dependencies.reconcileInterruptedChatLoop)
      .mockRejectedValueOnce(new Error('session storage unavailable'))
      .mockResolvedValueOnce(null);
    const service = createChatRuntimeService(dependencies);

    await expect(service.reconcileInterruptedOnWake())
      .rejects.toThrow('session storage unavailable');
    await expect(service.submitPrompt({ text: 'retry', refFileIds: [] }, 17))
      .resolves.toEqual({ ok: true });
    expect(dependencies.reconcileInterruptedChatLoop).toHaveBeenCalledTimes(2);
    await waitForCall(dependencies.submitWebPrompt);
  });

  it('reports a provider AbortError when the turn signal remains active', async () => {
    const dependencies = createChatDependencies();
    vi.mocked(dependencies.submitWebPrompt)
      .mockRejectedValue(new DOMException('provider stream aborted', 'AbortError'));
    const service = createChatRuntimeService(dependencies);

    await expect(service.submitPrompt({ text: 'hello', refFileIds: [] }, 17))
      .resolves.toEqual({ ok: true });
    await waitForCall(dependencies.broadcastChunk);
    expect(dependencies.broadcastChunk).toHaveBeenCalledWith({
      text: '',
      done: true,
      error: 'AbortError: provider stream aborted',
    }, 17);
  });

  it('publishes terminal completion only after marker cleanup releases admission', async () => {
    const markerFinished = deferred<void>();
    const dependencies = createChatDependencies();
    vi.mocked(dependencies.markChatLoopFinished).mockReturnValueOnce(markerFinished.promise);
    const service = createChatRuntimeService(dependencies);

    await expect(service.submitPrompt({ text: 'first', refFileIds: [] }, 17))
      .resolves.toEqual({ ok: true });
    await waitForCall(dependencies.markChatLoopFinished);
    expect(dependencies.broadcastChunk).not.toHaveBeenCalledWith(
      expect.objectContaining({ done: true }),
      17,
    );

    markerFinished.resolve();
    await waitForCall(dependencies.broadcastChunk);
    await expect(service.submitPrompt({ text: 'second', refFileIds: [] }, 17))
      .resolves.toEqual({ ok: true });
  });

  it('turns marker-start failure into a terminal chunk instead of swallowing it', async () => {
    const dependencies = createChatDependencies();
    vi.mocked(dependencies.markChatLoopStarted).mockRejectedValue(new Error('session storage failed'));
    const service = createChatRuntimeService(dependencies);

    await expect(service.submitPrompt({ text: 'hello', refFileIds: [] }, 17))
      .resolves.toEqual({ ok: true });
    await waitForCall(dependencies.broadcastChunk);
    expect(dependencies.broadcastChunk).toHaveBeenCalledWith({
      text: '',
      done: true,
      error: 'session storage failed',
    }, 17);
    expect(dependencies.submitWebPrompt).not.toHaveBeenCalled();
  });

  it('stops after an ambiguous tool outcome and never submits a continuation', async () => {
    const dependencies = createChatDependencies();
    vi.mocked(dependencies.buildPrompt).mockResolvedValue({
      augmented: 'use tool',
      enabledDescriptors: [toolDescriptor()],
    });
    vi.mocked(dependencies.submitWebPrompt).mockResolvedValue(modelTurn(
      '<sample_tool>{"value":"once"}</sample_tool>',
      101,
    ));
    vi.mocked(dependencies.executeToolCall).mockResolvedValue(ambiguousToolResult());
    const service = createChatRuntimeService(dependencies);

    await service.submitPrompt({ text: 'use tool', refFileIds: [] }, 17);
    await waitForCall(dependencies.broadcastChunk);
    await waitForCall(dependencies.markChatLoopFinished);

    expect(dependencies.executeToolCall).toHaveBeenCalledOnce();
    expect(dependencies.submitWebPrompt).toHaveBeenCalledOnce();
    expect(dependencies.broadcastChunk).toHaveBeenCalledWith({
      text: '',
      done: true,
      error: 'response lost after dispatch',
    }, 17);
  });

  it('aborts upload PoW/network work and waits for settlement on session reset', async () => {
    const dependencies = createChatDependencies();
    let uploadSignal: AbortSignal | undefined;
    vi.mocked(dependencies.uploadFile).mockImplementation((_input, signal) => {
      uploadSignal = signal;
      return new Promise((_, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
    });
    const service = createChatRuntimeService(dependencies);
    const upload = service.uploadImage(stageDeepSeekImageUpload({
      dataUrl: 'data:image/png;base64,AQID',
      name: 'image.png',
      mimeType: 'image/png',
      sizeBytes: 3,
    }), 17);
    await waitForCall(dependencies.uploadFile);

    await service.resetSession();
    expect(uploadSignal?.aborted).toBe(true);
    await expect(upload).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('invalidates image upload while the feature gate is pending across reset', async () => {
    const gate = deferred<boolean>();
    const dependencies = createChatDependencies();
    vi.mocked(dependencies.getChatEnabled).mockReturnValue(gate.promise);
    const service = createChatRuntimeService(dependencies);
    const upload = service.uploadImage(stageDeepSeekImageUpload({
      dataUrl: 'data:image/png;base64,AQID',
      name: 'image.png',
      mimeType: 'image/png',
      sizeBytes: 3,
    }), 17);
    await waitForCall(dependencies.getChatEnabled);

    const reset = service.resetSession();
    gate.resolve(true);
    await reset;

    await expect(upload).rejects.toMatchObject({ name: 'AbortError' });
    expect(dependencies.loadClientHeaders).not.toHaveBeenCalled();
    expect(dependencies.uploadFile).not.toHaveBeenCalled();
  });
});

describe('conversation export coordinator', () => {
  it('rejects duplicate IDs before a second auth/network operation', async () => {
    const exportRun = deferred<ConversationExport>();
    const dependencies = createExportDependencies();
    vi.mocked(dependencies.runExport).mockReturnValue(exportRun.promise);
    const handlers = createConversationExportRuntimeHandlers(dependencies);
    const first = dispatch(handlers, {
      type: 'EXPORT_DEEPSEEK_CONVERSATIONS',
      payload: { exportId: 'same', request: {} },
    });
    await waitForCall(dependencies.runExport);

    await expect(dispatch(handlers, {
      type: 'EXPORT_DEEPSEEK_CONVERSATIONS',
      payload: { exportId: 'same', request: {} },
    })).resolves.toEqual({ ok: false, exportId: 'same', error: 'export_already_running' });
    expect(dependencies.loadClientHeaders).toHaveBeenCalledOnce();

    exportRun.resolve(exportData('same'));
    await first;
  });

  it('binds cancellation to the sender owner and publishes cancelled exactly once', async () => {
    const dependencies = createExportDependencies();
    let runSignal: AbortSignal | undefined;
    let onProgress: ((progress: Parameters<ConversationExportRuntimeHandlerDependencies['broadcastProgress']>[0]) => Promise<void>) | undefined;
    vi.mocked(dependencies.runExport).mockImplementation((input) => {
      runSignal = input.signal;
      onProgress = input.onProgress as typeof onProgress;
      return new Promise((_, reject) => {
        input.signal?.addEventListener('abort', () => reject(input.signal?.reason), { once: true });
      });
    });
    const handlers = createConversationExportRuntimeHandlers(dependencies);
    const running = dispatch(handlers, {
      type: 'EXPORT_DEEPSEEK_CONVERSATIONS',
      payload: { exportId: 'export-1', request: {} },
    });
    await waitForCall(dependencies.runExport);

    await expect(dispatch(handlers, {
      type: 'CANCEL_DEEPSEEK_EXPORT',
      payload: { exportId: 'export-1' },
    }, { ...extensionContext, documentSessionId: 'other-document' }))
      .resolves.toEqual({ ok: false, error: 'export_not_running' });
    expect(runSignal?.aborted).toBe(false);

    await expect(dispatch(handlers, {
      type: 'CANCEL_DEEPSEEK_EXPORT',
      payload: { exportId: 'export-1' },
    })).resolves.toEqual({ ok: true });
    expect(runSignal?.aborted).toBe(true);
    await expect(running).resolves.toEqual({
      ok: false,
      exportId: 'export-1',
      error: 'Export cancelled',
    });
    expect(vi.mocked(dependencies.broadcastProgress).mock.calls
      .filter(([progress]) => progress.phase === 'cancelled')).toHaveLength(1);

    await expect(onProgress?.({
      exportId: 'export-1',
      phase: 'completed',
      status: 'completed',
      current: 1,
      total: 1,
      message: 'late completed',
    })).rejects.toMatchObject({ name: 'AbortError' });
    expect(vi.mocked(dependencies.broadcastProgress).mock.calls
      .some(([progress]) => progress.phase === 'completed')).toBe(false);
  });

  it('keeps an active export reserved until its aborted operation settles', async () => {
    const settle = deferred<ConversationExport>();
    const dependencies = createExportDependencies();
    vi.mocked(dependencies.runExport).mockReturnValue(settle.promise);
    const handlers = createConversationExportRuntimeHandlers(dependencies);
    const running = dispatch(handlers, {
      type: 'EXPORT_DEEPSEEK_CONVERSATIONS',
      payload: { exportId: 'held', request: {} },
    });
    await waitForCall(dependencies.runExport);
    await dispatch(handlers, {
      type: 'CANCEL_DEEPSEEK_EXPORT',
      payload: { exportId: 'held' },
    });

    await expect(dispatch(handlers, {
      type: 'EXPORT_DEEPSEEK_CONVERSATIONS',
      payload: { exportId: 'held', request: {} },
    })).resolves.toEqual({ ok: false, exportId: 'held', error: 'export_already_running' });

    settle.reject(new DOMException('cancelled', 'AbortError'));
    await running;
    vi.mocked(dependencies.runExport).mockResolvedValueOnce(exportData('held'));
    await expect(dispatch(handlers, {
      type: 'EXPORT_DEEPSEEK_CONVERSATIONS',
      payload: { exportId: 'held', request: {} },
    })).resolves.toMatchObject({ ok: true, exportId: 'held' });
  });

  it('serializes cancellation behind in-flight progress and emits no later progress', async () => {
    const completedBroadcast = deferred<void>();
    const dependencies = createExportDependencies();
    vi.mocked(dependencies.broadcastProgress).mockImplementation(async (progress) => {
      if (progress.phase === 'completed') await completedBroadcast.promise;
    });
    vi.mocked(dependencies.runExport).mockImplementation(async (input) => {
      await input.onProgress?.({
        exportId: input.exportId,
        phase: 'completed',
        status: 'completed',
        current: 1,
        total: 1,
        message: 'completed',
      });
      return exportData(input.exportId);
    });
    const handlers = createConversationExportRuntimeHandlers(dependencies);
    const running = dispatch(handlers, {
      type: 'EXPORT_DEEPSEEK_CONVERSATIONS',
      payload: { exportId: 'ordered', request: {} },
    });
    await vi.waitFor(() => expect(dependencies.broadcastProgress).toHaveBeenCalledWith(
      expect.objectContaining({ phase: 'completed' }),
      17,
    ));

    const cancelling = dispatch(handlers, {
      type: 'CANCEL_DEEPSEEK_EXPORT',
      payload: { exportId: 'ordered' },
    });
    await Promise.resolve();
    expect(vi.mocked(dependencies.broadcastProgress).mock.calls
      .some(([progress]) => progress.phase === 'cancelled')).toBe(false);

    completedBroadcast.resolve();
    await expect(cancelling).resolves.toEqual({ ok: true });
    await expect(running).resolves.toMatchObject({ ok: false, exportId: 'ordered' });
    expect(vi.mocked(dependencies.broadcastProgress).mock.calls
      .map(([progress]) => progress.phase)).toEqual(['completed', 'cancelled']);
  });

  it('claims failure before broadcasting so cancellation cannot create a second terminal', async () => {
    const failedBroadcast = deferred<void>();
    const dependencies = createExportDependencies();
    vi.mocked(dependencies.runExport).mockRejectedValue(new Error('export failed'));
    vi.mocked(dependencies.broadcastProgress).mockImplementation(async (progress) => {
      if (progress.phase === 'failed') await failedBroadcast.promise;
    });
    const handlers = createConversationExportRuntimeHandlers(dependencies);
    const running = dispatch(handlers, {
      type: 'EXPORT_DEEPSEEK_CONVERSATIONS',
      payload: { exportId: 'failed', request: {} },
    });
    await vi.waitFor(() => expect(dependencies.broadcastProgress).toHaveBeenCalledWith(
      expect.objectContaining({ phase: 'failed' }),
      17,
    ));

    await expect(dispatch(handlers, {
      type: 'CANCEL_DEEPSEEK_EXPORT',
      payload: { exportId: 'failed' },
    })).resolves.toEqual({ ok: false, error: 'export_not_running' });
    failedBroadcast.resolve();
    await expect(running).resolves.toEqual({
      ok: false,
      exportId: 'failed',
      error: 'export failed',
    });
    expect(vi.mocked(dependencies.broadcastProgress).mock.calls
      .map(([progress]) => progress.phase)).toEqual(['failed']);
  });
});

function createAuthDependencies(): DeepSeekAuthRuntimeHandlerDependencies {
  return {
    hasDeepSeekApiKey: vi.fn(async () => false),
    saveDeepSeekApiKey: vi.fn(async () => undefined),
    clearDeepSeekApiKey: vi.fn(async () => undefined),
    resetChatSession: vi.fn(async () => undefined),
    refreshContextMenus: vi.fn(async () => undefined),
    getChatAuthStatus: vi.fn(async () => ({
      ok: true as const,
      available: false,
      provider: null,
      hasApiKey: false,
      hasToken: false,
    })),
    broadcastChatAuthStatus: vi.fn(async () => undefined),
  };
}

function createMultimodalDependencies(): MultimodalRuntimeHandlerDependencies {
  const status = {
    openaiConfigured: false,
    geminiConfigured: false,
    openaiImageModel: 'gpt-4.1-mini',
    geminiVideoModel: 'gemini-2.5-flash',
    openaiBaseUrl: 'https://api.openai.com/v1',
    geminiBaseUrl: 'https://generativelanguage.googleapis.com',
  };
  return {
    getSettingsStatus: vi.fn(async () => status),
    saveSettings: vi.fn(async () => status),
    clearSettings: vi.fn(async () => status),
    getMcpServers: vi.fn(async () => []),
    executeToolCall: vi.fn(async () => ({ ok: true, summary: 'ok' })),
    broadcastToolCallHistoryUpdate: vi.fn(async () => undefined),
  };
}

function createChatDependencies(): ChatRuntimeServiceDependencies {
  return {
    getChatEnabled: vi.fn(async () => true),
    getDeepSeekApiKey: vi.fn(async () => null),
    getOfficialApiChatConfig: vi.fn(async () => officialConfig()),
    loadClientHeaders: vi.fn(async () => ({ Authorization: 'Bearer token' })),
    getModelType: vi.fn(async () => 'chat'),
    buildPrompt: vi.fn(async ({ prompt }) => ({ augmented: prompt, enabledDescriptors: [] })),
    executeToolCall: vi.fn(async () => ({ ok: true, summary: 'ok' })),
    createChatSession: vi.fn(async () => 'session-1'),
    createPowHeaders: vi.fn(async () => ({ 'X-DS-PoW-Response': 'pow' })),
    createUploadPowHeaders: vi.fn(async () => ({ 'X-DS-PoW-Response': 'upload-pow' })),
    submitWebPrompt: vi.fn(async () => modelTurn('done', 101)),
    submitOfficialPrompt: vi.fn(async () => ({
      assistantText: 'done',
      reasoningText: '',
      finished: true,
    })),
    uploadFile: vi.fn(async () => uploadedFile()),
    markChatLoopStarted: vi.fn(async () => undefined),
    markChatLoopFinished: vi.fn(async () => undefined),
    reconcileInterruptedChatLoop: vi.fn(async () => null),
    broadcastChunk: vi.fn(),
    continueWithToolResults: vi.fn((results) => `continue:${results}`),
    maxToolStepsMessage: vi.fn(() => 'max steps'),
    missingAuthMessage: vi.fn(() => 'Missing DeepSeek auth'),
    interruptedMessage: vi.fn(() => 'Interrupted'),
    reportError: vi.fn(),
  };
}

function createExportDependencies(): ConversationExportRuntimeHandlerDependencies {
  return {
    baseUrl: 'https://chat.deepseek.com',
    getExtensionVersion: vi.fn(() => '1.10.0'),
    createExportId: vi.fn(() => 'generated-export'),
    loadClientHeaders: vi.fn(async () => ({ Authorization: 'Bearer token' })),
    createTransport: vi.fn(() => ({
      listSessions: vi.fn(async () => []),
      fetchHistory: vi.fn(async () => ({})),
      fetchFiles: vi.fn(async () => []),
    })),
    runExport: vi.fn(async (input) => exportData(input.exportId)),
    buildArtifacts: vi.fn(async () => [{
      format: 'html' as const,
      filename: 'export.html',
      mimeType: 'text/html',
      content: '<html></html>',
    }]),
    broadcastProgress: vi.fn(async () => undefined),
    missingAuthMessage: vi.fn(() => 'Missing DeepSeek auth'),
    generatingMessage: vi.fn(() => 'Generating'),
    cancelledMessage: vi.fn(() => 'Export cancelled'),
  };
}

async function dispatch(
  handlers: readonly RuntimeCommandHandler[],
  message: { type: string; payload?: unknown },
  context: RuntimeMessageContext = extensionContext,
): Promise<unknown> {
  const handler = handlers.find((candidate) => candidate.type === message.type);
  if (!handler) throw new Error(`Missing handler: ${message.type}`);
  return handler.handle(message, context);
}

function officialConfig() {
  return {
    model: 'deepseek-v4-flash' as const,
    thinking: 'disabled' as const,
    reasoningEffort: 'high' as const,
  };
}

function uploadedFile() {
  return {
    id: 'file-1',
    fileName: 'image.png',
    fileSize: 3,
    mimeType: 'image/png',
    status: 'SUCCESS',
    signedPath: null,
    auditResult: 'PASS',
    retryable: false,
    width: 1,
    height: 1,
  };
}

function modelTurn(text: string, responseMessageId: number): ModelTurn {
  return {
    assistantText: text,
    responseMessageId,
    requestMessageId: responseMessageId - 1,
    finished: true,
  };
}

function toolDescriptor(): ToolDescriptor {
  return {
    id: 'local:sample:sample_tool',
    provider: {
      kind: 'local',
      id: 'sample',
      displayName: 'Sample',
      transport: 'in_process',
    },
    name: 'sample_tool',
    invocationName: 'sample_tool',
    title: 'Sample tool',
    description: 'Sample tool.',
    inputSchema: { type: 'object', properties: {} },
    execution: { mode: 'auto', enabled: true, risk: 'low' },
  };
}

function ambiguousToolResult(): ToolResult {
  return {
    ok: false,
    summary: 'response lost',
    error: {
      code: 'tool_response_lost',
      message: 'response lost after dispatch',
      retryable: true,
      details: { externalOutcome: 'ambiguous', retrySafe: false },
    },
  };
}

function exportData(exportId: string): ConversationExport {
  const timestamp = '2026-07-14T00:00:00.000Z';
  return {
    schemaVersion: 'deepseek-pp.conversation-export.v1',
    exportId,
    createdAt: timestamp,
    source: {
      provider: 'deepseek-official-web',
      baseUrl: 'https://chat.deepseek.com',
      endpointVerification: 'static-bundle-and-browser-session',
      fileBodies: 'unsupported-unverified',
    },
    generatedBy: { name: 'DeepSeek++', version: '1.10.0' },
    request: {
      mode: 'sanitized',
      formats: ['html'],
      includeAttachmentMetadata: true,
      includeFileBodies: false,
      pageSize: 50,
    },
    stats: {
      sessionCount: 0,
      messageCount: 0,
      attachmentCount: 0,
      failedSessionCount: 0,
      startedAt: timestamp,
      completedAt: timestamp,
    },
    sessions: [],
    attachments: [],
    failures: [],
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function waitForCall(mock: (...args: never[]) => unknown): Promise<void> {
  await vi.waitFor(() => expect(mock).toHaveBeenCalled());
}

async function waitForCalls(mock: (...args: never[]) => unknown, count: number): Promise<void> {
  await vi.waitFor(() => expect(mock).toHaveBeenCalledTimes(count));
}
