import type { ToolExecutionRecord } from '../types';
import type { PromptBudget } from '../prompt/types';
import { createDefaultBudget, estimateTokens, COMPRESSION_SOFT_THRESHOLD, COMPRESSION_HARD_THRESHOLD } from '../prompt/types';

export type { PromptBudget };
export { createDefaultBudget, COMPRESSION_SOFT_THRESHOLD, COMPRESSION_HARD_THRESHOLD };

/**
 * Calculate current estimated token usage from a session.
 */
export function estimateSessionTokens(
  systemPrompt: string,
  toolDefinitions: string,
  instructions: string,
  toolResults: ToolExecutionRecord[],
  conversationHistory: string[],
): number {
  return (
    estimateTokens(systemPrompt) +
    estimateTokens(toolDefinitions) +
    estimateTokens(instructions) +
    toolResults.reduce((sum, r) => sum + estimateTokenUsage(r), 0) +
    conversationHistory.reduce((sum, t) => sum + estimateTokens(t), 0)
  );
}

function estimateTokenUsage(exec: ToolExecutionRecord): number {
  const r = exec.result;
  let total = 0;
  if (r.summary) total += estimateTokens(r.summary);
  if (r.detail) total += estimateTokens(r.detail);
  if (r.error) total += estimateTokens(typeof r.error === 'string' ? r.error : r.error.message || '');
  if (r.output) {
    if (typeof r.output === 'string') total += estimateTokens(r.output);
    else total += estimateTokens(JSON.stringify(r.output));
  }
  return Math.max(20, total); // minimum 20 tokens per record
}

/**
 * Score a tool execution by importance for pruning decisions.
 * Higher score = keep priority.
 */
function scoreToolExecution(exec: ToolExecutionRecord, index: number, total: number): number {
  const r = exec.result;
  let score = 0;

  // Recency: newer results are more important
  score += (index / total) * 10; // 0-10

  // Errors are most important
  if (!r.ok || r.error) score += 50;
  if (r.truncated) score += 5; // truncated results might need re-reading

  // File edits and writes are important
  if (exec.name === 'file_edit' || exec.name === 'file_write') score += 30;
  if (exec.name === 'file_read') score += 15; // current file state

  // Git state
  if (exec.name === 'git_status') score += 25;
  if (exec.name === 'git_diff') score += 20;
  if (exec.name === 'git_commit') score += 20;

  // Build/test output
  if (exec.name === 'shell_exec' || exec.name === 'python_exec') {
    if (!r.ok) score += 35; // failed commands are very important
    else score -= 5; // successful commands less so
  }

  // Search results can be re-fetched
  if (exec.name === 'file_search' || exec.name === 'code_search') score -= 10;

  // shell status / python status / git log are reference — low priority
  if (['shell_status', 'python_status', 'git_log', 'git_branch', 'local_skill_preview'].includes(exec.name)) {
    score -= 15;
  }

  return score;
}

/**
 * Prune tool results by priority score within a token budget.
 */
export function pruneToolResults(
  executions: ToolExecutionRecord[],
  maxTokens: number = 5_000,
): ToolExecutionRecord[] {
  if (executions.length === 0) return executions;

  // Score and sort
  const total = executions.length;
  const scored = executions.map((exec, i) => ({
    exec,
    score: scoreToolExecution(exec, i, total),
    index: i,
  }));

  scored.sort((a, b) => b.score - a.score || a.index - b.index);

  // Select within budget
  const kept: ToolExecutionRecord[] = [];
  let usedTokens = 0;

  for (const item of scored) {
    const tokens = estimateTokenUsage(item.exec);
    if (usedTokens + tokens > maxTokens && kept.length > 0) continue;
    // Always keep at least 1 item (the highest priority one)
    if (usedTokens + tokens > maxTokens) {
      // If this is the first item, keep it even if over budget
      if (kept.length === 0) kept.push(item.exec);
      continue;
    }
    kept.push(item.exec);
    usedTokens += tokens;
  }

  // Restore original order
  kept.sort((a, b) => executions.indexOf(a) - executions.indexOf(b));

  return kept;
}

/**
 * Compress tool results into compact summary format.
 * Drops detailed output, keeps only summary + errors.
 */
export function compressToolResults(executions: ToolExecutionRecord[]): string {
  const parts: string[] = ['<compressed_tool_results>'];

  for (const exec of executions) {
    const r = exec.result;
    if (!r.ok) {
      parts.push(`[FAIL] ${exec.name}: ${r.error || r.summary}`);
    } else if (exec.name === 'file_edit' || exec.name === 'file_write') {
      parts.push(`[EDIT] ${exec.name}: ${r.summary}`);
    } else if (exec.name === 'git_status') {
      parts.push(`[GIT] ${r.summary}`);
    } else if (exec.name === 'file_read') {
      const data = r.output as any;
      const path = data?.path || '';
      parts.push(`[READ] ${path}: ${r.summary}`);
    } else {
      parts.push(`[OK] ${exec.name}: ${r.summary || 'completed'}`);
    }
  }

  parts.push('</compressed_tool_results>');
  return parts.join('\n');
}

/**
 * Compress a file read result to first N / last N lines.
 */
export function compressFileContent(
  content: string,
  headLines: number = 15,
  tailLines: number = 15,
): string {
  const lines = content.split('\n');
  if (lines.length <= headLines + tailLines + 5) return content;

  const head = lines.slice(0, headLines).join('\n');
  const tail = lines.slice(-tailLines).join('\n');
  const removed = lines.length - headLines - tailLines;
  return `${head}\n... [${removed} lines omitted]\n${tail}`;
}

/**
 * Build a context summary for continuation prompts.
 */
export function buildContextSummary(
  originalTask: string,
  changedFiles: string[],
  totalSteps: number,
  totalTools: number,
  failedTools: number,
): string {
  return [
    '<context_summary>',
    `Task: ${originalTask.slice(0, 300)}`,
    `Progress: ${totalSteps} steps, ${totalTools} tool calls, ${failedTools} failures`,
    changedFiles.length > 0 ? `Files changed: ${changedFiles.join(', ')}` : '',
    '</context_summary>',
  ].filter(Boolean).join('\n');
}

/**
 * Determine if compression is needed based on estimated token usage.
 */
export function needsCompression(
  estimatedTokens: number,
  maxTokens: number,
): 'none' | 'soft' | 'hard' {
  const ratio = estimatedTokens / maxTokens;
  if (ratio >= COMPRESSION_HARD_THRESHOLD) return 'hard';
  if (ratio >= COMPRESSION_SOFT_THRESHOLD) return 'soft';
  return 'none';
}

/**
 * Prune conversation history (keep recent N turns, dropping oldest first).
 */
export function pruneConversationHistory(
  history: string[],
  maxTokens: number,
): string[] {
  const kept: string[] = [];
  let used = 0;

  for (let i = history.length - 1; i >= 0; i--) {
    const tokens = estimateTokens(history[i]);
    if (used + tokens > maxTokens) break;
    kept.unshift(history[i]);
    used += tokens;
  }

  return kept;
}

/**
 * Main prune function: takes all context parts and returns trimmed versions.
 */
export function pruneContext(
  systemPrompt: string,
  toolResults: ToolExecutionRecord[],
  conversation: string[],
  budget: Partial<PromptBudget> = {},
): { systemPrompt: string; toolResults: ToolExecutionRecord[]; conversation: string[] } {
  const resolved = { ...createDefaultBudget(), ...budget };

  // 1. Prune system prompt if over budget
  let trimmedPrompt = systemPrompt;
  if (estimateTokens(systemPrompt) > resolved.systemTokens) {
    // Keep first part of the system prompt
    const chars = Math.floor(resolved.systemTokens * 4);
    trimmedPrompt = systemPrompt.slice(0, chars);
  }

  // 2. Prune tool results
  const prunedResults = pruneToolResults(toolResults, resolved.resultTokens);

  // 3. Prune conversation history
  const prunedHistory = pruneConversationHistory(conversation, resolved.historyTokens);

  return {
    systemPrompt: trimmedPrompt,
    toolResults: prunedResults,
    conversation: prunedHistory,
  };
}
