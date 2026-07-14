export const HISTORY_ORGANIZER_SCHEMA_VERSION = 1 as const;

export interface HistoryOrganizerState {
  schemaVersion: typeof HISTORY_ORGANIZER_SCHEMA_VERSION;
  tagsBySessionId: Record<string, string[]>;
}

export function createEmptyHistoryOrganizerState(): HistoryOrganizerState {
  return {
    schemaVersion: HISTORY_ORGANIZER_SCHEMA_VERSION,
    tagsBySessionId: {},
  };
}

export function decodeHistoryOrganizerState(
  value: unknown,
  path = 'historyOrganizer',
): HistoryOrganizerState {
  const object = recordValue(value, path);
  if (object.schemaVersion !== undefined && object.schemaVersion !== HISTORY_ORGANIZER_SCHEMA_VERSION) {
    throw new Error(`${path}.schemaVersion is not supported`);
  }
  const rawTags = recordValue(object.tagsBySessionId, `${path}.tagsBySessionId`);
  const tagEntries = Object.entries(rawTags).map(([sessionId, tags]) => {
    if (!sessionId) throw new Error(`${path}.tagsBySessionId contains an empty session id`);
    return [sessionId, decodeTagArray(tags, `${path}.tagsBySessionId.${sessionId}`)] as const;
  });
  const tagsBySessionId = Object.fromEntries(tagEntries) as Record<string, string[]>;
  return {
    ...object,
    schemaVersion: HISTORY_ORGANIZER_SCHEMA_VERSION,
    tagsBySessionId,
  } as HistoryOrganizerState;
}

export function normalizeHistoryTags(value: readonly string[]): string[] {
  return [...new Set(value
    .flatMap((item) => item.split(','))
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 12))];
}

function decodeTagArray(value: unknown, path: string): string[] {
  if (!Array.isArray(value)) throw new Error(`${path} must be a string array`);
  const tags = value.map((item, index) => {
    if (typeof item !== 'string') throw new Error(`${path}[${index}] must be a string`);
    return item;
  });
  return normalizeHistoryTags(tags);
}

function recordValue(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${path} must be an object`);
  }
  return value as Record<string, unknown>;
}
