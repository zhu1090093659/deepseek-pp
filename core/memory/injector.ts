import { SYSTEM_TEMPLATE_CHAT, SYSTEM_TEMPLATE_THINKING } from '../constants';
import type { Memory } from '../types';
import { estimateTokens, formatMemoriesBlock, getMemoryBudget, selectMemories } from './selector';

export interface AugmentOptions {
  thinkingEnabled?: boolean;
  identityOnly?: boolean;
}

export function buildAugmentedPrompt(
  originalPrompt: string,
  allMemories: Memory[],
  options?: AugmentOptions,
): { augmented: string; usedMemoryIds: number[] } {
  const { thinkingEnabled = false, identityOnly = false } = options ?? {};

  const promptTokens = estimateTokens(originalPrompt);
  const budget = getMemoryBudget(promptTokens);

  const selected = selectMemories(originalPrompt, allMemories, { budget, identityOnly });
  const memBlock = formatMemoriesBlock(selected);

  const template = thinkingEnabled ? SYSTEM_TEMPLATE_THINKING : SYSTEM_TEMPLATE_CHAT;
  const system = template.replace('{{memories}}', memBlock);

  return {
    augmented: system + originalPrompt,
    usedMemoryIds: selected.map((m) => m.id!).filter(Boolean),
  };
}
