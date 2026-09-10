import { describe, expect, it } from 'vitest';
import type { Provider } from '@earendil-works/pi-ai';
import {
  createMiniMaxCnProvider,
  createMiniMaxModels,
  createMiniMaxProvider,
  MINIMAX_ANTHROPIC_API,
  MINIMAX_ENDPOINTS,
  MINIMAX_MODEL_IDS,
  MINIMAX_OPENAI_API,
  MINIMAX_PROVIDER,
} from '../core/inline-agent/pi/minimax-provider';

describe('MiniMax provider registration', () => {
  it('exposes the target model metadata on the global Anthropic endpoint', () => {
    const models = createMiniMaxModels();
    expect(models.map((model) => model.id)).toEqual([...MINIMAX_MODEL_IDS]);
    expect(models.every((model) => model.api === MINIMAX_ANTHROPIC_API)).toBe(true);
    expect(models.every((model) => model.provider === MINIMAX_PROVIDER)).toBe(true);
    expect(models[0]).toMatchObject({
      id: 'MiniMax-M3',
      contextWindow: 1_000_000,
      input: ['text', 'image'],
      cost: { input: 0.6, output: 2.4, cacheRead: 0.12 },
    });
    expect(models[1]).toMatchObject({
      id: 'MiniMax-M2.7',
      contextWindow: 204_800,
      input: ['text'],
      cost: { input: 0.3, output: 1.2, cacheRead: 0.06, cacheWrite: 0.375 },
    });
  });

  it('supports both regions and OpenAI-compatible endpoint selection', () => {
    const models = createMiniMaxModels('cn_zh', 'openai');
    expect(models.map((model) => model.api)).toEqual([MINIMAX_OPENAI_API, MINIMAX_OPENAI_API]);
    expect(models.every((model) => model.baseUrl === MINIMAX_ENDPOINTS.cn_zh.openaiBaseUrl)).toBe(true);
    const provider = createMiniMaxCnProvider({ protocol: 'openai', resolveApiKey: () => 'test-key' });
    expect(provider.id).toBe('minimax-cn');
    expect(provider.baseUrl).toBe(MINIMAX_ENDPOINTS.cn_zh.openaiBaseUrl);
  });

  it('keeps credentials injected and reports an unconfigured provider without a key', async () => {
    const provider: Provider = createMiniMaxProvider();
    expect(await provider.auth.apiKey?.resolve({ ctx: {} as never, credential: undefined })).toBeUndefined();
    const configured = createMiniMaxProvider({ resolveApiKey: () => 'test-key' });
    expect(await configured.auth.apiKey?.resolve({ ctx: {} as never, credential: undefined })).toMatchObject({
      auth: { apiKey: 'test-key' },
      source: 'MiniMax API key',
    });
  });
});
