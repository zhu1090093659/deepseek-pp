import { DEFAULT_LOCALE, translate, type SupportedLocale } from '../i18n';
import { appendToolCallHistory } from './history';
import { ToolPostEffectPersistenceError } from './execution-error';
import type {
  RuntimeToolAuthorizationContext,
  ToolCall,
  ToolDescriptor,
  ToolExecutionTrigger,
  ToolResult,
} from './types';
import type { ToolProviderRegistry } from './provider-registry';
import {
  isExternalizedToolPayload,
  parseExternalizedToolPayload,
  takeExternalizedToolPayloadText,
} from './externalized-payload';
import { isToolCallRecord } from '../messaging/tool-record-codec';
import {
  authorizeToolExecution,
  completeToolExecutionAuthorization,
  createToolAuthorizationResult,
  getToolAuthorizationAuditTrigger,
  ToolAuthorizationError,
} from './authorization';

export interface RuntimeToolCallOptions {
  timeoutMs?: number;
  maxResultBytes?: number;
  signal?: AbortSignal;
  idempotencyKey?: string;
  assertActive?: () => void;
}

export interface RuntimeToolRuntime {
  getToolDescriptors(locale?: SupportedLocale): Promise<ToolDescriptor[]>;
  getAuthorizationDescriptors(locale?: SupportedLocale): Promise<ToolDescriptor[]>;
  refreshToolDescriptors(locale?: SupportedLocale): Promise<ToolDescriptor[]>;
  executeToolCall(
    call: ToolCall,
    authorization: RuntimeToolAuthorizationContext | ToolExecutionTrigger,
    locale?: SupportedLocale,
    options?: RuntimeToolCallOptions,
  ): Promise<ToolResult>;
}

export function createRuntimeToolRuntime(
  providerRegistry: ToolProviderRegistry,
): RuntimeToolRuntime {
  return {
    getToolDescriptors: (locale = DEFAULT_LOCALE) => getRuntimeDescriptors(
      providerRegistry,
      locale,
      false,
    ),
    getAuthorizationDescriptors: (locale = DEFAULT_LOCALE) => getRuntimeDescriptors(
      providerRegistry,
      locale,
      true,
    ),
    refreshToolDescriptors: async (locale = DEFAULT_LOCALE) => {
      await providerRegistry.refresh({ locale });
      return getRuntimeDescriptors(providerRegistry, locale, false);
    },
    executeToolCall: (call, authorization, locale = DEFAULT_LOCALE, options = {}) =>
      executeRuntimeToolCall(providerRegistry, call, authorization, locale, options),
  };
}

async function getRuntimeDescriptors(
  providerRegistry: ToolProviderRegistry,
  locale: SupportedLocale,
  includeDisabledMcp: boolean,
): Promise<ToolDescriptor[]> {
  return providerRegistry.listTools({
    locale,
    includeDisabled: includeDisabledMcp,
  });
}

async function executeRuntimeToolCall(
  providerRegistry: ToolProviderRegistry,
  call: ToolCall,
  authorization: RuntimeToolAuthorizationContext | ToolExecutionTrigger,
  locale: SupportedLocale = DEFAULT_LOCALE,
  options: RuntimeToolCallOptions = {},
): Promise<ToolResult> {
  assertRuntimeExecutionActive(options);
  const identifiedCall = !call.id && options.idempotencyKey
    ? { ...call, id: options.idempotencyKey }
    : call;
  if (!isToolCallRecord(identifiedCall)) {
    return createInvalidToolCallResult(identifiedCall, locale);
  }
  const context = typeof authorization === 'string'
    ? createTrustedExecutionContext(identifiedCall, authorization)
    : authorization;
  if (identifiedCall.parseError) {
    const result = createParseErrorToolResult(identifiedCall, locale);
    await appendAuthorizedFailureHistory(identifiedCall, result, context);
    return result;
  }
  let authorized: Awaited<ReturnType<typeof authorizeToolExecution>>;
  try {
    authorized = await authorizeToolExecution(
      identifiedCall,
      context,
      await getRuntimeDescriptors(providerRegistry, locale, true),
    );
    assertRuntimeExecutionActive(options);
  } catch (error) {
    if (!(error instanceof ToolAuthorizationError)) throw error;
    const result = error.code === 'tool_unsupported'
      ? createUnsupportedToolResult(identifiedCall, locale)
      : createToolAuthorizationResult(
        error,
        identifiedCall,
        translate(locale, 'tool.runtime.authorizationRejected'),
      );
    await appendAuthorizedFailureHistory(identifiedCall, result, context);
    return result;
  }

  let result: ToolResult;
  let resolvedCall = authorized.call;
  let providerCompleted = false;
  try {
    resolvedCall = await resolveToolCallPayload(
      authorized.call,
      authorized.externalPayloadNamespace,
    );
    assertRuntimeExecutionActive(options);
    if (resolvedCall.parseError) {
      result = createParseErrorToolResult(resolvedCall, locale);
    } else {
      result = await providerRegistry.execute(
        resolvedCall,
        authorized.descriptor,
        {
          locale,
          signal: options.signal,
          timeoutMs: options.timeoutMs,
          maxResultBytes: options.maxResultBytes,
        },
      );
      providerCompleted = true;
    }
    assertRuntimeExecutionActive(options);
  } catch (error) {
    await completeAuthorizationAfterProvider(authorized.reservation);
    throw error;
  }
  await completeAuthorizationAfterProvider(authorized.reservation, result);
  try {
    await appendRuntimeToolHistory(resolvedCall, result, authorized.trigger);
  } catch (error) {
    if (providerCompleted) throw new ToolPostEffectPersistenceError(error);
    throw error;
  }
  assertRuntimeExecutionActive(options);
  return result;
}

export function createInvalidToolCallResult(
  value: unknown,
  locale: SupportedLocale = DEFAULT_LOCALE,
): ToolResult {
  const message = 'Runtime tool call does not match the released contract.';
  const name = value && typeof value === 'object'
    && typeof (value as { name?: unknown }).name === 'string'
    ? (value as { name: string }).name
    : undefined;
  return {
    ok: false,
    summary: translate(locale, 'tool.runtime.invalidFormat'),
    detail: message,
    name,
    error: {
      code: 'tool_call_payload_invalid',
      message,
      retryable: false,
    },
  };
}

function assertRuntimeExecutionActive(options: RuntimeToolCallOptions): void {
  options.assertActive?.();
  if (!options.signal?.aborted) return;
  const reason = options.signal.reason;
  if (reason instanceof Error) throw reason;
  throw new DOMException('Tool execution was aborted.', 'AbortError');
}

async function appendAuthorizedFailureHistory(
  call: ToolCall,
  result: ToolResult,
  context: RuntimeToolAuthorizationContext,
): Promise<void> {
  const trigger = await getToolAuthorizationAuditTrigger(call, context);
  if (trigger) await appendRuntimeToolHistory(call, result, trigger);
}

async function completeAuthorizationAfterProvider(
  reservation: Awaited<ReturnType<typeof authorizeToolExecution>>['reservation'],
  result?: ToolResult,
): Promise<void> {
  try {
    await completeToolExecutionAuthorization(reservation, result);
  } catch (error) {
    // The executing reservation was persisted before provider I/O, so a failed
    // completion write remains fail-closed for replay. Preserve the real
    // provider result and history instead of replacing it with a storage error.
    console.error('[DeepSeek++] tool authorization completion persistence failed', error);
  }
}

async function appendRuntimeToolHistory(
  call: ToolCall,
  result: ToolResult,
  source: ToolExecutionTrigger,
): Promise<void> {
  try {
    await appendToolCallHistory(call, result, source);
  } catch (error) {
    if (!isRecoverableToolHistoryError(error)) throw error;
    console.warn('[DeepSeek++] tool history persistence failed', error);
  }
}

async function resolveToolCallPayload(
  call: ToolCall,
  externalPayloadNamespace?: string,
): Promise<ToolCall> {
  if (!isExternalizedToolPayload(call.payload)) return call;

  const body = takeExternalizedToolPayloadText(
    call.payload.ref,
    call.payload.invocationName,
    externalPayloadNamespace,
  );
  if (body === null) {
    return {
      ...call,
      payload: {},
      parseError: {
        code: 'tool_call_external_payload_missing',
        message: 'Tool call payload expired before execution completed. Retry the request.',
        retryable: true,
        details: { invocationName: call.payload.invocationName },
      },
    };
  }

  const resolved = parseExternalizedToolPayload(body, call.payload.invocationName);
  if (resolved.parseError) {
    return {
      ...call,
      payload: {},
      parseError: resolved.parseError,
    };
  }

  return {
    ...call,
    payload: resolved.payload ?? {},
    parseError: undefined,
  };
}

function isRecoverableToolHistoryError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /QUOTA_BYTES|quota exceeded|max(?:imum)?\s+(?:write|storage)|too large/i.test(message);
}

function createParseErrorToolResult(call: ToolCall, locale: SupportedLocale): ToolResult {
  return {
    ok: false,
    summary: translate(locale, 'tool.runtime.invalidFormat'),
    detail: call.parseError?.message ?? 'Tool call payload is invalid.',
    name: call.name,
    provider: call.provider,
    descriptorId: call.descriptorId,
    error: call.parseError ?? {
      code: 'tool_call_payload_invalid',
      message: 'Tool call payload is invalid.',
      retryable: false,
    },
  };
}

function createUnsupportedToolResult(call: ToolCall, locale: SupportedLocale): ToolResult {
  return {
    ok: false,
    summary: translate(locale, 'tool.runtime.unknownTool'),
    detail: `Unsupported tool: ${call.name}`,
    name: call.name,
    provider: call.provider,
    descriptorId: call.descriptorId,
    error: {
      code: 'tool_unsupported',
      message: `Unsupported tool: ${call.name}`,
      retryable: false,
    },
  };
}

function createTrustedExecutionContext(
  call: ToolCall,
  trigger: ToolExecutionTrigger,
): RuntimeToolAuthorizationContext {
  return {
    kind: 'trusted',
    trigger,
    requestId: call.source?.requestId ?? crypto.randomUUID(),
    chatSessionId: call.source?.chatSessionId ?? null,
    taskId: call.source?.taskId,
    runId: call.source?.runId,
    automationId: call.source?.automationId,
    automationRunId: call.source?.automationRunId,
  };
}
