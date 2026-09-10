/**
 * MiniMax pi-ai provider contract.
 *
 * This module intentionally contains only the serialisable provider surface
 * and target metadata.  Runtime credentials are supplied by the caller (the
 * provider never reads process.env, browser storage, or repository secrets).
 */
import type { Provider } from '@earendil-works/pi-ai';

/** API ids used by the MiniMax OpenAI-compatible and Anthropic endpoints. */
export const MINIMAX_OPENAI_API = 'openai-completions' as const;
export const MINIMAX_ANTHROPIC_API = 'anthropic-messages' as const;

/** Provider ids for the global and China regional registrations. */
export const MINIMAX_PROVIDER = 'minimax' as const;
export const MINIMAX_CN_PROVIDER = 'minimax-cn' as const;

/** Models currently exposed by the MiniMax text API. */
export const MINIMAX_MODEL_IDS = ['MiniMax-M3', 'MiniMax-M2.7'] as const;
export type MiniMaxModelId = (typeof MINIMAX_MODEL_IDS)[number];

export const MINIMAX_ENDPOINTS = {
  global_en: {
    openaiBaseUrl: 'https://api.minimax.io/v1',
    anthropicBaseUrl: 'https://api.minimax.io/anthropic',
  },
  cn_zh: {
    openaiBaseUrl: 'https://api.minimaxi.com/v1',
    anthropicBaseUrl: 'https://api.minimaxi.com/anthropic',
  },
} as const;
export type MiniMaxRegion = keyof typeof MINIMAX_ENDPOINTS;
export type MiniMaxProtocol = 'openai' | 'anthropic';

/** Published target facts retained alongside pi-ai's narrower Model shape. */
export const MINIMAX_MODEL_METADATA = {
  'MiniMax-M3': {
    contextWindow: 1_000_000,
    inputModalities: ['text', 'image', 'video'],
    thinking: ['adaptive', 'disabled'],
    pricingUsdPerMillionTokens: { input: 0.6, output: 2.4, cacheRead: 0.12, cacheWrite: null },
  },
  'MiniMax-M2.7': {
    contextWindow: 204_800,
    inputModalities: ['text'],
    thinking: ['always_on'],
    pricingUsdPerMillionTokens: { input: 0.3, output: 1.2, cacheRead: 0.06, cacheWrite: 0.375 },
  },
} as const;

/**
 * Auth resolver supplied by the host.  Undefined means that MiniMax is not
 * configured; no ambient environment or browser credential is consulted.
 */
export type MiniMaxApiKeyResolver = () => string | undefined | null | Promise<string | undefined | null>;

export interface MiniMaxProviderOptions {
  region?: MiniMaxRegion;
  protocol?: MiniMaxProtocol;
  resolveApiKey?: MiniMaxApiKeyResolver;
}

export type MiniMaxProviderFactory = (
  options?: MiniMaxProviderOptions,
) => Provider<'openai-completions' | 'anthropic-messages'>;
