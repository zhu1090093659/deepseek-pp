import { buildAttachmentManifest, collectAttachmentIds, normalizeDeepSeekFileMetadata } from './attachments';
import { createConversationExportHtmlArtifact } from './artifact-html';
import { createConversationExportMarkdownArtifact } from './artifact-markdown';
import { createConversationExportPdfArtifact } from './artifact-pdf';
import { createConversationImageManifestArtifact } from './secondary-artifacts';
import {
  normalizeConversationExportRequest,
  validateConversationExport,
} from './schema';
import { sanitizeConversationExport } from './sanitize';
import {
  CONVERSATION_EXPORT_SCHEMA_VERSION,
  type ConversationExport,
  type ConversationExportArtifact,
  type ConversationExportFailure,
  type ConversationExportProgress,
  type ConversationExportRequest,
} from './types';
import {
  type DeepSeekSessionSummary,
  normalizeDeepSeekHistory,
} from './normalize';

export interface ConversationExportTransport {
  listSessions(input: {
    pageSize: number;
    sessionLimit?: number;
    includeRaw: boolean;
    signal?: AbortSignal;
  }): Promise<DeepSeekSessionSummary[]>;
  fetchHistory(input: {
    session: DeepSeekSessionSummary;
    includeRaw: boolean;
    signal?: AbortSignal;
  }): Promise<unknown>;
  fetchFiles(input: {
    fileIds: string[];
    includeRaw: boolean;
    signal?: AbortSignal;
  }): Promise<unknown[]>;
}

export interface RunConversationExportInput {
  exportId: string;
  request: unknown;
  transport: ConversationExportTransport;
  extensionVersion: string;
  baseUrl: string;
  now?: () => Date;
  signal?: AbortSignal;
  onProgress?: (progress: ConversationExportProgress) => void | Promise<void>;
}

export async function runConversationExport(input: RunConversationExportInput): Promise<ConversationExport> {
  const request = normalizeConversationExportRequest(input.request);
  const now = input.now ?? (() => new Date());
  const startedAt = now().toISOString();
  const includeRaw = request.mode === 'raw';

  await report(input, 'starting', 'running', 0, 1, '准备导出');
  assertNotCancelled(input.signal);

  const sessionSummaries = await getSessionSummaries(input, request, includeRaw);

  const sessions = [];
  const failures: ConversationExportFailure[] = [];

  for (const [index, session] of sessionSummaries.entries()) {
    assertNotCancelled(input.signal);
    await report(input, 'fetching_history', 'running', index + 1, sessionSummaries.length, `读取会话 ${index + 1}/${sessionSummaries.length}`);
    try {
      const rawHistory = await input.transport.fetchHistory({ session, includeRaw, signal: input.signal });
      assertNotCancelled(input.signal);
      sessions.push(normalizeDeepSeekHistory(session, rawHistory, { includeRaw }));
    } catch (error) {
      rethrowCancellation(error, input.signal);
      failures.push(toFailure(error, {
        code: 'session_history_failed',
        sessionId: session.id,
        retryable: true,
      }));
    }
  }

  const metadataById = new Map();
  const attachmentIds = request.includeAttachmentMetadata ? collectAttachmentIds(sessions) : [];
  if (attachmentIds.length > 0) {
    await report(input, 'fetching_attachments', 'running', 0, attachmentIds.length, '读取附件元数据');
    try {
      const rawFiles = await input.transport.fetchFiles({ fileIds: attachmentIds, includeRaw, signal: input.signal });
      assertNotCancelled(input.signal);
      for (const rawFile of rawFiles) {
        assertNotCancelled(input.signal);
        const attachment = normalizeDeepSeekFileMetadata(rawFile, includeRaw);
        if (attachment) metadataById.set(attachment.id, attachment);
      }
      await report(input, 'fetching_attachments', 'running', attachmentIds.length, attachmentIds.length, '附件元数据读取完成');
    } catch (error) {
      rethrowCancellation(error, input.signal);
      failures.push(toFailure(error, {
        code: 'attachment_metadata_failed',
        retryable: true,
      }));
    }
  }

  const attachments = request.includeAttachmentMetadata
    ? buildAttachmentManifest(sessions, metadataById, { includeRaw })
    : [];
  const completedAt = now().toISOString();
  const messageCount = sessions.reduce((total, session) => total + session.messages.length, 0);
  const failedSessionCount = failures.filter((failure) => failure.code === 'session_history_failed').length;

  const exportData: ConversationExport = {
    schemaVersion: CONVERSATION_EXPORT_SCHEMA_VERSION,
    exportId: input.exportId,
    createdAt: completedAt,
    source: {
      provider: 'deepseek-official-web',
      baseUrl: input.baseUrl,
      endpointVerification: 'static-bundle-and-browser-session',
      fileBodies: 'unsupported-unverified',
    },
    generatedBy: {
      name: 'DeepSeek++',
      version: input.extensionVersion,
    },
    request,
    stats: {
      sessionCount: sessions.length,
      messageCount,
      attachmentCount: attachments.length,
      failedSessionCount,
      startedAt,
      completedAt,
    },
    sessions,
    attachments,
    failures,
  };

  const finalExport = request.mode === 'sanitized' ? sanitizeConversationExport(exportData) : exportData;
  assertNotCancelled(input.signal);
  await report(input, 'completed', 'completed', 1, 1, '导出完成');
  assertNotCancelled(input.signal);
  return validateConversationExport(finalExport);
}

async function getSessionSummaries(
  input: RunConversationExportInput,
  request: ConversationExportRequest,
  includeRaw: boolean,
): Promise<DeepSeekSessionSummary[]> {
  if (request.sessionIds?.length) {
    await report(input, 'listing_sessions', 'running', 0, request.sessionIds.length, '读取当前会话');
    return request.sessionIds.map((id) => ({
      id,
      title: '当前对话',
      pinned: false,
      titleType: null,
      modelType: null,
      createdAt: null,
      updatedAt: null,
      ...(includeRaw ? { raw: { id, source: 'deepseek-pp-requested-session' } } : {}),
    }));
  }

  await report(input, 'listing_sessions', 'running', 0, 1, '读取会话列表');
  return input.transport.listSessions({
    pageSize: request.pageSize ?? 50,
    sessionLimit: request.sessionLimit,
    includeRaw,
    signal: input.signal,
  });
}

export function buildConversationExportArtifacts(exportData: ConversationExport): ConversationExportArtifact[] {
  const artifacts: ConversationExportArtifact[] = [];
  for (const format of exportData.request.formats) {
    artifacts.push(createConversationExportArtifact(exportData, format));
  }
  return artifacts;
}

export async function buildConversationExportArtifactsCancellable(
  exportData: ConversationExport,
  signal?: AbortSignal,
): Promise<ConversationExportArtifact[]> {
  const artifacts: ConversationExportArtifact[] = [];
  for (const format of exportData.request.formats) {
    await yieldToRuntime();
    assertNotCancelled(signal);
    artifacts.push(createConversationExportArtifact(exportData, format));
    await yieldToRuntime();
    assertNotCancelled(signal);
  }
  return artifacts;
}

function createConversationExportArtifact(
  exportData: ConversationExport,
  format: ConversationExportRequest['formats'][number],
): ConversationExportArtifact {
  if (format === 'markdown') return createConversationExportMarkdownArtifact(exportData);
  if (format === 'pdf') return createConversationExportPdfArtifact(exportData);
  if (format === 'image_manifest') return createConversationImageManifestArtifact(exportData);
  return createConversationExportHtmlArtifact(exportData);
}

function yieldToRuntime(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function report(
  input: RunConversationExportInput,
  phase: ConversationExportProgress['phase'],
  status: ConversationExportProgress['status'],
  current: number,
  total: number,
  message: string,
) {
  assertNotCancelled(input.signal);
  await input.onProgress?.({
    exportId: input.exportId,
    phase,
    status,
    current,
    total,
    message,
  });
  assertNotCancelled(input.signal);
}

function assertNotCancelled(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw new DOMException('Conversation export was cancelled.', 'AbortError');
  }
}

function rethrowCancellation(error: unknown, signal?: AbortSignal): void {
  if (signal?.aborted) assertNotCancelled(signal);
  if (error instanceof DOMException && error.name === 'AbortError') throw error;
  if (error instanceof Error && error.name === 'AbortError') throw error;
}

function toFailure(
  error: unknown,
  fallback: { code: string; sessionId?: string; endpoint?: string; retryable: boolean },
): ConversationExportFailure {
  const value = error as { code?: unknown; endpoint?: unknown; retryable?: unknown; message?: unknown };
  return {
    code: typeof value?.code === 'string' ? value.code : fallback.code,
    message: error instanceof Error ? error.message : String(error),
    sessionId: fallback.sessionId,
    endpoint: typeof value?.endpoint === 'string' ? value.endpoint : fallback.endpoint,
    retryable: typeof value?.retryable === 'boolean' ? value.retryable : fallback.retryable,
  };
}
