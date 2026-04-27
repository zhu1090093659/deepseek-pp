import { SYSTEM_TEMPLATE } from '../constants';
import type { Memory } from '../types';
import { formatMemoriesBlock, selectMemories } from './selector';

export function buildAugmentedPrompt(
  originalPrompt: string,
  allMemories: Memory[],
): { augmented: string; usedMemoryIds: number[] } {
  const selected = selectMemories(originalPrompt, allMemories);
  const memBlock = formatMemoriesBlock(selected);
  const system = SYSTEM_TEMPLATE.replace('{{memories}}', memBlock);
  return {
    augmented: system + originalPrompt,
    usedMemoryIds: selected.map((m) => m.id!).filter(Boolean),
  };
}
