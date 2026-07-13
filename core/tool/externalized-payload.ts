import type { ToolCall, ToolError, ToolPayload } from './types';

const EXTERNALIZED_TOOL_PAYLOAD_MARKER = '__dppExternalToolPayload';
const EXTERNALIZED_TOOL_PAYLOAD_VERSION = 1 as const;
const EXTERNALIZED_TOOL_PAYLOAD_TTL_MS = 30 * 60 * 1000;

export interface ExternalizedToolPayload {
  [key: string]: unknown;
  [EXTERNALIZED_TOOL_PAYLOAD_MARKER]: true;
  version: typeof EXTERNALIZED_TOOL_PAYLOAD_VERSION;
  ref: string;
  invocationName: string;
  createdAt: number;
}

type ExternalizedToolPayloadEntry = {
  invocationName: string;
  chunks: string[];
  createdAt: number;
};

const payloadEntries = new Map<string, ExternalizedToolPayloadEntry>();

export function chainExternalizedPayloadWrite(
  previous: Promise<void>,
  write: () => Promise<void>,
): Promise<void> {
  // A missing middle chunk can still leave syntactically valid JSON. Keep the
  // first failure sticky so execution observes it and never rehydrates a
  // silently truncated payload.
  return previous.then(write);
}

export function createExternalizedToolPayload(ref: string, invocationName: string): ExternalizedToolPayload {
  return {
    [EXTERNALIZED_TOOL_PAYLOAD_MARKER]: true,
    version: EXTERNALIZED_TOOL_PAYLOAD_VERSION,
    ref,
    invocationName,
    createdAt: Date.now(),
  };
}

export function isExternalizedToolPayload(value: unknown): value is ExternalizedToolPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const payload = value as Record<string, unknown>;
  return payload[EXTERNALIZED_TOOL_PAYLOAD_MARKER] === true &&
    payload.version === EXTERNALIZED_TOOL_PAYLOAD_VERSION &&
    typeof payload.ref === 'string' &&
    typeof payload.invocationName === 'string' &&
    typeof payload.createdAt === 'number';
}

export function isExternalizedToolPayloadCall(call: ToolCall): boolean {
  return isExternalizedToolPayload(call.payload);
}

export function appendExternalizedToolPayloadChunk(
  ref: string,
  invocationName: string,
  chunk: string,
  namespace?: string,
): void {
  pruneExpiredExternalizedPayloads();
  const key = createPayloadEntryKey(ref, namespace);
  const existing = payloadEntries.get(key);
  if (existing) {
    if (existing.invocationName !== invocationName) {
      throw new Error(`Externalized tool payload ${ref} is already bound to another invocation.`);
    }
    existing.chunks.push(chunk);
    return;
  }

  payloadEntries.set(key, {
    invocationName,
    chunks: [chunk],
    createdAt: Date.now(),
  });
}

export function takeExternalizedToolPayloadText(
  ref: string,
  invocationName: string,
  namespace?: string,
): string | null {
  pruneExpiredExternalizedPayloads();
  const key = createPayloadEntryKey(ref, namespace);
  const entry = payloadEntries.get(key);
  if (!entry) return null;
  payloadEntries.delete(key);
  if (entry.invocationName !== invocationName) return null;
  return entry.chunks.join('');
}

export function clearExternalizedToolPayloadNamespace(namespace: string): void {
  const prefix = `${namespace}\u0000`;
  for (const key of payloadEntries.keys()) {
    if (key.startsWith(prefix)) payloadEntries.delete(key);
  }
}

export function parseExternalizedToolPayload(
  body: string,
  invocationName: string,
): { payload: ToolPayload | null; parseError?: ToolError } {
  try {
    const parsed = body.length === 0 ? {} : JSON.parse(body);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {
        payload: null,
        parseError: createExternalizedToolParseError(
          invocationName,
          'Tool call body must be a JSON object.',
        ),
      };
    }
    return { payload: parsed as ToolPayload };
  } catch (error) {
    return {
      payload: null,
      parseError: createExternalizedToolParseError(
        invocationName,
        [
          'Tool call body is not valid JSON.',
          'Use double quotes for strings and escape backslashes in local file paths, for example "D:\\\\project\\\\file.txt" or "D:/project/file.txt".',
          error instanceof Error ? error.message : String(error),
        ].join(' '),
      ),
    };
  }
}

function createExternalizedToolParseError(
  invocationName: string,
  message: string,
): ToolError {
  return {
    code: 'tool_call_external_payload_invalid',
    message,
    retryable: false,
    details: { invocationName },
  };
}

function pruneExpiredExternalizedPayloads(): void {
  const now = Date.now();
  for (const [ref, entry] of payloadEntries.entries()) {
    if (now - entry.createdAt > EXTERNALIZED_TOOL_PAYLOAD_TTL_MS) {
      payloadEntries.delete(ref);
    }
  }
}

function createPayloadEntryKey(ref: string, namespace?: string): string {
  return namespace ? `${namespace}\u0000${ref}` : ref;
}
