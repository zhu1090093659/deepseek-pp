import { validateConversationExport } from './schema';
import type { ConversationExport, ConversationExportArtifact } from './types';

export function createConversationExportJsonArtifact(exportData: ConversationExport): ConversationExportArtifact {
  const validated = validateConversationExport(exportData);
  return {
    format: 'json',
    filename: createExportFilename(validated, 'json'),
    mimeType: 'application/json;charset=utf-8',
    content: `${JSON.stringify(validated, null, 2)}\n`,
  };
}

export function createExportFilename(exportData: ConversationExport, extension: string): string {
  const stamp = exportData.createdAt.replace(/[:.]/g, '-').slice(0, 19);
  return `deepseek-conversations-${exportData.request.mode}-${stamp}.${extension}`;
}
