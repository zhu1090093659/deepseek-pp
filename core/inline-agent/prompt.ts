import { DEFAULT_LOCALE, translate, type SupportedLocale } from '../i18n';
import type { ToolExecutionRecord } from '../types';

const PENDING_ACTION_RE = /(?:我(?:将|会|先|直接|现在|继续|尝试|开始|需要|还需要|仍需).{0,48}(?:调用|创建|编辑|检查|验证|生成|保存|尝试|搜索|获取|打开|执行|查看|访问|读取|抓取)|(?:接下来|下一步|然后).{0,48}(?:调用|创建|编辑|检查|验证|生成|保存|尝试|搜索|获取|打开|执行|查看|访问|读取|抓取)|(?:i(?:'ll| will| (?:still\s+)?need to)|let me|next,? i).{0,64}(?:call|create|edit|inspect|validate|generate|save|try|search|fetch|open|run|browse|read))/gi;
const NUDGE_DECISION_TAIL_MAX_CHARS = 600;
const PENDING_ACTION_AFTER_MAX_CHARS = 80;
const TASK_COMPLETE_RE = /<task_complete>\s*([\s\S]*?)\s*<\/task_complete>/;
const TASK_COMPLETE_BLOCK_RE = /<task_complete>\s*([\s\S]*?)\s*<\/task_complete>/g;

export const INLINE_AGENT_CONTINUATION_PLACEHOLDER = '[DeepSeek++ internal inline-agent continuation hidden]';

export function extractTaskCompleteSignal(text: string): { summary: string; artifacts: string[] } | null {
  const match = TASK_COMPLETE_RE.exec(text);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[1]);
    return {
      summary: typeof parsed.summary === 'string' ? parsed.summary : match[1].trim(),
      artifacts: Array.isArray(parsed.artifacts) ? parsed.artifacts.filter((a: unknown) => typeof a === 'string') : [],
    };
  } catch {
    return { summary: match[1].trim(), artifacts: [] };
  }
}

export function replaceTaskCompleteBlocks(text: string): string {
  return text.replace(TASK_COMPLETE_BLOCK_RE, (_match, body: string) => {
    return getTaskCompleteSummary(body);
  });
}

export function normalizeInlineAgentFinalAnswerText(text: string): string {
  return stripDanglingLeadingPunctuation(replaceTaskCompleteBlocks(text).trim());
}

function hasInlineAgentContinuationTags(content: string): boolean {
  if (!content.includes('<original_task>') || !content.includes('</original_task>')) return false;
  return content.includes('<tool_results>') || content.includes('<tool_results_so_far>');
}

/**
 * True when either prompt field of an internal inline-agent continuation
 * request is present. Shared by the fetch hook (to suppress page events for
 * internal requests) and the content script (to skip starting a fresh agent
 * loop off an already-internal response).
 */
export function isInlineAgentContinuationRequest(originalPrompt: string, agentTaskPrompt: string): boolean {
  return isInlineAgentContinuationPrompt(originalPrompt) ||
    isInlineAgentContinuationPrompt(agentTaskPrompt);
}

export function isInlineAgentContinuationPrompt(content: string): boolean {
  if (!hasInlineAgentContinuationTags(content)) return false;

  return content.includes('工具续跑任务') ||
    content.includes('工具结果') ||
    content.includes('Continue like a real agent') ||
    content.includes('tool results') ||
    content.includes('do not call any tools') ||
    content.includes('不要调用任何工具');
}

/**
 * Looser structural detector for inline-agent continuation text as rendered in
 * the live DOM. DeepSeek may interleave its own chrome (timestamps, action
 * rows, reasoning fragments) with the continuation prompt, so the strict
 * {@link isInlineAgentContinuationPrompt} keyword check can miss it and leave
 * an empty user bubble. The paired `<original_task>` + `<tool_results[_so_far]>`
 * tags are a strong enough structural signal on their own — a real user
 * message would not contain both — so we drop the keyword requirement here.
 *
 * The strict version is still used for history-list API cleanup, where the
 * raw prompt text is intact and false positives are costlier.
 */
export function isInlineAgentContinuationStructure(content: string): boolean {
  return hasInlineAgentContinuationTags(content);
}

function getTaskCompleteSummary(body: string): string {
  try {
    const parsed = JSON.parse(body);
    return typeof parsed.summary === 'string' ? parsed.summary : body.trim();
  } catch {
    return body.trim();
  }
}

function stripDanglingLeadingPunctuation(text: string): string {
  return text.replace(/^[\s\u3000]*(?:[，,、。．.;；:：]\s*)+/, '').trimStart();
}

export function shouldNudge(
  originalTask: string,
  executions: ToolExecutionRecord[],
  visibleText: string,
): boolean {
  if (extractTaskCompleteSignal(visibleText)) return false;
  if (!visibleText) return true;
  return hasPendingActionAtTail(getNudgeDecisionText(visibleText));
}

function getNudgeDecisionText(text: string): string {
  const trimmed = text.trim();
  return trimmed.length > NUDGE_DECISION_TAIL_MAX_CHARS
    ? trimmed.slice(-NUDGE_DECISION_TAIL_MAX_CHARS)
    : trimmed;
}

function hasPendingActionAtTail(text: string): boolean {
  const matches = [...text.matchAll(PENDING_ACTION_RE)];
  const lastMatch = matches[matches.length - 1];
  if (!lastMatch || lastMatch.index === undefined) return false;

  const afterPendingAction = text.slice(lastMatch.index + lastMatch[0].length).trim();
  return afterPendingAction.length <= PENDING_ACTION_AFTER_MAX_CHARS;
}

export function buildContinuationPrompt(
  originalTask: string,
  executions: ToolExecutionRecord[],
  locale: SupportedLocale = DEFAULT_LOCALE,
): string {
  const hasFailures = executions.some((e) => !e.result.ok);
  const results = renderToolResults(executions);

  return [
    translate(locale, 'prompt.inlineAgent.continuationIntro'),
    translate(locale, 'prompt.inlineAgent.continuationEnough'),
    translate(locale, 'prompt.inlineAgent.continuationNoPseudo'),
    '',
    '<original_task>',
    clampText(originalTask, 8000),
    '</original_task>',
    ...(hasFailures ? [
      translate(locale, 'prompt.inlineAgent.failureRecovery'),
    ] : []),
    '',
    '<tool_results>',
    JSON.stringify(results, null, 2),
    '</tool_results>',
  ].join('\n');
}

export function buildNudgePrompt(
  originalTask: string,
  previousText: string,
  executions: ToolExecutionRecord[],
  nudgeCount: number,
  locale: SupportedLocale = DEFAULT_LOCALE,
): string {
  const results = renderToolResults(executions);

  return [
    translate(locale, 'prompt.inlineAgent.nudgeNoTools'),
    translate(locale, 'prompt.inlineAgent.nudgeChoice'),
    translate(locale, 'prompt.inlineAgent.nudgeNextTool'),
    translate(locale, 'prompt.inlineAgent.nudgeComplete'),
    translate(locale, 'prompt.inlineAgent.nudgeCount', { count: nudgeCount + 1 }),
    '',
    '<original_task>',
    clampText(originalTask, 8000),
    '</original_task>',
    '',
    '<previous_assistant_text>',
    clampText(previousText, 4000),
    '</previous_assistant_text>',
    '',
    '<tool_results_so_far>',
    JSON.stringify(results, null, 2),
    '</tool_results_so_far>',
  ].join('\n');
}

function renderToolResults(executions: ToolExecutionRecord[]) {
  return executions.map((e) => ({
    tool: e.name,
    provider: e.provider?.displayName,
    ok: e.result.ok,
    summary: e.result.summary,
    detail: clampText(e.result.detail, 4000),
    error: e.result.error,
    output: clampText(
      e.result.output === undefined ? undefined : JSON.stringify(e.result.output),
      8000,
    ),
    truncated: e.result.truncated === true,
  }));
}

function clampText(value: string | undefined, maxLength: number): string | undefined {
  if (!value) return value;
  return value.length > maxLength ? `${value.slice(0, maxLength)}\n...[truncated]` : value;
}
