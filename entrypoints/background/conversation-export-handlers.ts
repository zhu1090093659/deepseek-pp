import type { RuntimeMessageContext } from '../../core/messaging/runtime-boundary';
import type {
  NormalizedConversationExportCommand,
} from '../../core/messaging/deepseek-runtime-contracts';
import type { RuntimeCommandHandler } from '../../core/messaging/runtime-command-registry';
import type {
  ConversationExport,
  ConversationExportArtifact,
  ConversationExportProgress,
  ConversationExportResult,
} from '../../core/export/types';
import type {
  ConversationExportTransport,
  RunConversationExportInput,
} from '../../core/export/service';
import { defineDeepSeekPayloadRuntimeCommandHandler } from './runtime-handler';

interface ActiveConversationExport {
  ownerDocumentSessionId: string;
  excludeTabId?: number;
  controller: AbortController;
  state: 'running' | 'cancelling' | 'failed' | 'completed';
  progressTail: Promise<void>;
  terminalNotification?: Promise<void>;
}

export interface ConversationExportRuntimeHandlerDependencies {
  baseUrl: string;
  getExtensionVersion(): string;
  createExportId(): string;
  loadClientHeaders(preferredTabId?: number): Promise<Record<string, string> | null>;
  createTransport(input: {
    baseUrl: string;
    clientHeaders: Record<string, string>;
  }): ConversationExportTransport;
  runExport(input: RunConversationExportInput): Promise<ConversationExport>;
  buildArtifacts(
    exportData: ConversationExport,
    signal: AbortSignal,
  ): Promise<ConversationExportArtifact[]>;
  broadcastProgress(
    progress: ConversationExportProgress,
    excludeTabId?: number,
  ): Promise<void>;
  missingAuthMessage(): string;
  generatingMessage(): string;
  cancelledMessage(): string;
}

export function createConversationExportRuntimeHandlers(
  dependencies: ConversationExportRuntimeHandlerDependencies,
): readonly RuntimeCommandHandler[] {
  const activeExports = new Map<string, ActiveConversationExport>();

  const publishProgress = (
    entry: ActiveConversationExport,
    progress: ConversationExportProgress,
    requiredState: ActiveConversationExport['state'] = 'running',
  ): Promise<void> => {
    const operation = entry.progressTail.then(async () => {
      if (entry.state !== requiredState) {
        throw new DOMException('Conversation export is no longer active.', 'AbortError');
      }
      await dependencies.broadcastProgress(progress, entry.excludeTabId);
    });
    // `operation` is returned to the caller, which observes its failure. The
    // private tail must settle so a later terminal notification can still run.
    entry.progressTail = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  };

  const notifyCancelled = async (
    exportId: string,
    entry: ActiveConversationExport,
  ): Promise<void> => {
    entry.terminalNotification ??= publishProgress(entry, {
        exportId,
        phase: 'cancelled',
        status: 'cancelled',
        current: 0,
        total: 0,
        message: dependencies.cancelledMessage(),
      }, 'cancelling');
    await entry.terminalNotification;
  };

  const runExport = async (
    payload: NormalizedConversationExportCommand,
    context: RuntimeMessageContext,
  ): Promise<ConversationExportResult | { ok: false; exportId: string; error: string }> => {
    const exportId = payload.exportId ?? dependencies.createExportId();
    if (activeExports.has(exportId)) {
      return { ok: false, exportId, error: 'export_already_running' };
    }

    const entry: ActiveConversationExport = {
      ownerDocumentSessionId: context.documentSessionId,
      excludeTabId: context.tabId,
      controller: new AbortController(),
      state: 'running',
      progressTail: Promise.resolve(),
    };
    activeExports.set(exportId, entry);

    try {
      const headers = await dependencies.loadClientHeaders(context.tabId);
      assertExportActive(entry);
      if (!headers) {
        return { ok: false, exportId, error: dependencies.missingAuthMessage() };
      }

      const exportData = await dependencies.runExport({
        exportId,
        request: payload.request,
        baseUrl: dependencies.baseUrl,
        extensionVersion: dependencies.getExtensionVersion(),
        signal: entry.controller.signal,
        transport: dependencies.createTransport({
          baseUrl: dependencies.baseUrl,
          clientHeaders: headers,
        }),
        onProgress: async (progress) => {
          assertExportActive(entry);
          await publishProgress(entry, progress);
          assertExportActive(entry);
        },
      });

      assertExportActive(entry);
      await publishProgress(entry, {
        exportId,
        phase: 'formatting',
        status: 'running',
        current: 0,
        total: payload.request.formats.length,
        message: dependencies.generatingMessage(),
      });
      assertExportActive(entry);

      const artifacts = await dependencies.buildArtifacts(exportData, entry.controller.signal);
      assertExportActive(entry);
      entry.state = 'completed';
      return {
        ok: true,
        exportId,
        summary: exportData.stats,
        artifacts,
      };
    } catch (error) {
      if (entry.controller.signal.aborted || entry.state === 'cancelling') {
        entry.state = 'cancelling';
        await notifyCancelled(exportId, entry);
        return { ok: false, exportId, error: dependencies.cancelledMessage() };
      }

      const message = error instanceof Error ? error.message : String(error);
      entry.state = 'failed';
      entry.terminalNotification = publishProgress(entry, {
        exportId,
        phase: 'failed',
        status: 'failed',
        current: 0,
        total: 0,
        message,
      }, 'failed');
      await entry.terminalNotification;
      return { ok: false, exportId, error: message };
    } finally {
      if (activeExports.get(exportId) === entry) activeExports.delete(exportId);
    }
  };

  return Object.freeze([
    defineDeepSeekPayloadRuntimeCommandHandler(
      'EXPORT_DEEPSEEK_CONVERSATIONS',
      runExport,
    ),
    defineDeepSeekPayloadRuntimeCommandHandler('CANCEL_DEEPSEEK_EXPORT', async (payload, context) => {
      if (!payload.exportId) return { ok: false as const, error: 'missing_export_id' };
      const entry = activeExports.get(payload.exportId);
      if (!entry || entry.ownerDocumentSessionId !== context.documentSessionId) {
        return { ok: false as const, error: 'export_not_running' };
      }
      if (entry.state === 'cancelling') {
        await notifyCancelled(payload.exportId, entry);
        return { ok: true as const };
      }
      if (entry.state !== 'running') {
        return { ok: false as const, error: 'export_not_running' };
      }

      entry.state = 'cancelling';
      entry.controller.abort(new DOMException('Conversation export was cancelled.', 'AbortError'));
      await notifyCancelled(payload.exportId, entry);
      return { ok: true as const };
    }),
  ]);
}

function assertExportActive(entry: ActiveConversationExport): void {
  if (!entry.controller.signal.aborted) return;
  if (entry.controller.signal.reason instanceof Error) throw entry.controller.signal.reason;
  throw new DOMException('Conversation export was cancelled.', 'AbortError');
}
