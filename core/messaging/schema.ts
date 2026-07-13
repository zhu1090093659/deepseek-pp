export const BRIDGE_READY_TYPE = 'DPP_BRIDGE_READY';

export const BRIDGE_MESSAGE_TYPES = [
  'SYNC_HOOK_STATE',
  'AUGMENT_REQUEST_BODY',
  'AUGMENT_REQUEST_BODY_EXTEND_TIMEOUT',
  'AUGMENT_REQUEST_BODY_RESULT',
  'TOOL_CALL_STARTED',
  'TOOL_CALL_CHUNK',
  'TOOL_CALL',
  'RESTORE_TOOL_CALLS',
  'RESPONSE_COMPLETE',
  'RESPONSE_TOKEN_SPEED',
  'MEMORIES_USED',
  'HEADERS_CAPTURED',
  BRIDGE_READY_TYPE,
] as const;

export const BRIDGE_SOURCES = {
  mainWorld: 'deepseek-pp-main',
  content: 'deepseek-pp-content',
} as const;

export const BRIDGE_HANDSHAKE_TYPES = {
  request: 'DPP_BRIDGE_REQUEST',
  init: 'DPP_BRIDGE_INIT',
} as const;

export type BridgeMessageType = typeof BRIDGE_MESSAGE_TYPES[number];

export type BridgeHandshakeType = typeof BRIDGE_HANDSHAKE_TYPES[keyof typeof BRIDGE_HANDSHAKE_TYPES];

export interface BridgeHandshakeCheck {
  value: unknown;
  actualOrigin: string;
  expectedOrigin: string;
  expectedSource: string;
  expectedType: BridgeHandshakeType;
  alreadyConnected: boolean;
  requireTransferredPort?: boolean;
  transferredPortCount?: number;
}

export interface ValidatedBridgeMessage {
  source: string;
  type: BridgeMessageType;
  id?: string;
  body?: string;
  ok?: boolean;
  error?: string;
  timeoutMs?: number;
  [key: string]: unknown;
}

const BRIDGE_TYPES: ReadonlySet<string> = new Set(BRIDGE_MESSAGE_TYPES);

export function isBridgeHandshakeMessage(check: BridgeHandshakeCheck): boolean {
  if (check.actualOrigin !== check.expectedOrigin || check.alreadyConnected) return false;
  const message = check.value as { source?: unknown; type?: unknown } | null | undefined;
  if (message?.source !== check.expectedSource || message.type !== check.expectedType) return false;
  if (check.requireTransferredPort && (check.transferredPortCount ?? 0) < 1) return false;
  return true;
}

export function validateBridgeMessage(
  value: unknown,
  expectedSource?: string,
): ValidatedBridgeMessage | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const message = value as Record<string, unknown>;
  if (expectedSource && message.source !== expectedSource) return null;
  if (typeof message.source !== 'string') return null;
  if (typeof message.type !== 'string' || !BRIDGE_TYPES.has(message.type)) return null;

  if ('id' in message && typeof message.id !== 'string') return null;
  if ('body' in message && typeof message.body !== 'string') return null;
  if ('ok' in message && typeof message.ok !== 'boolean') return null;
  if ('error' in message && typeof message.error !== 'string') return null;
  if (
    'timeoutMs' in message &&
    (typeof message.timeoutMs !== 'number' || !Number.isFinite(message.timeoutMs) || message.timeoutMs <= 0)
  ) return null;

  return message as ValidatedBridgeMessage;
}

export function requireBridgeMessage(
  value: unknown,
  expectedSource?: string,
): ValidatedBridgeMessage {
  const message = validateBridgeMessage(value, expectedSource);
  if (!message) {
    throw new Error('Invalid DeepSeek++ bridge message.');
  }
  return message;
}
