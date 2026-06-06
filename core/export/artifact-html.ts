import { createExportFilename } from './artifact-json';
import type {
  ConversationExport,
  ConversationExportArtifact,
  ExportedAttachment,
  ExportedMessage,
  ExportedSession,
} from './types';

export function createConversationExportHtmlArtifact(exportData: ConversationExport): ConversationExportArtifact {
  return {
    format: 'html',
    filename: createExportFilename(exportData, 'html'),
    mimeType: 'text/html;charset=utf-8',
    content: renderConversationExportHtml(exportData),
  };
}

export function renderConversationExportHtml(exportData: ConversationExport): string {
  const sessions = exportData.sessions.map((session) => renderSession(session, exportData.attachments)).join('\n');
  const attachments = exportData.attachments.length === 0
    ? ''
    : `<section class="section page-break"><h2>Attachment Manifest</h2>${exportData.attachments.map(renderAttachment).join('\n')}</section>`;

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>DeepSeek Conversation Export</title>
<style>
  :root { color-scheme: light; font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Noto Sans SC", "Segoe UI", sans-serif; color: #1d1d1f; background: #ffffff; }
  body { margin: 0; padding: 32px; font-size: 14px; line-height: 1.62; }
  h1, h2, h3 { margin: 0 0 12px; line-height: 1.25; }
  h1 { font-size: 28px; }
  h2 { font-size: 21px; margin-top: 28px; }
  h3 { font-size: 15px; color: #334155; }
  .meta, .attachment { color: #64748b; font-size: 12px; }
  .section { max-width: 920px; margin: 0 auto 28px; }
  .summary { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; margin: 18px 0 26px; }
  .metric { border: 1px solid #e5e7eb; border-radius: 8px; padding: 10px 12px; }
  .metric strong { display: block; font-size: 18px; color: #111827; }
  .message { border-top: 1px solid #e5e7eb; padding: 16px 0; }
  .content { white-space: pre-wrap; overflow-wrap: anywhere; }
  .attachments { margin-top: 10px; padding-left: 18px; color: #475569; }
  .warning { border: 1px solid #fde68a; background: #fffbeb; border-radius: 8px; padding: 10px 12px; color: #92400e; }
  @media print {
    body { padding: 18mm; }
    .page-break { break-before: page; }
  }
</style>
</head>
<body>
<main>
  <section class="section">
    <h1>DeepSeek Conversation Export</h1>
    <div class="meta">Export ID ${escapeHtml(exportData.exportId)} · Created ${escapeHtml(exportData.createdAt)} · Mode ${escapeHtml(exportData.request.mode)}</div>
    <div class="summary">
      <div class="metric"><strong>${exportData.stats.sessionCount}</strong>Sessions</div>
      <div class="metric"><strong>${exportData.stats.messageCount}</strong>Messages</div>
      <div class="metric"><strong>${exportData.stats.attachmentCount}</strong>Attachments</div>
    </div>
    ${renderWarnings(exportData.failures.map((failure) => `${failure.code}: ${failure.message}`))}
  </section>
  ${sessions}
  ${attachments}
</main>
</body>
</html>`;
}

function renderSession(session: ExportedSession, attachments: ExportedAttachment[]): string {
  return `<section class="section page-break">
  <h2>${escapeHtml(session.title)}</h2>
  <div class="meta">Session ${escapeHtml(session.id)} · Updated ${escapeHtml(session.updatedAt ?? 'unknown')} · Model ${escapeHtml(session.modelType ?? 'unknown')}</div>
  ${renderWarnings(session.failures.map((failure) => `${failure.code}: ${failure.message}`))}
  ${session.messages.map((message) => renderMessage(message, attachments)).join('\n')}
</section>`;
}

function renderMessage(message: ExportedMessage, attachments: ExportedAttachment[]): string {
  const attachmentList = message.attachmentRefs.length === 0
    ? ''
    : `<ul class="attachments">${message.attachmentRefs.map((ref) => {
      const attachment = attachments.find((item) => item.id === ref.id);
      const label = attachment?.fileName ?? ref.id;
      const size = attachment?.sizeBytes === null || attachment?.sizeBytes === undefined ? '' : `, ${formatBytes(attachment.sizeBytes)}`;
      return `<li>${escapeHtml(label)} <span class="meta">(${escapeHtml(ref.id)}${escapeHtml(size)})</span></li>`;
    }).join('')}</ul>`;

  return `<article class="message">
  <h3>${escapeHtml(message.role)} · ${escapeHtml(message.createdAt ?? message.id)}</h3>
  <div class="content">${escapeHtml(message.content || 'No text content')}</div>
  ${attachmentList}
</article>`;
}

function renderAttachment(attachment: ExportedAttachment): string {
  return `<div class="attachment">${escapeHtml(attachment.fileName ?? attachment.id)} · id=${escapeHtml(attachment.id)} · status=${escapeHtml(attachment.status)}${attachment.sizeBytes === null ? '' : ` · size=${escapeHtml(formatBytes(attachment.sizeBytes))}`}</div>`;
}

function renderWarnings(warnings: string[]): string {
  if (warnings.length === 0) return '';
  return `<div class="warning">${warnings.map(escapeHtml).join('<br />')}</div>`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
