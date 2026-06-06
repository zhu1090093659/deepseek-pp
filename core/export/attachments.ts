import type {
  ExportedAttachment,
  ExportedAttachmentStatus,
  ExportedMessage,
  ExportedSession,
} from './types';

export function collectAttachmentIds(sessions: ExportedSession[]): string[] {
  const ids = new Set<string>();
  for (const session of sessions) {
    for (const message of session.messages) {
      for (const ref of message.attachmentRefs) ids.add(ref.id);
    }
  }
  return [...ids].sort();
}

export function buildAttachmentManifest(
  sessions: ExportedSession[],
  metadataById: Map<string, ExportedAttachment>,
  options: { includeRaw: boolean },
): ExportedAttachment[] {
  const sourceMessageIds = collectAttachmentSourceMessageIds(sessions);
  const attachments: ExportedAttachment[] = [];

  for (const [id, messageIds] of sourceMessageIds) {
    const metadata = metadataById.get(id);
    if (metadata) {
      attachments.push({
        ...metadata,
        sourceMessageIds: messageIds,
        status: normalizeMetadataStatus(metadata.status),
        ...(!options.includeRaw ? { raw: undefined, signedPath: undefined } : {}),
      });
      continue;
    }

    attachments.push({
      id,
      fileName: null,
      mimeType: null,
      sizeBytes: null,
      status: 'metadata_unavailable',
      sourceMessageIds: messageIds,
    });
  }

  return attachments.sort((a, b) => a.id.localeCompare(b.id));
}

export function normalizeDeepSeekFileMetadata(raw: unknown, includeRaw: boolean): ExportedAttachment | null {
  const value = asRecord(raw);
  const id = firstString(value.id, value.file_id, value.fileId);
  if (!id) return null;

  return {
    id,
    fileName: firstString(value.file_name, value.fileName, value.name),
    mimeType: firstString(value.mime_type, value.mimeType, value.type),
    sizeBytes: coerceNullableNumber(value.file_size, value.fileSize, value.size),
    status: firstString(value.status) ? 'metadata_available' : 'metadata_available',
    sourceMessageIds: [],
    signedPath: firstString(value.signed_path, value.signedPath),
    auditResult: firstString(value.audit_result, value.auditResult),
    ...(includeRaw ? { raw } : {}),
  };
}

function collectAttachmentSourceMessageIds(sessions: ExportedSession[]): Map<string, string[]> {
  const result = new Map<string, Set<string>>();
  for (const session of sessions) {
    for (const message of session.messages) {
      addMessageAttachmentRefs(result, message);
    }
  }
  return new Map([...result.entries()].map(([id, messageIds]) => [id, [...messageIds].sort()]));
}

function addMessageAttachmentRefs(result: Map<string, Set<string>>, message: ExportedMessage) {
  for (const ref of message.attachmentRefs) {
    const existing = result.get(ref.id) ?? new Set<string>();
    existing.add(message.id);
    result.set(ref.id, existing);
  }
}

function normalizeMetadataStatus(status: ExportedAttachmentStatus): ExportedAttachmentStatus {
  if (status === 'failed' || status === 'body_export_unsupported') return status;
  return 'metadata_available';
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return null;
}

function coerceNullableNumber(...values: unknown[]): number | null {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim()) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
