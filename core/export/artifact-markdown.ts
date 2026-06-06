import { createExportFilename } from './artifact-json';
import type {
  ConversationExport,
  ConversationExportArtifact,
  ExportedAttachment,
  ExportedMessage,
  ExportedSession,
} from './types';

export function createConversationExportMarkdownArtifact(exportData: ConversationExport): ConversationExportArtifact {
  return {
    format: 'markdown',
    filename: createExportFilename(exportData, 'md'),
    mimeType: 'text/markdown;charset=utf-8',
    content: renderConversationExportMarkdown(exportData),
  };
}

export function renderConversationExportMarkdown(exportData: ConversationExport): string {
  const lines: string[] = [
    '# DeepSeek Conversation Export',
    '',
    `- Export ID: ${exportData.exportId}`,
    `- Created: ${exportData.createdAt}`,
    `- Mode: ${exportData.request.mode}`,
    `- Sessions: ${exportData.stats.sessionCount}`,
    `- Messages: ${exportData.stats.messageCount}`,
    `- Attachments: ${exportData.stats.attachmentCount}`,
    '',
  ];

  if (exportData.failures.length > 0) {
    lines.push('## Export Warnings', '');
    for (const failure of exportData.failures) {
      lines.push(`- ${failure.code}: ${failure.message}`);
    }
    lines.push('');
  }

  for (const session of exportData.sessions) {
    lines.push(...renderSession(session, exportData.attachments), '');
  }

  if (exportData.attachments.length > 0) {
    lines.push('## Attachment Manifest', '');
    for (const attachment of exportData.attachments) {
      lines.push(renderAttachment(attachment));
    }
    lines.push('');
  }

  return `${lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n`;
}

function renderSession(session: ExportedSession, attachments: ExportedAttachment[]): string[] {
  const lines: string[] = [
    `## ${escapeMarkdownHeading(session.title)}`,
    '',
    `- Session ID: ${session.id}`,
    `- Updated: ${session.updatedAt ?? 'unknown'}`,
    `- Model: ${session.modelType ?? 'unknown'}`,
    '',
  ];

  if (session.failures.length > 0) {
    lines.push('### Session Warnings', '');
    for (const failure of session.failures) lines.push(`- ${failure.code}: ${failure.message}`);
    lines.push('');
  }

  for (const message of session.messages) {
    lines.push(...renderMessage(message, attachments), '');
  }

  return lines;
}

function renderMessage(message: ExportedMessage, attachments: ExportedAttachment[]): string[] {
  const lines = [
    `### ${message.role} · ${message.createdAt ?? message.id}`,
    '',
    message.content || '_No text content_',
  ];

  if (message.attachmentRefs.length > 0) {
    lines.push('', 'Attachments:');
    for (const ref of message.attachmentRefs) {
      const attachment = attachments.find((item) => item.id === ref.id);
      const label = attachment?.fileName ?? ref.id;
      const size = attachment?.sizeBytes === null || attachment?.sizeBytes === undefined
        ? ''
        : `, ${formatBytes(attachment.sizeBytes)}`;
      lines.push(`- ${label} (${ref.id}${size})`);
    }
  }

  return lines;
}

function renderAttachment(attachment: ExportedAttachment): string {
  const parts = [
    attachment.fileName ?? attachment.id,
    `id=${attachment.id}`,
    `status=${attachment.status}`,
    attachment.sizeBytes === null ? null : `size=${formatBytes(attachment.sizeBytes)}`,
    attachment.mimeType ? `type=${attachment.mimeType}` : null,
    attachment.sourceMessageIds.length > 0 ? `messages=${attachment.sourceMessageIds.join(',')}` : null,
  ].filter((part): part is string => Boolean(part));
  return `- ${parts.join('; ')}`;
}

function escapeMarkdownHeading(text: string): string {
  return text.replace(/\s+/g, ' ').trim().replace(/^#+\s*/, '') || '未命名对话';
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
