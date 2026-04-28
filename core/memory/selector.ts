import type { Memory } from '../types';
import { MEMORY_TOKEN_BUDGET, STOP_WORDS } from '../constants';

const segmenter =
  typeof Intl !== 'undefined' && Intl.Segmenter
    ? new Intl.Segmenter('zh-Hans', { granularity: 'word' })
    : null;

export function segmentText(text: string): string[] {
  if (segmenter) {
    return [...segmenter.segment(text)]
      .filter((s) => s.isWordLike)
      .map((s) => s.segment.toLowerCase())
      .filter((w) => w.length > 1 && !STOP_WORDS.has(w));
  }
  return text
    .toLowerCase()
    .split(/[\s,，。！？；：、\-_/]+/)
    .filter((w) => w.length > 1 && !STOP_WORDS.has(w));
}

export function estimateTokens(text: string): number {
  let tokens = 0;
  for (const char of text) {
    tokens += char.charCodeAt(0) > 0x7F ? 1.5 : 0.25;
  }
  return Math.ceil(tokens);
}

function keywordScore(promptWords: string[], memory: Memory): number {
  const promptSet = new Set(promptWords);

  let tagHits = 0;
  for (const tag of memory.tags) {
    const tagLower = tag.toLowerCase();
    if (tagLower.length > 1 && promptSet.has(tagLower)) tagHits++;
    for (const pw of promptWords) {
      if (pw.length > 2 && tagLower.includes(pw) && tagLower !== pw) tagHits += 0.5;
    }
  }

  const nameWords = segmentText(memory.name);
  let nameHits = 0;
  for (const w of nameWords) {
    if (promptSet.has(w)) nameHits++;
  }

  const contentWords = segmentText(memory.content);
  let contentHits = 0;
  for (const w of contentWords) {
    if (promptSet.has(w)) contentHits++;
  }

  return tagHits * 20 + nameHits * 15 + contentHits * 5;
}

function decayScore(memory: Memory): number {
  const daysSinceAccess = (Date.now() - memory.lastAccessedAt) / 86_400_000;
  const freshness = Math.max(0, 10 - daysSinceAccess * 0.1);
  return Math.min(memory.accessCount, 20) + freshness;
}

export interface SelectOptions {
  budget?: number;
  identityOnly?: boolean;
}

export function getMemoryBudget(promptTokens: number): number {
  if (promptTokens > 3000) {
    return Math.max(800, MEMORY_TOKEN_BUDGET - Math.floor((promptTokens - 3000) * 0.2));
  }
  return MEMORY_TOKEN_BUDGET;
}

export function selectMemories(
  prompt: string,
  allMemories: Memory[],
  options?: SelectOptions,
): Memory[] {
  if (allMemories.length === 0) return [];

  const { budget = MEMORY_TOKEN_BUDGET, identityOnly = false } = options ?? {};

  const candidates = identityOnly
    ? allMemories.filter((m) => m.type === 'user' || m.type === 'feedback' || m.pinned)
    : allMemories;

  if (candidates.length === 0) return [];

  const promptWords = segmentText(prompt);

  const scored = candidates.map((m) => ({
    memory: m,
    score:
      (m.pinned ? 1000 : 0) +
      keywordScore(promptWords, m) +
      decayScore(m) +
      (Date.now() - m.lastAccessedAt < 3600_000 ? 5 : 0),
  }));

  scored.sort((a, b) => b.score - a.score);

  const selected: Memory[] = [];
  let remaining = budget;

  for (const { memory } of scored) {
    const cost = estimateTokens(formatMemoryLine(memory));
    if (remaining - cost < 0 && selected.length > 0) break;
    selected.push(memory);
    remaining -= cost;
  }

  return selected;
}

function sanitizeContent(text: string): string {
  return text.replace(/｜DSML｜/g, '|DSML|');
}

export function formatMemoryLine(m: Memory): string {
  return `- [${m.type}] ${sanitizeContent(m.name)}: ${sanitizeContent(m.content)}`;
}

export function formatMemoriesBlock(memories: Memory[]): string {
  if (memories.length === 0) return '(暂无记忆)';
  return memories.map(formatMemoryLine).join('\n');
}
