import {
  definePayloadlessRuntimeCommandHandler,
  type RuntimeCommandHandler,
} from '../../core/messaging/runtime-command-registry';
import {
  MULTIMODAL_MCP_REQUEST_TIMEOUT_MS,
  canUseMultimodalMediaInput,
  isMultimodalAnalysisToolAllowed,
  isMultimodalMcpServer,
} from '../../core/multimodal';
import type {
  MultimodalMediaAnalysisItem,
  MultimodalMediaAnalyzeRequest,
  MultimodalMediaAnalyzeResponse,
  MultimodalMediaInput,
} from '../../core/multimodal/media';
import type {
  MultimodalSettingsPatch,
  MultimodalSettingsStatus,
} from '../../core/multimodal/settings-contracts';
import type { McpServerConfig } from '../../core/mcp/types';
import type { RuntimeToolCallOptions } from '../../core/tool/runtime';
import type { ToolCall, ToolResult } from '../../core/tool/types';
import { defineDeepSeekPayloadRuntimeCommandHandler } from './runtime-handler';

export interface MultimodalRuntimeHandlerDependencies {
  getSettingsStatus(): Promise<MultimodalSettingsStatus>;
  saveSettings(patch: MultimodalSettingsPatch): Promise<MultimodalSettingsStatus>;
  clearSettings(): Promise<MultimodalSettingsStatus>;
  getMcpServers(): Promise<McpServerConfig[]>;
  executeToolCall(
    call: ToolCall,
    options: RuntimeToolCallOptions,
  ): Promise<ToolResult>;
  broadcastToolCallHistoryUpdate(excludeTabId?: number): Promise<void>;
}

export function createMultimodalRuntimeHandlers(
  dependencies: MultimodalRuntimeHandlerDependencies,
): readonly RuntimeCommandHandler[] {
  return Object.freeze([
    definePayloadlessRuntimeCommandHandler('GET_MULTIMODAL_SETTINGS_STATUS', async () => ({
      ok: true as const,
      ...(await dependencies.getSettingsStatus()),
    })),
    defineDeepSeekPayloadRuntimeCommandHandler('SAVE_MULTIMODAL_SETTINGS', async (payload) => ({
      ok: true as const,
      ...(await dependencies.saveSettings(payload)),
    })),
    definePayloadlessRuntimeCommandHandler('CLEAR_MULTIMODAL_SETTINGS', async () => ({
      ok: true as const,
      ...(await dependencies.clearSettings()),
    })),
    defineDeepSeekPayloadRuntimeCommandHandler('ANALYZE_MULTIMODAL_MEDIA', async (decoded, context) => {
      const response = decoded.ok
        ? await analyzeMultimodalMedia(decoded.request, dependencies)
        : { ok: false as const, analyses: [], error: decoded.error };
      await dependencies.broadcastToolCallHistoryUpdate(context.tabId);
      return response;
    }),
  ]);
}

async function analyzeMultimodalMedia(
  request: MultimodalMediaAnalyzeRequest,
  dependencies: MultimodalRuntimeHandlerDependencies,
): Promise<MultimodalMediaAnalyzeResponse> {
  try {
    const server = await getMultimodalMcpServerForAnalysis(dependencies);
    const analyses: MultimodalMediaAnalysisItem[] = [];
    const images = request.media.filter((item) => item.kind === 'image');

    if (images.length > 0) {
      const result = await dependencies.executeToolCall(
        createMultimodalMcpToolCall(server, 'analyze_images', {
          prompt: request.prompt,
          images: images.map((item, index) => ({
            type: 'input_image',
            image_url: item.dataUrl!,
            detail: 'auto',
            label: item.name || `image-${index + 1}`,
          })),
          output_schema: 'general',
        }, request),
        { timeoutMs: MULTIMODAL_MCP_REQUEST_TIMEOUT_MS },
      );
      const analysis = createMultimodalAnalysisItem(
        `images:${images.map((item) => item.id).join(',')}`,
        'image',
        images,
        result,
      );
      if (!result.ok) {
        return {
          ok: false,
          analyses: [analysis],
          error: result.detail || result.summary,
        };
      }
      analyses.push(analysis);
    }

    for (const video of request.media.filter((item) => item.kind === 'video')) {
      const result = await dependencies.executeToolCall(
        createMultimodalMcpToolCall(server, 'analyze_video', {
          prompt: request.prompt,
          video: {
            inlineData: {
              data: video.base64Data!,
              mimeType: video.mimeType,
            },
            mimeType: video.mimeType,
          },
          output_schema: 'summary',
        }, request),
        { timeoutMs: MULTIMODAL_MCP_REQUEST_TIMEOUT_MS },
      );
      const analysis = createMultimodalAnalysisItem(video.id, 'video', [video], result);
      if (!result.ok) {
        return {
          ok: false,
          analyses: [...analyses, analysis],
          error: result.detail || result.summary,
        };
      }
      analyses.push(analysis);
    }

    return { ok: true, analyses };
  } catch (error) {
    return {
      ok: false,
      analyses: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function getMultimodalMcpServerForAnalysis(
  dependencies: MultimodalRuntimeHandlerDependencies,
): Promise<McpServerConfig> {
  const server = (await dependencies.getMcpServers()).find(isMultimodalMcpServer);
  if (!server) {
    throw new Error('Multimodal MCP preset is missing. Create it on the MCP page first.');
  }
  if (!server.enabled) {
    throw new Error('Multimodal MCP server is disabled. Enable it on the MCP page first.');
  }
  if (!server.execution.enabled || server.execution.mode === 'disabled') {
    throw new Error('Multimodal MCP execution is disabled. Enable execution on the MCP page first.');
  }
  if (!isMultimodalAnalysisToolAllowed(server.allowlist)) {
    throw new Error(
      'Multimodal MCP analysis tools are disabled. Enable analyze_images or analyze_video on the MCP page first.',
    );
  }
  if (!canUseMultimodalMediaInput(server)) {
    throw new Error('Multimodal MCP is not available for media analysis.');
  }
  return server;
}

function createMultimodalMcpToolCall(
  server: McpServerConfig,
  name: 'analyze_images' | 'analyze_video',
  payload: Record<string, unknown>,
  request: MultimodalMediaAnalyzeRequest,
): ToolCall {
  return {
    name,
    payload,
    raw: '',
    provider: {
      kind: 'mcp',
      id: server.id,
      displayName: server.displayName,
      transport: server.transport.kind,
    },
    source: {
      trigger: 'manual_chat',
      chatSessionId: request.chatSessionId ?? null,
      parentMessageId: request.parentMessageId ?? null,
    },
  };
}

function createMultimodalAnalysisItem(
  id: string,
  kind: 'image' | 'video',
  media: readonly MultimodalMediaInput[],
  result: ToolResult,
): MultimodalMediaAnalysisItem {
  return {
    id,
    kind,
    media: media.map((item) => ({
      id: item.id,
      kind: item.kind,
      name: item.name,
      mimeType: item.mimeType,
      sizeBytes: item.sizeBytes,
    })),
    result,
  };
}
