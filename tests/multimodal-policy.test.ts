import { describe, expect, it } from 'vitest';
import {
  calculateMultimodalRequestAugmentationTimeoutMs,
  createMultimodalMcpPresetInput,
  MULTIMODAL_MCP_CONNECT_TIMEOUT_MS,
  MULTIMODAL_MCP_DISCOVERY_TIMEOUT_MS,
  MULTIMODAL_MCP_REQUEST_TIMEOUT_MS,
  MULTIMODAL_REQUEST_AUGMENTATION_MAX_TIMEOUT_MS,
  MULTIMODAL_REQUEST_AUGMENTATION_TIMEOUT_MS,
} from '../core/multimodal/policy';
import { MULTIMODAL_MCP_NATIVE_HOST, MULTIMODAL_MCP_SERVER_NAME } from '../core/multimodal/contracts';

describe('createMultimodalMcpPresetInput', () => {
  it('defaults Multimodal MCP to explicit manual opt-in', () => {
    const preset = createMultimodalMcpPresetInput();

    expect(preset.displayName).toBe(MULTIMODAL_MCP_SERVER_NAME);
    expect(preset.enabled).toBe(false);
    expect(preset.transport).toEqual({
      kind: 'native_messaging',
      nativeHost: MULTIMODAL_MCP_NATIVE_HOST,
    });
    expect(preset.timeouts).toEqual({
      connectMs: MULTIMODAL_MCP_CONNECT_TIMEOUT_MS,
      requestMs: MULTIMODAL_MCP_REQUEST_TIMEOUT_MS,
      discoveryMs: MULTIMODAL_MCP_DISCOVERY_TIMEOUT_MS,
    });
    expect(preset.allowlist).toEqual({ mode: 'allow', toolNames: ['vision_status'] });
    expect(preset.execution).toEqual({ enabled: false, mode: 'manual' });
  });
});

describe('calculateMultimodalRequestAugmentationTimeoutMs', () => {
  it('uses one augmentation budget for image batches or a single video', () => {
    expect(calculateMultimodalRequestAugmentationTimeoutMs([
      { kind: 'image' },
      { kind: 'image' },
    ])).toBe(MULTIMODAL_REQUEST_AUGMENTATION_TIMEOUT_MS);
    expect(calculateMultimodalRequestAugmentationTimeoutMs([
      { kind: 'video' },
    ])).toBe(MULTIMODAL_REQUEST_AUGMENTATION_TIMEOUT_MS);
  });

  it('accounts for serial video analysis after the image batch', () => {
    expect(calculateMultimodalRequestAugmentationTimeoutMs([
      { kind: 'image' },
      { kind: 'video' },
      { kind: 'video' },
    ])).toBe(3 * MULTIMODAL_REQUEST_AUGMENTATION_TIMEOUT_MS);
  });

  it('caps the bridge wait to the maximum media turn budget', () => {
    expect(calculateMultimodalRequestAugmentationTimeoutMs(
      Array.from({ length: 20 }, () => ({ kind: 'video' as const })),
    )).toBe(MULTIMODAL_REQUEST_AUGMENTATION_MAX_TIMEOUT_MS);
  });
});
