import type {
  McpServerCreateInput,
  McpServerUpdateInput,
} from '../mcp/types';
import { normalizeSandboxRunRequest } from '../sandbox/tool';
import type { SandboxRunRequest } from '../sandbox/types';
import type { ToolCall } from '../tool/types';
import { WEB_SEARCH_TOOL_NAMES } from '../tool/web-search';
import { isPlainRuntimeRecord } from './runtime-boundary';
import { isToolCallRecord } from './tool-record-codec';
import type { ToolRuntimeCommandContracts } from './tool-runtime-contracts';

type ToolRuntimeCommandType = keyof ToolRuntimeCommandContracts;

export type ToolRuntimePayloadCommandType = {
  [TType in ToolRuntimeCommandType]:
    'payload' extends keyof ToolRuntimeCommandContracts[TType]['request']
      ? TType
      : never;
}[ToolRuntimeCommandType];

export type ToolRuntimePayload<TType extends ToolRuntimePayloadCommandType> =
  ToolRuntimeCommandContracts[TType]['request'] extends { payload: infer TPayload }
    ? TPayload
    : ToolRuntimeCommandContracts[TType]['request'] extends { payload?: infer TPayload }
      ? TPayload | undefined
      : never;

export interface ValidDecodedPayload<TPayload> {
  ok: true;
  payload: TPayload;
}

export interface InvalidDecodedPayload {
  ok: false;
  error: string;
}

export type DecodedDomainPayload<TPayload> =
  | ValidDecodedPayload<TPayload>
  | InvalidDecodedPayload;

export type DecodedSandboxPayload =
  | ValidDecodedPayload<SandboxRunRequest>
  | { ok: false; detail: string };

export type DecodedToolCallPayload =
  | { ok: true; call: ToolCall; authorizationId?: string }
  | { ok: false; call: unknown };

interface DecodedCreateToolAuthorizationPayload {
  requestId: string;
  trigger: 'manual_chat' | 'agent_run';
  chatSessionId?: string | null;
  runId?: string;
  descriptorIds?: string[];
}

interface SpecialDecodedPayloads {
  CREATE_TOOL_AUTHORIZATION: DecodedDomainPayload<DecodedCreateToolAuthorizationPayload>;
  CLOSE_TOOL_AUTHORIZATION: DecodedDomainPayload<{ authorizationId: string }>;
  APPEND_EXTERNAL_TOOL_PAYLOAD_CHUNK: DecodedDomainPayload<{
    authorizationId: string;
    callId: string;
    invocationName: string;
    chunk: string;
  }>;
  EXECUTE_TOOL_CALL: DecodedToolCallPayload;
  RUN_ARTIFACT_CODE: DecodedSandboxPayload;
}

export type ToolRuntimeDecodedPayload<TType extends ToolRuntimePayloadCommandType> =
  TType extends keyof SpecialDecodedPayloads
    ? SpecialDecodedPayloads[TType]
    : ToolRuntimePayload<TType>;

type ToolRuntimePayloadDecoderMap = {
  [TType in ToolRuntimePayloadCommandType]: (
    value: unknown,
  ) => ToolRuntimeDecodedPayload<TType>;
};

export const TOOL_RUNTIME_PAYLOAD_DECODERS: ToolRuntimePayloadDecoderMap = {
  GET_MCP_SERVER(value) {
    return decodeStringFieldPayload<'GET_MCP_SERVER'>(value, 'GET_MCP_SERVER.payload', 'id');
  },
  CREATE_MCP_SERVER(value) {
    const payload = recordValue(value, 'CREATE_MCP_SERVER.payload');
    validateMcpServerCreateInput(payload, 'CREATE_MCP_SERVER.payload');
    return typedPayload<'CREATE_MCP_SERVER'>(payload);
  },
  UPDATE_MCP_SERVER(value) {
    const payload = recordValue(value, 'UPDATE_MCP_SERVER.payload');
    stringValue(payload.id, 'UPDATE_MCP_SERVER.payload.id');
    const patch = recordValue(payload.patch, 'UPDATE_MCP_SERVER.payload.patch');
    validateMcpServerUpdateInput(patch, 'UPDATE_MCP_SERVER.payload.patch');
    return typedPayload<'UPDATE_MCP_SERVER'>({ ...payload, patch });
  },
  DELETE_MCP_SERVER(value) {
    return decodeStringFieldPayload<'DELETE_MCP_SERVER'>(value, 'DELETE_MCP_SERVER.payload', 'id');
  },
  GET_MCP_TOOL_CACHE(value) {
    return decodeStringFieldPayload<'GET_MCP_TOOL_CACHE'>(
      value,
      'GET_MCP_TOOL_CACHE.payload',
      'serverId',
    );
  },
  REFRESH_MCP_SERVER_TOOLS(value) {
    return decodeStringFieldPayload<'REFRESH_MCP_SERVER_TOOLS'>(
      value,
      'REFRESH_MCP_SERVER_TOOLS.payload',
      'serverId',
    );
  },
  REQUEST_MCP_SERVER_PERMISSION(value) {
    return decodeStringFieldPayload<'REQUEST_MCP_SERVER_PERMISSION'>(
      value,
      'REQUEST_MCP_SERVER_PERMISSION.payload',
      'serverId',
    );
  },
  TEST_MCP_SERVER_CONNECTION(value) {
    return decodeStringFieldPayload<'TEST_MCP_SERVER_CONNECTION'>(
      value,
      'TEST_MCP_SERVER_CONNECTION.payload',
      'serverId',
    );
  },
  SET_WEB_TOOL_SETTING(value) {
    const payload = recordValue(value, 'SET_WEB_TOOL_SETTING.payload');
    enumValue(payload.name, WEB_SEARCH_TOOL_NAMES, 'SET_WEB_TOOL_SETTING.payload.name');
    booleanValue(payload.enabled, 'SET_WEB_TOOL_SETTING.payload.enabled');
    return typedPayload<'SET_WEB_TOOL_SETTING'>(payload);
  },
  SAVE_BROWSER_CONTROL_SETTINGS(value) {
    if (value === undefined) return undefined;
    const payload = recordValue(value, 'SAVE_BROWSER_CONTROL_SETTINGS.payload');
    validateBrowserControlSettingsPatch(payload, 'SAVE_BROWSER_CONTROL_SETTINGS.payload');
    return typedPayload<'SAVE_BROWSER_CONTROL_SETTINGS'>(payload);
  },
  SET_BROWSER_CONTROL_ENABLED(value) {
    const payload = recordValue(value, 'SET_BROWSER_CONTROL_ENABLED.payload');
    booleanValue(payload.enabled, 'SET_BROWSER_CONTROL_ENABLED.payload.enabled');
    return typedPayload<'SET_BROWSER_CONTROL_ENABLED'>(payload);
  },
  SET_BROWSER_CONTROL_TARGET(value) {
    const payload = recordValue(value, 'SET_BROWSER_CONTROL_TARGET.payload');
    integerValue(payload.tabId, 'SET_BROWSER_CONTROL_TARGET.payload.tabId');
    return typedPayload<'SET_BROWSER_CONTROL_TARGET'>(payload);
  },
  DIAGNOSE_WEB_SEARCH(value) {
    if (!isPlainRuntimeRecord(value)) return { query: 'test' };
    const payload = value;
    return {
      ...payload,
      query: typeof payload.query === 'string' ? payload.query : 'test',
    } as ToolRuntimePayload<'DIAGNOSE_WEB_SEARCH'>;
  },
  REQUEST_HOST_PERMISSION(value) {
    const payload = recordValue(value, 'REQUEST_HOST_PERMISSION.payload');
    stringArray(payload.origins, 'REQUEST_HOST_PERMISSION.payload.origins');
    return typedPayload<'REQUEST_HOST_PERMISSION'>(payload);
  },
  CREATE_TOOL_AUTHORIZATION(value) {
    if (!isPlainRuntimeRecord(value)) {
      return invalidDecodedPayload('invalid_tool_authorization_request');
    }
    if (
      typeof value.requestId !== 'string'
      || (value.trigger !== 'manual_chat' && value.trigger !== 'agent_run')
      || (
        value.chatSessionId !== undefined
        && value.chatSessionId !== null
        && typeof value.chatSessionId !== 'string'
      )
      || (value.runId !== undefined && typeof value.runId !== 'string')
      || (
        value.descriptorIds !== undefined
        && (
          !Array.isArray(value.descriptorIds)
          || !value.descriptorIds.every((id) => typeof id === 'string')
        )
      )
    ) {
      return invalidDecodedPayload('invalid_tool_authorization_request');
    }
    return validDecodedPayload({
      requestId: value.requestId,
      trigger: value.trigger,
      chatSessionId: value.chatSessionId,
      runId: value.runId,
      descriptorIds: value.descriptorIds as string[] | undefined,
    });
  },
  CLOSE_TOOL_AUTHORIZATION(value) {
    const authorizationId = isPlainRuntimeRecord(value) ? value.authorizationId : undefined;
    return typeof authorizationId === 'string'
      ? validDecodedPayload({ authorizationId })
      : invalidDecodedPayload('invalid_tool_authorization_id');
  },
  APPEND_EXTERNAL_TOOL_PAYLOAD_CHUNK(value) {
    if (!isPlainRuntimeRecord(value)) {
      return invalidDecodedPayload('invalid_external_payload_chunk');
    }
    if (
      typeof value.authorizationId !== 'string'
      || typeof value.callId !== 'string'
      || typeof value.invocationName !== 'string'
      || typeof value.chunk !== 'string'
    ) {
      return invalidDecodedPayload('invalid_external_payload_chunk');
    }
    return validDecodedPayload({
      authorizationId: value.authorizationId,
      callId: value.callId,
      invocationName: value.invocationName,
      chunk: value.chunk,
    });
  },
  EXECUTE_TOOL_CALL(value) {
    if (value === null || typeof value !== 'object') return { ok: false, call: value };
    const payload = value as Record<string, unknown>;
    const { authorizationId, ...call } = payload;
    if (!isToolCallRecord(call)) return { ok: false, call };
    return {
      ok: true,
      authorizationId: typeof authorizationId === 'string' ? authorizationId : undefined,
      call: call as unknown as ToolCall,
    };
  },
  RUN_ARTIFACT_CODE(value) {
    try {
      return validDecodedPayload(normalizeSandboxRunRequest(value));
    } catch (error) {
      return {
        ok: false,
        detail: error instanceof Error ? error.message : String(error),
      };
    }
  },
  GET_TOOL_CALL_HISTORY(value) {
    if (value === undefined) return undefined;
    const payload = recordValue(value, 'GET_TOOL_CALL_HISTORY.payload');
    if (payload.limit !== undefined) {
      finiteNumber(payload.limit, 'GET_TOOL_CALL_HISTORY.payload.limit');
    }
    return typedPayload<'GET_TOOL_CALL_HISTORY'>(payload);
  },
};

export function decodeToolRuntimePayload<TType extends ToolRuntimePayloadCommandType>(
  type: TType,
  value: unknown,
): ToolRuntimeDecodedPayload<TType> {
  return TOOL_RUNTIME_PAYLOAD_DECODERS[type](value);
}

function validateMcpServerCreateInput(
  payload: Record<string, unknown>,
  path: string,
): asserts payload is Record<string, unknown> & McpServerCreateInput {
  stringValue(payload.displayName, `${path}.displayName`);
  validateMcpTransport(recordValue(payload.transport, `${path}.transport`), `${path}.transport`);
  optionalBoolean(payload.enabled, `${path}.enabled`);
  validateOptionalMcpServerFields(payload, path);
}

function validateMcpServerUpdateInput(
  payload: Record<string, unknown>,
  path: string,
): asserts payload is Record<string, unknown> & McpServerUpdateInput {
  optionalString(payload.displayName, `${path}.displayName`);
  optionalBoolean(payload.enabled, `${path}.enabled`);
  if (payload.transport !== undefined) {
    validateMcpTransport(recordValue(payload.transport, `${path}.transport`), `${path}.transport`);
  }
  validateOptionalMcpServerFields(payload, path);
  if (payload.status !== undefined) {
    enumValue(payload.status, ['unknown', 'ready', 'error', 'disabled'], `${path}.status`);
  }
  optionalNullableFiniteNumber(payload.lastConnectedAt, `${path}.lastConnectedAt`);
  optionalNullableString(payload.lastError, `${path}.lastError`);
}

function validateOptionalMcpServerFields(payload: Record<string, unknown>, path: string): void {
  if (payload.headers !== undefined) {
    arrayValue(payload.headers, `${path}.headers`).forEach((value, index) => {
      const header = recordValue(value, `${path}.headers[${index}]`);
      stringValue(header.name, `${path}.headers[${index}].name`);
      stringValue(header.value, `${path}.headers[${index}].value`);
    });
  }
  if (payload.secrets !== undefined) {
    arrayValue(payload.secrets, `${path}.secrets`).forEach((value, index) => {
      const secret = recordValue(value, `${path}.secrets[${index}]`);
      optionalString(secret.id, `${path}.secrets[${index}].id`);
      enumValue(secret.kind, ['bearer', 'basic', 'header'], `${path}.secrets[${index}].kind`);
      optionalString(secret.headerName, `${path}.secrets[${index}].headerName`);
      optionalString(secret.username, `${path}.secrets[${index}].username`);
      stringValue(secret.value, `${path}.secrets[${index}].value`);
    });
  }
  if (payload.timeouts !== undefined) {
    const timeouts = recordValue(payload.timeouts, `${path}.timeouts`);
    finiteNumber(timeouts.connectMs, `${path}.timeouts.connectMs`);
    finiteNumber(timeouts.requestMs, `${path}.timeouts.requestMs`);
    finiteNumber(timeouts.discoveryMs, `${path}.timeouts.discoveryMs`);
  }
  if (payload.limits !== undefined) {
    const limits = recordValue(payload.limits, `${path}.limits`);
    finiteNumber(limits.maxResultBytes, `${path}.limits.maxResultBytes`);
    finiteNumber(limits.maxToolCount, `${path}.limits.maxToolCount`);
  }
  if (payload.allowlist !== undefined) {
    const allowlist = recordValue(payload.allowlist, `${path}.allowlist`);
    enumValue(allowlist.mode, ['all', 'allow', 'deny'], `${path}.allowlist.mode`);
    stringArray(allowlist.toolNames, `${path}.allowlist.toolNames`);
  }
  if (payload.execution !== undefined) {
    const execution = recordValue(payload.execution, `${path}.execution`);
    enumValue(execution.mode, ['auto', 'manual', 'disabled'], `${path}.execution.mode`);
    booleanValue(execution.enabled, `${path}.execution.enabled`);
  }
}

function validateMcpTransport(payload: Record<string, unknown>, path: string): void {
  enumValue(
    payload.kind,
    ['http', 'sse', 'streamable_http', 'stdio_bridge', 'native_messaging'],
    `${path}.kind`,
  );
  optionalString(payload.url, `${path}.url`);
  optionalString(payload.nativeHost, `${path}.nativeHost`);
  optionalString(payload.command, `${path}.command`);
  if (payload.args !== undefined) stringArray(payload.args, `${path}.args`);
  optionalString(payload.cwd, `${path}.cwd`);
  if (payload.env !== undefined) stringRecord(payload.env, `${path}.env`);
}

function validateBrowserControlSettingsPatch(
  payload: Record<string, unknown>,
  path: string,
): void {
  optionalBoolean(payload.enabled, `${path}.enabled`);
  if (payload.targetTabId !== undefined && payload.targetTabId !== null) {
    integerValue(payload.targetTabId, `${path}.targetTabId`);
  }
  optionalBoolean(payload.includeSnapshotAfterActions, `${path}.includeSnapshotAfterActions`);
  if (payload.maxSnapshotNodes !== undefined) {
    finiteNumber(payload.maxSnapshotNodes, `${path}.maxSnapshotNodes`);
  }
  if (payload.maxSnapshotTextBytes !== undefined) {
    finiteNumber(payload.maxSnapshotTextBytes, `${path}.maxSnapshotTextBytes`);
  }
}

function decodeStringFieldPayload<TType extends ToolRuntimePayloadCommandType>(
  value: unknown,
  path: string,
  field: string,
): ToolRuntimeDecodedPayload<TType> {
  const payload = recordValue(value, path);
  stringValue(payload[field], `${path}.${field}`);
  return payload as ToolRuntimeDecodedPayload<TType>;
}

function validDecodedPayload<TPayload>(payload: TPayload): ValidDecodedPayload<TPayload> {
  return { ok: true, payload };
}

function invalidDecodedPayload(error: string): InvalidDecodedPayload {
  return { ok: false, error };
}

function typedPayload<TType extends ToolRuntimePayloadCommandType>(
  value: unknown,
): ToolRuntimePayload<TType> {
  return value as ToolRuntimePayload<TType>;
}

function recordValue(value: unknown, path: string): Record<string, unknown> {
  if (!isPlainRuntimeRecord(value)) throw new Error(`${path} must be a plain object`);
  return value;
}

function arrayValue(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${path} must be an array`);
  return value;
}

function stringValue(value: unknown, path: string): string {
  if (typeof value !== 'string') throw new Error(`${path} must be a string`);
  return value;
}

function optionalString(value: unknown, path: string): void {
  if (value !== undefined) stringValue(value, path);
}

function optionalNullableString(value: unknown, path: string): void {
  if (value !== undefined && value !== null) stringValue(value, path);
}

function booleanValue(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${path} must be a boolean`);
  return value;
}

function optionalBoolean(value: unknown, path: string): void {
  if (value !== undefined) booleanValue(value, path);
}

function finiteNumber(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${path} must be a finite number`);
  }
  return value;
}

function optionalNullableFiniteNumber(value: unknown, path: string): void {
  if (value !== undefined && value !== null) finiteNumber(value, path);
}

function integerValue(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value)) throw new Error(`${path} must be a safe integer`);
  return value as number;
}

function stringArray(value: unknown, path: string): string[] {
  return arrayValue(value, path).map((item, index) => stringValue(item, `${path}[${index}]`));
}

function stringRecord(value: unknown, path: string): Record<string, string> {
  const record = recordValue(value, path);
  Object.entries(record).forEach(([key, item]) => stringValue(item, `${path}.${key}`));
  return record as Record<string, string>;
}

function enumValue<TValue extends string>(
  value: unknown,
  allowed: readonly TValue[],
  path: string,
): TValue {
  if (typeof value !== 'string' || !allowed.includes(value as TValue)) {
    throw new Error(`${path} has an unsupported value`);
  }
  return value as TValue;
}
