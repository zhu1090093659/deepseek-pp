import {
  isToolCallRecord,
  isToolCallRestoreRecord,
  isToolDescriptorRecord,
} from './tool-record-codec';

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
  'REQUEST_TERMINAL',
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

export const BRIDGE_TYPE_SOURCES = {
  SYNC_HOOK_STATE: BRIDGE_SOURCES.content,
  AUGMENT_REQUEST_BODY: BRIDGE_SOURCES.mainWorld,
  AUGMENT_REQUEST_BODY_EXTEND_TIMEOUT: BRIDGE_SOURCES.content,
  AUGMENT_REQUEST_BODY_RESULT: BRIDGE_SOURCES.content,
  TOOL_CALL_STARTED: BRIDGE_SOURCES.mainWorld,
  TOOL_CALL_CHUNK: BRIDGE_SOURCES.mainWorld,
  TOOL_CALL: BRIDGE_SOURCES.mainWorld,
  RESTORE_TOOL_CALLS: BRIDGE_SOURCES.mainWorld,
  RESPONSE_COMPLETE: BRIDGE_SOURCES.mainWorld,
  REQUEST_TERMINAL: BRIDGE_SOURCES.mainWorld,
  RESPONSE_TOKEN_SPEED: BRIDGE_SOURCES.mainWorld,
  MEMORIES_USED: BRIDGE_SOURCES.mainWorld,
  HEADERS_CAPTURED: BRIDGE_SOURCES.mainWorld,
  DPP_BRIDGE_READY: BRIDGE_SOURCES.mainWorld,
} as const satisfies Record<BridgeMessageType, string>;

export type BridgeMessageType = typeof BRIDGE_MESSAGE_TYPES[number];

export type BridgeHandshakeType = typeof BRIDGE_HANDSHAKE_TYPES[keyof typeof BRIDGE_HANDSHAKE_TYPES];

export interface BridgeHandshakeCheck {
  value: unknown;
  actualOrigin: string;
  expectedOrigin: string;
  expectedSource: string;
  expectedType: BridgeHandshakeType;
  alreadyConnected: boolean;
  actualWindowSource?: unknown;
  expectedWindowSource?: unknown;
  actualTopLevel?: boolean;
  requireTopLevel?: boolean;
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

export interface BridgeSessionContext {
  readonly id: string;
  readonly origin: string;
}

export interface BridgeSessionCheck {
  candidate: BridgeSessionContext;
  current: BridgeSessionContext | null;
  actualOrigin: string;
  actualTopLevel: boolean;
}

export interface BridgeSessionController {
  open(id: string, actualOrigin: string, actualTopLevel: boolean): BridgeSessionContext;
  accepts(candidate: BridgeSessionContext, actualOrigin: string, actualTopLevel: boolean): boolean;
  close(candidate?: BridgeSessionContext): boolean;
}

const BRIDGE_TYPES: ReadonlySet<string> = new Set(BRIDGE_MESSAGE_TYPES);

/**
 * This handshake establishes routing and freshness only. Code in the page's
 * MAIN world shares the page's identity, so every port message remains
 * untrusted until validateBridgeMessage has decoded its full legal shape.
 */
export function isBridgeHandshakeMessage(check: BridgeHandshakeCheck): boolean {
  if (check.actualOrigin !== check.expectedOrigin || check.alreadyConnected) return false;
  if (!isPlainRecord(check.value)) return false;
  if (
    check.expectedWindowSource !== undefined &&
    check.actualWindowSource !== check.expectedWindowSource
  ) return false;
  if (check.requireTopLevel && check.actualTopLevel !== true) return false;
  if (check.value.source !== check.expectedSource || check.value.type !== check.expectedType) return false;
  if (check.requireTransferredPort && check.transferredPortCount !== 1) return false;
  return true;
}

export function validateBridgeMessage(
  value: unknown,
  expectedSource?: string,
): ValidatedBridgeMessage | null {
  if (!isPlainRecord(value)) return null;
  if (typeof value.type !== 'string' || !BRIDGE_TYPES.has(value.type)) return null;

  const type = value.type as BridgeMessageType;
  const authoritativeSource = BRIDGE_TYPE_SOURCES[type];
  if (value.source !== authoritativeSource) return null;
  if (expectedSource !== undefined && value.source !== expectedSource) return null;
  if (!BRIDGE_PAYLOAD_VALIDATORS[type](value)) return null;

  return value as ValidatedBridgeMessage;
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

/**
 * Creates receiver-owned document context for one transferred MessagePort.
 * The id is never sent to MAIN world; object identity binds dispatch to the
 * port handler installed by the receiving document.
 */
export function createBridgeSessionContext(
  id: string,
  actualOrigin: string,
  expectedOrigin: string,
  actualTopLevel: boolean,
): BridgeSessionContext {
  if (!isNonEmptyString(id) || actualOrigin !== expectedOrigin || !actualTopLevel) {
    throw new Error('Invalid DeepSeek++ bridge session context.');
  }
  return Object.freeze({ id, origin: expectedOrigin });
}

export function isCurrentBridgeSession(check: BridgeSessionCheck): boolean {
  return check.current !== null &&
    check.candidate === check.current &&
    check.candidate.origin === check.actualOrigin &&
    check.actualTopLevel;
}

export function createBridgeSessionController(expectedOrigin: string): BridgeSessionController {
  let current: BridgeSessionContext | null = null;

  return {
    open(id, actualOrigin, actualTopLevel) {
      if (current) throw new Error('DeepSeek++ bridge session is already active.');
      current = createBridgeSessionContext(id, actualOrigin, expectedOrigin, actualTopLevel);
      return current;
    },
    accepts(candidate, actualOrigin, actualTopLevel) {
      return isCurrentBridgeSession({ candidate, current, actualOrigin, actualTopLevel });
    },
    close(candidate) {
      if (candidate && candidate !== current) return false;
      current = null;
      return true;
    },
  };
}

const BRIDGE_PAYLOAD_VALIDATORS: Record<
  BridgeMessageType,
  (message: Record<string, unknown>) => boolean
> = {
  SYNC_HOOK_STATE: (message) => (
    Array.isArray(message.toolDescriptors) &&
    message.toolDescriptors.every(isToolDescriptorRecord) &&
    Array.isArray(message.skillSummaries) &&
    message.skillSummaries.every(isSkillSummary) &&
    (message.skillPopupCopy === undefined || isSkillPopupCopy(message.skillPopupCopy))
  ),
  AUGMENT_REQUEST_BODY: (message) => (
    isNonEmptyString(message.id) &&
    typeof message.body === 'string' &&
    (message.requestId === undefined || isNonEmptyString(message.requestId))
  ),
  AUGMENT_REQUEST_BODY_EXTEND_TIMEOUT: (message) => (
    isNonEmptyString(message.id) && isPositiveFiniteNumber(message.timeoutMs)
  ),
  AUGMENT_REQUEST_BODY_RESULT: isAugmentResult,
  TOOL_CALL_STARTED: (message) => isToolCallRecord(message.data),
  TOOL_CALL_CHUNK: (message) => (
    isPlainRecord(message.data) &&
    isNonEmptyString(message.data.id) &&
    isNonEmptyString(message.data.invocationName) &&
    typeof message.data.chunk === 'string' &&
    (message.data.requestId === undefined || isNonEmptyString(message.data.requestId))
  ),
  TOOL_CALL: (message) => isToolCallRecord(message.data),
  RESTORE_TOOL_CALLS: (message) => (
    Array.isArray(message.records) && message.records.every(isToolCallRestoreRecord)
  ),
  RESPONSE_COMPLETE: (message) => isResponseCompletePayload(message.payload),
  REQUEST_TERMINAL: (message) => (
    isPlainRecord(message.payload) && isNonEmptyString(message.payload.requestId)
  ),
  RESPONSE_TOKEN_SPEED: (message) => isResponseTokenSpeedPayload(message.payload),
  MEMORIES_USED: (message) => (
    Array.isArray(message.ids) &&
    message.ids.every((id) => typeof id === 'number' && Number.isInteger(id) && id >= 0)
  ),
  HEADERS_CAPTURED: (message) => (
    message.headers === null || isStringRecord(message.headers)
  ),
  DPP_BRIDGE_READY: () => true,
};

function isAugmentResult(message: Record<string, unknown>): boolean {
  if (!isNonEmptyString(message.id) || typeof message.ok !== 'boolean') return false;
  if (message.ok) {
    return message.result === null || (
      isPlainRecord(message.result) &&
      typeof message.result.body === 'string' &&
      typeof message.result.agentTaskPrompt === 'string' &&
      (message.result.requestId === undefined || isNonEmptyString(message.result.requestId)) &&
      (
        message.result.toolDescriptors === undefined ||
        (
          Array.isArray(message.result.toolDescriptors) &&
          message.result.toolDescriptors.every(isToolDescriptorRecord)
        )
      )
    );
  }
  return typeof message.error === 'string';
}

function isSkillSummary(value: unknown): boolean {
  return isPlainRecord(value) && isNonEmptyString(value.name) && typeof value.description === 'string';
}

function isSkillPopupCopy(value: unknown): boolean {
  return isPlainRecord(value) && typeof value.hint === 'string';
}

function isResponseCompletePayload(value: unknown): boolean {
  if (!isPlainRecord(value) || !isPlainRecord(value.promptOptions)) return false;
  return (
    typeof value.requestId === 'string' &&
    typeof value.text === 'string' &&
    typeof value.originalPrompt === 'string' &&
    typeof value.agentTaskPrompt === 'string' &&
    isNullableString(value.chatSessionId) &&
    isNullableNumber(value.parentMessageId) &&
    isNullableNumber(value.assistantMessageId) &&
    isNullableString(value.promptOptions.modelType) &&
    typeof value.promptOptions.searchEnabled === 'boolean' &&
    typeof value.promptOptions.thinkingEnabled === 'boolean' &&
    Array.isArray(value.promptOptions.refFileIds) &&
    value.promptOptions.refFileIds.every((id) => typeof id === 'string')
  );
}

function isResponseTokenSpeedPayload(value: unknown): boolean {
  if (!isPlainRecord(value)) return false;
  return (
    optionalString(value.requestId) &&
    optionalNullableString(value.chatSessionId) &&
    optionalNullableNumber(value.assistantMessageId) &&
    typeof value.active === 'boolean' &&
    isFiniteNumber(value.estimatedTokens) &&
    isNullableFiniteNumber(value.accumulatedTokens) &&
    isFiniteNumber(value.tokensPerSecond) &&
    isFiniteNumber(value.elapsedMs) &&
    isFiniteNumber(value.textLength) &&
    (value.tokenSource === 'server' || value.tokenSource === 'estimated') &&
    (value.speedSource === 'server' || value.speedSource === 'estimated') &&
    isNullableString(value.modelType)
  );
}

function isStringRecord(value: unknown): boolean {
  return isPlainRecord(value) && Object.values(value).every((item) => typeof item === 'string');
}

function optionalString(value: unknown): boolean {
  return value === undefined || typeof value === 'string';
}

function optionalNullableString(value: unknown): boolean {
  return value === undefined || isNullableString(value);
}

function optionalNullableNumber(value: unknown): boolean {
  return value === undefined || isNullableNumber(value);
}

function isNullableString(value: unknown): boolean {
  return value === null || typeof value === 'string';
}

function isNullableNumber(value: unknown): boolean {
  return value === null || isFiniteNumber(value);
}

function isNullableFiniteNumber(value: unknown): boolean {
  return value === null || isFiniteNumber(value);
}

function isPositiveFiniteNumber(value: unknown): boolean {
  return isFiniteNumber(value) && value > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
