/**
 * MiniMax pi-ai provider registration.
 *
 * The provider uses pi-ai's lazy API adapters so merely importing this module
 * does not pull the OpenAI or Anthropic SDK into the extension's static graph.
 * A host chooses the regional endpoint and wire protocol when constructing the
 * provider; credentials are injected through `resolveApiKey`.
 */
import { createProvider } from '@earendil-works/pi-ai';
import { anthropicMessagesApi } from '@earendil-works/pi-ai/api/anthropic-messages.lazy';
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy';
import type { Model } from '@earendil-works/pi-ai';
import {
  MINIMAX_ANTHROPIC_API,
  MINIMAX_CN_PROVIDER,
  MINIMAX_ENDPOINTS,
  MINIMAX_MODEL_IDS,
  MINIMAX_OPENAI_API,
  MINIMAX_PROVIDER,
  type MiniMaxModelId,
  type MiniMaxProviderOptions,
  type MiniMaxProtocol,
  type MiniMaxRegion,
} from './minimax-provider-port';

export {
  MINIMAX_ANTHROPIC_API,
  MINIMAX_CN_PROVIDER,
  MINIMAX_ENDPOINTS,
  MINIMAX_MODEL_IDS,
  MINIMAX_MODEL_METADATA,
  MINIMAX_OPENAI_API,
  MINIMAX_PROVIDER,
} from './minimax-provider-port';
export type {
  MiniMaxApiKeyResolver,
  MiniMaxModelId,
  MiniMaxProviderFactory,
  MiniMaxProviderOptions,
  MiniMaxProtocol,
  MiniMaxRegion,
} from './minimax-provider-port';

type MiniMaxApi = typeof MINIMAX_OPENAI_API | typeof MINIMAX_ANTHROPIC_API;

interface MiniMaxModelMetadata {
  id: MiniMaxModelId;
  contextWindow: number;
  cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
  reasoning: boolean;
  input: ('text' | 'image')[];
  maxTokens: number;
}

const MODEL_METADATA: readonly MiniMaxModelMetadata[] = [
  {
    id: 'MiniMax-M3',
    contextWindow: 1_000_000,
    maxTokens: 128_000,
    // The published M3 sheet omits a cache-write charge. pi-ai's numeric
    // model cost uses zero for an omitted rate.
    cost: { input: 0.6, output: 2.4, cacheRead: 0.12, cacheWrite: 0 },
    reasoning: true,
    // pi-ai currently models text/image input; video remains a documented
    // endpoint capability but is not advertised as a prompt block type.
    input: ['text', 'image'],
  },
  {
    id: 'MiniMax-M2.7',
    contextWindow: 204_800,
    maxTokens: 131_072,
    cost: { input: 0.3, output: 1.2, cacheRead: 0.06, cacheWrite: 0.375 },
    reasoning: true,
    input: ['text'],
  },
] as const;

/** Build the static MiniMax model catalog for one region/protocol. */
export function createMiniMaxModels(
  region: MiniMaxRegion = 'global_en',
  protocol: MiniMaxProtocol = 'anthropic',
  providerId: string = region === 'cn_zh' ? MINIMAX_CN_PROVIDER : MINIMAX_PROVIDER,
): Model<MiniMaxApi>[] {
  const endpoint = MINIMAX_ENDPOINTS[region];
  const api = protocol === 'openai' ? MINIMAX_OPENAI_API : MINIMAX_ANTHROPIC_API;
  const baseUrl = protocol === 'openai' ? endpoint.openaiBaseUrl : endpoint.anthropicBaseUrl;
  return MODEL_METADATA.map((metadata) => ({
    ...metadata,
    name: metadata.id,
    id: metadata.id,
    api,
    provider: providerId,
    baseUrl,
    // M3 supports adaptive thinking (or disabled); M2.7 is always-on. The
    // map keeps pi's thinking-level contract explicit without inventing a
    // provider-specific option type.
    thinkingLevelMap: metadata.id === 'MiniMax-M3'
      ? { off: 'disabled', minimal: 'adaptive', low: 'adaptive', medium: 'adaptive', high: 'adaptive', xhigh: 'adaptive', max: 'adaptive' }
      : { off: 'always_on', minimal: 'always_on', low: 'always_on', medium: 'always_on', high: 'always_on', xhigh: 'always_on', max: 'always_on' },
  }));
}

/** Build a MiniMax provider for the requested region and wire protocol. */
export function createMiniMaxProvider(options: MiniMaxProviderOptions = {}): ReturnType<typeof createProvider<MiniMaxApi>> {
  const region = options.region ?? 'global_en';
  const protocol = options.protocol ?? 'anthropic';
  const providerId = region === 'cn_zh' ? MINIMAX_CN_PROVIDER : MINIMAX_PROVIDER;
  const models = createMiniMaxModels(region, protocol, providerId);
  const resolveApiKey = options.resolveApiKey;

  return createProvider({
    id: providerId,
    name: region === 'cn_zh' ? 'MiniMax CN' : 'MiniMax',
    baseUrl: models[0]?.baseUrl,
    auth: {
      apiKey: {
        name: region === 'cn_zh' ? 'MiniMax CN API key' : 'MiniMax API key',
        resolve: async () => {
          const apiKey = await resolveApiKey?.();
          if (!apiKey) return undefined;
          return {
            auth: { apiKey },
            source: region === 'cn_zh' ? 'MiniMax CN API key' : 'MiniMax API key',
          };
        },
      },
    },
    models,
    api: protocol === 'openai' ? openAICompletionsApi() : anthropicMessagesApi(),
  });
}

/** Convenience factory for the China regional endpoint. */
export function createMiniMaxCnProvider(
  options: Omit<MiniMaxProviderOptions, 'region'> = {},
): ReturnType<typeof createProvider<MiniMaxApi>> {
  return createMiniMaxProvider({ ...options, region: 'cn_zh' });
}
