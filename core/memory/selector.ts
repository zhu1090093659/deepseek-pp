import type { Memory } from '../types';
import { MEMORY_TOKEN_BUDGET } from '../constants';

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 1.5);
}

function keywordScore(prompt: string, memory: Memory): number {
  const promptLower = prompt.toLowerCase();
  const words = [
    ...memory.tags,
    ...memory.name.split(/\s+/),
    ...memory.content.split(/\s+/).filter((w) => w.length > 2),
  ];
  let hits = 0;
  for (const word of words) {
    if (word.length > 1 && promptLower.includes(word.toLowerCase())) {
      hits++;
    }
  }
  return hits;
}

export function selectMemories(prompt: string, allMemories: Memory[]): Memory[] {
  if (allMemories.length === 0) return [];

  const scored = allMemories.map((m) => ({
    memory: m,
    score:
      (m.pinned ? 1000 : 0) +
      keywordScore(prompt, m) * 10 +
      Math.min(m.accessCount, 20) +
      (Date.now() - m.lastAccessedAt < 3600_000 ? 5 : 0),
  }));

  scored.sort((a, b) => b.score - a.score);

  const selected: Memory[] = [];
  let budget = MEMORY_TOKEN_BUDGET;

  for (const { memory } of scored) {
    const cost = estimateTokens(formatMemoryLine(memory));
    if (budget - cost < 0 && selected.length > 0) break;
    selected.push(memory);
    budget -= cost;
  }

  return selected;
}

export function formatMemoryLine(m: Memory): string {
  return `- [${m.type}] ${m.name}: ${m.content}`;
}

export function formatMemoriesBlock(memories: Memory[]): string {
  if (memories.length === 0) return '(暂无记忆)';
  return memories.map(formatMemoryLine).join('\n');
}
