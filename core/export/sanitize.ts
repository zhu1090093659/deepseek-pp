import { stripToolCalls } from '../interceptor/tool-parser';
import { sanitizeInternalPromptText } from '../prompt';
import type {
  ConversationExport,
  ExportedContentFragment,
  ExportedMessage,
  ExportedSession,
} from './types';

export function sanitizeConversationExport(exportData: ConversationExport): ConversationExport {
  return {
    ...exportData,
    request: { ...exportData.request, mode: 'sanitized' },
    sessions: exportData.sessions.map(sanitizeSession),
    attachments: exportData.attachments.map((attachment) => {
      const { raw: _raw, signedPath: _signedPath, ...safeAttachment } = attachment;
      return safeAttachment;
    }),
  };
}

export function sanitizeExportText(text: string): string {
  return stripToolCalls(sanitizeInternalPromptText(text)).trim();
}

function sanitizeSession(session: ExportedSession): ExportedSession {
  const { raw: _raw, ...safeSession } = session;
  return {
    ...safeSession,
    messages: safeSession.messages.map(sanitizeMessage),
  };
}

function sanitizeMessage(message: ExportedMessage): ExportedMessage {
  const { raw: _raw, ...safeMessage } = message;
  const contentFragments = safeMessage.contentFragments
    .map(sanitizeFragment)
    .filter((fragment) => fragment.text.length > 0);

  return {
    ...safeMessage,
    content: sanitizeExportText(safeMessage.content),
    contentFragments,
  };
}

function sanitizeFragment(fragment: ExportedContentFragment): ExportedContentFragment {
  return {
    ...fragment,
    text: sanitizeExportText(fragment.text),
  };
}
