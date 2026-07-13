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
import {
  isExternalizedToolPayload,
  parseExternalizedToolPayload,
  takeExternalizedToolPayloadText,
} from './externalized-payload';
import { isToolCallRecord } from '../messaging/tool-record-codec';

export type RuntimeToolCallOptions = McpToolExecutionOptions;

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
    ...await getMcpToolDescriptors(),
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
  source: ToolExecutionTrigger,
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
  const resolvedCall = await resolveToolCallPayload(call);
  const result = await executeToolCallWithoutHistory(resolvedCall, locale, options);
  try {
    await appendToolCallHistory(resolvedCall, result, source);
  } catch (error) {
    if (!isRecoverableToolHistoryError(error)) throw error;
    console.warn('[DeepSeek++] tool history persistence failed', error);
  }
  return result;
}

async function resolveToolCallPayload(call: ToolCall): Promise<ToolCall> {
  if (!isExternalizedToolPayload(call.payload)) return call;

  const body = takeExternalizedToolPayloadText(call.payload.ref, call.payload.invocationName);
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
  locale: SupportedLocale,
  options: RuntimeToolCallOptions,
): Promise<ToolResult> {
  if (call.parseError) {
    return {
      ok: false,
      summary: translate(locale, 'tool.runtime.invalidFormat'),
      detail: call.parseError.message,
      name: call.name,
      provider: call.provider,
      descriptorId: call.descriptorId,
      error: call.parseError,
    };
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

  if (call.provider?.kind === 'mcp' || call.descriptorId?.startsWith('mcp:')) {
    return executeMcpToolCall(call, options);
  }

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
