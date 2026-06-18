import type { McpServerCreateInput } from '../mcp/types';
import { MULTIMODAL_MCP_NATIVE_HOST, MULTIMODAL_MCP_SERVER_NAME } from './contracts';
import { MULTIMODAL_MEDIA_MAX_ITEMS_PER_TURN, type MultimodalMediaKind } from './media';

export const MULTIMODAL_MCP_CONNECT_TIMEOUT_MS = 5_000;
export const MULTIMODAL_MCP_REQUEST_TIMEOUT_MS = 180_000;
export const MULTIMODAL_MCP_DISCOVERY_TIMEOUT_MS = 10_000;
export const MULTIMODAL_REQUEST_AUGMENTATION_TIMEOUT_MS = MULTIMODAL_MCP_REQUEST_TIMEOUT_MS + 10_000;
export const MULTIMODAL_REQUEST_AUGMENTATION_MAX_TIMEOUT_MS =
  MULTIMODAL_MEDIA_MAX_ITEMS_PER_TURN * MULTIMODAL_REQUEST_AUGMENTATION_TIMEOUT_MS;

export interface MultimodalRequestAugmentationMedia {
  kind: MultimodalMediaKind;
}

export function calculateMultimodalRequestAugmentationTimeoutMs(
  media: readonly MultimodalRequestAugmentationMedia[],
): number {
  const imageRequestCount = media.some((item) => item.kind === 'image') ? 1 : 0;
  const videoRequestCount = media.filter((item) => item.kind === 'video').length;
  const requestCount = Math.max(1, imageRequestCount + videoRequestCount);
  return Math.min(
    requestCount * MULTIMODAL_REQUEST_AUGMENTATION_TIMEOUT_MS,
    MULTIMODAL_REQUEST_AUGMENTATION_MAX_TIMEOUT_MS,
  );
}

export interface MultimodalMcpPresetOptions {
  nativeHost?: string;
  enabled?: boolean;
  executionEnabled?: boolean;
}

export function createMultimodalMcpPresetInput(
  options: MultimodalMcpPresetOptions = {},
): McpServerCreateInput {
  return {
    displayName: MULTIMODAL_MCP_SERVER_NAME,
    enabled: options.enabled ?? false,
    transport: {
      kind: 'native_messaging',
      nativeHost: options.nativeHost ?? MULTIMODAL_MCP_NATIVE_HOST,
    },
    headers: [],
    secrets: [],
    timeouts: {
      connectMs: MULTIMODAL_MCP_CONNECT_TIMEOUT_MS,
      requestMs: MULTIMODAL_MCP_REQUEST_TIMEOUT_MS,
      discoveryMs: MULTIMODAL_MCP_DISCOVERY_TIMEOUT_MS,
    },
    limits: {
      maxResultBytes: 128_000,
      maxToolCount: 8,
    },
    allowlist: {
      mode: 'allow',
      toolNames: ['vision_status'],
    },
    execution: {
      enabled: options.executionEnabled ?? false,
      mode: 'manual',
    },
  };
}
