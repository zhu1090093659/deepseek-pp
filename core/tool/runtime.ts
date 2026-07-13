import {
  deleteMemory,
  getMemoryById,
  saveMemory,
  updateMemory,
} from '../memory/store';
import { getProjectForConversation } from '../project';
import {
  executeMcpToolCall,
  getMcpToolDescriptors,
  refreshMcpServerDiscovery,
  type McpToolExecutionOptions,
} from '../mcp/discovery';
import { DEFAULT_LOCALE, translate, type SupportedLocale } from '../i18n';
import { getAllMcpServers } from '../mcp/store';
import type { Memory, NewMemory } from '../types';
import { appendToolCallHistory } from './history';
import {
  createMemoryToolDescriptors,
  executeMemoryToolCall,
  isMemoryToolName,
  type MemoryToolRuntime,
} from './memory';
import {
  createWebSearchToolDescriptors,
  executeWebSearchToolCall,
  isWebSearchToolName,
} from './web-search';
import {
  createArtifactToolDescriptors,
  executeArtifactToolCall,
  isArtifactToolName,
} from '../artifact';
import {
  createSkillCreatorToolDescriptors,
  executeSkillCreatorToolCall,
  isSkillCreatorToolName,
} from '../skill/creator-tool';
import {
  createMemoryImportToolDescriptors,
  executeMemoryImportToolCall,
  isMemoryImportToolName,
} from '../memory/import-tool';
import {
  createBrowserControlToolDescriptors,
  executeBrowserControlToolCall,
  isBrowserControlToolName,
  shouldExposeBrowserControlTools,
} from '../browser-control/tool';
import { getWebToolSettings } from './web-settings';
import type { ToolCall, ToolDescriptor, ToolExecutionTrigger, ToolResult } from './types';
import type { RuntimeToolAuthorizationContext } from './types';
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

export interface RuntimeToolCallOptions extends McpToolExecutionOptions {}

const memoryRuntime: MemoryToolRuntime = {
  async saveMemory(input: NewMemory) {
    const id = await saveMemory(input);
    return { id };
  },
  async getMemoryById(id: number) {
    return (await getMemoryById(id)) ?? null;
  },
  async updateMemory(memory: Memory) {
    await updateMemory(memory);
  },
  async deleteMemory(id: number) {
    await deleteMemory(id);
  },
};

export async function getRuntimeToolDescriptors(
  locale: SupportedLocale = DEFAULT_LOCALE,
): Promise<ToolDescriptor[]> {
  return getRuntimeDescriptors(locale, false);
}

export async function getRuntimeAuthorizationDescriptors(
  locale: SupportedLocale = DEFAULT_LOCALE,
): Promise<ToolDescriptor[]> {
  return getRuntimeDescriptors(locale, true);
}

async function getRuntimeDescriptors(
  locale: SupportedLocale,
  includeDisabledMcp: boolean,
): Promise<ToolDescriptor[]> {
  const webSettings = await getWebToolSettings();
  const enabledWebDescriptors = createWebSearchToolDescriptors(locale).filter(
    (d) => webSettings[d.name as keyof typeof webSettings] !== false,
  );
  const browserControlDescriptors = await shouldExposeBrowserControlTools()
    ? createBrowserControlToolDescriptors(locale)
    : [];
  return [
    ...createMemoryToolDescriptors(locale),
    ...enabledWebDescriptors,
    ...createArtifactToolDescriptors(locale),
    ...createSkillCreatorToolDescriptors(locale),
    ...createMemoryImportToolDescriptors(locale),
    ...browserControlDescriptors,
    ...await getMcpToolDescriptors(includeDisabledMcp ? { includeDisabled: true } : undefined),
  ];
}

export async function refreshRuntimeToolDescriptors(
  locale: SupportedLocale = DEFAULT_LOCALE,
): Promise<ToolDescriptor[]> {
  const servers = await getAllMcpServers({ includeSecrets: false });
  await Promise.all(
    servers
      .filter((server) => server.enabled)
      .map((server) => refreshMcpServerDiscovery(server.id)),
  );
  return getRuntimeToolDescriptors(locale);
}

export async function executeRuntimeToolCall(
  call: ToolCall,
  authorization: RuntimeToolAuthorizationContext | ToolExecutionTrigger,
  locale: SupportedLocale = DEFAULT_LOCALE,
  options: RuntimeToolCallOptions = {},
): Promise<ToolResult> {
  if (!isToolCallRecord(call)) {
    return {
      ok: false,
      summary: translate(locale, 'tool.runtime.invalidFormat'),
      detail: 'Runtime tool call does not match the released contract.',
      name: typeof (call as { name?: unknown })?.name === 'string' ? call.name : undefined,
      error: {
        code: 'tool_call_payload_invalid',
        message: 'Runtime tool call does not match the released contract.',
        retryable: false,
      },
    };
  }
  const context = typeof authorization === 'string'
    ? createTrustedExecutionContext(call, authorization)
    : authorization;
  if (call.parseError) {
    const result = createParseErrorToolResult(call, locale);
    await appendAuthorizedFailureHistory(call, result, context);
    return result;
  }
  let authorized: Awaited<ReturnType<typeof authorizeToolExecution>>;
  try {
    authorized = await authorizeToolExecution(
      call,
      context,
      await getRuntimeAuthorizationDescriptors(locale),
    );
  } catch (error) {
    if (!(error instanceof ToolAuthorizationError)) throw error;
    const result = error.code === 'tool_unsupported'
      ? createUnsupportedToolResult(call, locale)
      : createToolAuthorizationResult(
        error,
        call,
        translate(locale, 'tool.runtime.authorizationRejected'),
      );
    await appendAuthorizedFailureHistory(call, result, context);
    return result;
  }

  let result: ToolResult;
  let resolvedCall = authorized.call;
  try {
    resolvedCall = await resolveToolCallPayload(
      authorized.call,
      authorized.externalPayloadNamespace,
    );
    result = await executeToolCallWithoutHistory(
      resolvedCall,
      authorized.descriptor,
      locale,
      options,
    );
  } catch (error) {
    await completeAuthorizationAfterProvider(authorized.reservation);
    throw error;
  }
  await completeAuthorizationAfterProvider(authorized.reservation, result);
  await appendRuntimeToolHistory(resolvedCall, result, authorized.trigger);
  return result;
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

async function executeToolCallWithoutHistory(
  call: ToolCall,
  descriptor: ToolDescriptor,
  locale: SupportedLocale,
  options: RuntimeToolCallOptions,
): Promise<ToolResult> {
  if (call.parseError) {
    return createParseErrorToolResult(call, locale);
  }

  if (descriptor.provider.kind === 'mcp') {
    return executeMcpToolCall(call, descriptor, options);
  }

  if (descriptor.provider.kind !== 'local') {
    return createUnsupportedToolResult(call, locale);
  }

  if (isMemoryToolName(call.name)) {
    return executeMemoryToolCall(await createMemoryRuntime(call), call, locale);
  }

  if (isWebSearchToolName(call.name)) {
    return executeWebSearchToolCall(call, locale);
  }

  if (isArtifactToolName(call.name)) {
    return executeArtifactToolCall(call, locale);
  }

  if (isSkillCreatorToolName(call.name)) {
    return executeSkillCreatorToolCall(call, locale);
  }

  if (isMemoryImportToolName(call.name)) {
    return executeMemoryImportToolCall(call, locale);
  }

  if (isBrowserControlToolName(call.name)) {
    return executeBrowserControlToolCall(call, locale);
  }

  return createUnsupportedToolResult(call, locale);
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

async function createMemoryRuntime(call: ToolCall): Promise<MemoryToolRuntime> {
  const chatSessionId = call.source?.chatSessionId ?? null;
  if (call.name !== 'memory_save' || !chatSessionId) return memoryRuntime;

  const project = await getProjectForConversation(chatSessionId);
  if (!project) return memoryRuntime;

  return {
    ...memoryRuntime,
    async saveMemory(input: NewMemory) {
      return memoryRuntime.saveMemory({
        ...input,
        scope: 'project',
        projectId: project.id,
      });
    },
  };
}
