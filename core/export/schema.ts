import {
  CONVERSATION_EXPORT_SCHEMA_VERSION,
  type ConversationExport,
  type ConversationExportFormat,
  type ConversationExportRequest,
} from './types';

const DEFAULT_FORMATS: ConversationExportFormat[] = ['html'];
const SUPPORTED_FORMATS = new Set<ConversationExportFormat>(['markdown', 'html', 'pdf', 'image_manifest']);
const DEFAULT_PAGE_SIZE = 50;
const MIN_PAGE_SIZE = 1;
const MAX_PAGE_SIZE = 100;
const MAX_SESSION_ID_COUNT = 100;

export class ConversationExportValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConversationExportValidationError';
  }
}

export function normalizeConversationExportRequest(input: unknown): ConversationExportRequest {
  const value = isRecord(input) ? input : {};
  const mode = normalizeMode(value.mode);
  const requestedFormats = normalizeFormats(value.formats);

  const formats = dedupeFormats(requestedFormats);
  const pageSize = normalizeOptionalInteger(value.pageSize, 'pageSize', MIN_PAGE_SIZE, MAX_PAGE_SIZE)
    ?? DEFAULT_PAGE_SIZE;
  const sessionLimit = normalizeOptionalInteger(value.sessionLimit, 'sessionLimit', 1, Number.MAX_SAFE_INTEGER);
  const sessionIds = normalizeSessionIds(value.sessionIds);
  const includeFileBodies = value.includeFileBodies === true;
  if (includeFileBodies) {
    throw new ConversationExportValidationError(
      '文件正文导出尚未启用：官方文件下载端点、签名 URL、CORS 和大文件行为还没有完成验证。',
    );
  }

  return {
    mode,
    formats,
    includeAttachmentMetadata: value.includeAttachmentMetadata !== false,
    includeFileBodies: false,
    pageSize,
    ...(sessionLimit === undefined ? {} : { sessionLimit }),
    ...(sessionIds === undefined ? {} : { sessionIds }),
  };
}

export function validateConversationExport(exportData: ConversationExport): ConversationExport {
  if (!isRecord(exportData)) throw new ConversationExportValidationError('Conversation export must be an object.');
  if (exportData.schemaVersion !== CONVERSATION_EXPORT_SCHEMA_VERSION) {
    throw new ConversationExportValidationError(`Unsupported conversation export schema: ${String(exportData.schemaVersion)}`);
  }
  assertNonEmptyString(exportData.exportId, 'exportId');
  assertNonEmptyString(exportData.createdAt, 'createdAt');
  if (!Array.isArray(exportData.sessions)) throw new ConversationExportValidationError('sessions must be an array.');
  if (!Array.isArray(exportData.attachments)) throw new ConversationExportValidationError('attachments must be an array.');
  if (!Array.isArray(exportData.failures)) throw new ConversationExportValidationError('failures must be an array.');
  for (const session of exportData.sessions) {
    assertNonEmptyString(session.id, 'session.id');
    if (!Array.isArray(session.messages)) throw new ConversationExportValidationError(`session ${session.id} messages must be an array.`);
    for (const message of session.messages) {
      assertNonEmptyString(message.id, `session ${session.id} message.id`);
      if (!Array.isArray(message.attachmentRefs)) {
        throw new ConversationExportValidationError(`message ${message.id} attachmentRefs must be an array.`);
      }
    }
  }
  return exportData;
}

function normalizeMode(value: unknown): ConversationExportRequest['mode'] {
  if (value === undefined || value === null || value === '') return 'sanitized';
  if (value === 'raw' || value === 'sanitized') return value;
  throw new ConversationExportValidationError('mode must be either raw or sanitized.');
}

function normalizeFormats(value: unknown): ConversationExportFormat[] {
  if (value === undefined || value === null) return DEFAULT_FORMATS;
  if (!Array.isArray(value) || value.length === 0) {
    throw new ConversationExportValidationError('formats must include at least one supported format.');
  }
  return mapDenseArray(value, 'formats', (format) => {
    if (typeof format === 'string' && SUPPORTED_FORMATS.has(format as ConversationExportFormat)) {
      return format as ConversationExportFormat;
    }
    throw new ConversationExportValidationError(`Unsupported export format: ${String(format)}.`);
  });
}

function dedupeFormats(formats: ConversationExportFormat[]): ConversationExportFormat[] {
  return formats.filter((format, index) => formats.indexOf(format) === index);
}

function normalizeOptionalInteger(
  value: unknown,
  field: string,
  min: number,
  max: number,
): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw new ConversationExportValidationError(`${field} must be an integer between ${min} and ${max}.`);
  }
  return value;
}

function normalizeSessionIds(value: unknown): string[] | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_SESSION_ID_COUNT) {
    throw new ConversationExportValidationError(`sessionIds must include 1-${MAX_SESSION_ID_COUNT} non-empty strings.`);
  }

  const ids = mapDenseArray(value, 'sessionIds', (item) => {
    if (typeof item !== 'string' || !item.trim()) {
      throw new ConversationExportValidationError('sessionIds must include only non-empty strings.');
    }
    return item.trim();
  });
  return ids.filter((id, index) => ids.indexOf(id) === index);
}

function mapDenseArray<T>(
  value: unknown[],
  field: string,
  mapItem: (item: unknown, index: number) => T,
): T[] {
  const result: T[] = [];
  for (let index = 0; index < value.length; index++) {
    if (!Object.prototype.hasOwnProperty.call(value, index)) {
      throw new ConversationExportValidationError(`${field} must not contain empty items.`);
    }
    result.push(mapItem(value[index], index));
  }
  return result;
}

function assertNonEmptyString(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ConversationExportValidationError(`${field} must be a non-empty string.`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
