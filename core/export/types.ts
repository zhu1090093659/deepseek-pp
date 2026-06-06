export const CONVERSATION_EXPORT_SCHEMA_VERSION = 'deepseek-pp.conversation-export.v1' as const;

export type ConversationExportSchemaVersion = typeof CONVERSATION_EXPORT_SCHEMA_VERSION;

export type ConversationExportMode = 'raw' | 'sanitized';

export type ConversationExportFormat = 'json' | 'markdown' | 'html';

export type ExportProgressPhase =
  | 'starting'
  | 'listing_sessions'
  | 'fetching_history'
  | 'fetching_attachments'
  | 'formatting'
  | 'completed'
  | 'cancelled'
  | 'failed';

export interface ConversationExportRequest {
  mode: ConversationExportMode;
  formats: ConversationExportFormat[];
  includeAttachmentMetadata: boolean;
  includeFileBodies: boolean;
  pageSize?: number;
  sessionLimit?: number;
}

export interface ConversationExportSource {
  provider: 'deepseek-official-web';
  baseUrl: string;
  endpointVerification: 'static-bundle-and-browser-session';
  fileBodies: 'unsupported-unverified';
}

export interface ConversationExportGenerator {
  name: 'DeepSeek++';
  version: string;
}

export interface ConversationExportStats {
  sessionCount: number;
  messageCount: number;
  attachmentCount: number;
  failedSessionCount: number;
  startedAt: string;
  completedAt: string;
}

export interface ConversationExportFailure {
  code: string;
  message: string;
  sessionId?: string;
  endpoint?: string;
  retryable: boolean;
}

export interface ExportedSession {
  id: string;
  title: string;
  pinned: boolean;
  titleType: string | null;
  modelType: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  messages: ExportedMessage[];
  failures: ConversationExportFailure[];
  raw?: unknown;
}

export interface ExportedMessage {
  id: string;
  parentId: string | null;
  role: ExportedMessageRole;
  content: string;
  contentFragments: ExportedContentFragment[];
  createdAt: string | null;
  updatedAt: string | null;
  modelType: string | null;
  searchEnabled: boolean | null;
  thinkingEnabled: boolean | null;
  attachmentRefs: ExportedAttachmentRef[];
  raw?: unknown;
}

export type ExportedMessageRole = 'user' | 'assistant' | 'system' | 'tool' | 'unknown';

export interface ExportedContentFragment {
  kind: 'text' | 'reasoning' | 'tool' | 'unknown';
  text: string;
}

export interface ExportedAttachmentRef {
  id: string;
  role: 'referenced' | 'uploaded' | 'generated' | 'unknown';
}

export interface ExportedAttachment {
  id: string;
  fileName: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  status: ExportedAttachmentStatus;
  sourceMessageIds: string[];
  signedPath?: string | null;
  auditResult?: string | null;
  raw?: unknown;
}

export type ExportedAttachmentStatus =
  | 'referenced'
  | 'metadata_available'
  | 'metadata_unavailable'
  | 'body_export_unsupported'
  | 'failed';

export interface ConversationExport {
  schemaVersion: ConversationExportSchemaVersion;
  exportId: string;
  createdAt: string;
  source: ConversationExportSource;
  generatedBy: ConversationExportGenerator;
  request: ConversationExportRequest;
  stats: ConversationExportStats;
  sessions: ExportedSession[];
  attachments: ExportedAttachment[];
  failures: ConversationExportFailure[];
}

export interface ConversationExportArtifact {
  format: ConversationExportFormat;
  filename: string;
  mimeType: string;
  content: string;
}

export interface ConversationExportProgress {
  exportId: string;
  phase: ExportProgressPhase;
  status: 'running' | 'completed' | 'cancelled' | 'failed';
  current: number;
  total: number;
  message: string;
}

export interface ConversationExportResult {
  ok: true;
  exportId: string;
  summary: ConversationExportStats;
  artifacts: ConversationExportArtifact[];
}

export interface ConversationExportErrorResult {
  ok: false;
  exportId?: string;
  error: string;
}
