import type {
  TypedRuntimeCommandRequest,
  TypedRuntimeCommandResponse,
} from './runtime-command-registry';

export type BootstrapRuntimeRequest =
  | TypedRuntimeCommandRequest<'GET_CONFIG'>
  | TypedRuntimeCommandRequest<'WHATS_NEW_DISMISSED'>;

export type RuntimeFailureResponse = { ok: false; error: string };
export type RuntimeConfigResponse = TypedRuntimeCommandResponse<'GET_CONFIG'> | RuntimeFailureResponse;
export type RuntimeAckResponse = TypedRuntimeCommandResponse<'WHATS_NEW_DISMISSED'> | RuntimeFailureResponse;

export interface BootstrapRuntimeClient {
  getConfig(): Promise<RuntimeConfigResponse>;
  dismissWhatsNew(): Promise<RuntimeAckResponse>;
}

export function createBootstrapRuntimeClient(
  sendMessage: (message: BootstrapRuntimeRequest) => Promise<unknown>,
): BootstrapRuntimeClient {
  return Object.freeze({
    async getConfig() {
      return decodeRuntimeConfigResponse(await sendMessage({ type: 'GET_CONFIG' }));
    },
    async dismissWhatsNew() {
      return decodeRuntimeAckResponse(await sendMessage({ type: 'WHATS_NEW_DISMISSED' }));
    },
  });
}

export function decodeRuntimeConfigResponse(value: unknown): RuntimeConfigResponse {
  const record = requirePlainRecord(value, 'GET_CONFIG');
  if (typeof record.version === 'string') return { version: record.version };
  return decodeRuntimeFailureResponse(record, 'GET_CONFIG');
}

export function decodeRuntimeAckResponse(value: unknown): RuntimeAckResponse {
  const record = requirePlainRecord(value, 'WHATS_NEW_DISMISSED');
  if (record.ok === true) return { ok: true };
  return decodeRuntimeFailureResponse(record, 'WHATS_NEW_DISMISSED');
}

function decodeRuntimeFailureResponse(
  record: Record<string, unknown>,
  command: BootstrapRuntimeRequest['type'],
): RuntimeFailureResponse {
  if (record.ok === false && typeof record.error === 'string') {
    return { ok: false, error: record.error };
  }
  throw new Error(`Invalid ${command} runtime response.`);
}

function requirePlainRecord(
  value: unknown,
  command: BootstrapRuntimeRequest['type'],
): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Invalid ${command} runtime response.`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error(`Invalid ${command} runtime response.`);
  }
  return value as Record<string, unknown>;
}
