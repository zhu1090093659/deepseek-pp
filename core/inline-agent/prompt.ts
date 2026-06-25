import { DEFAULT_LOCALE, translate, type SupportedLocale } from '../i18n';
import type { ToolExecutionRecord } from '../types';

const PENDING_ACTION_RE = /(?:我(?:将|会|先|直接|现在|继续|尝试|开始|需要|还需要|仍需)|(?:接下来|下一步|然后).{0,24}(?:调用|创建|编辑|检查|验证|生成|保存|尝试)|(?:i(?:'ll| will| (?:still\s+)?need to)|let me|next,? i).{0,48}(?:call|create|edit|inspect|validate|generate|save|try))/i;
const FINALISH_RE = /(?:已(?:完成|创建|生成|保存|验证|写入|更新)|完成了|保存于|输出文件|最终|final answer|done|completed|created|saved|validated|written)/i;
const TASK_COMPLETE_RE = /<task_complete>\s*([\s\S]*?)\s*<\/task_complete>/;
const TASK_COMPLETE_BLOCK_RE = /<task_complete>\s*([\s\S]*?)\s*<\/task_complete>/g;

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

function getTaskCompleteSummary(body: string): string {
  try {
    const parsed = JSON.parse(body);
    return typeof parsed.summary === 'string' ? parsed.summary : body.trim();
  } catch {
    return body.trim();
  }
}

export function shouldNudge(
  originalTask: string,
  executions: ToolExecutionRecord[],
  visibleText: string,
  nudgeCount: number,
): boolean {
  if (extractTaskCompleteSignal(visibleText)) return false;
  if (!visibleText) return true;
  if (PENDING_ACTION_RE.test(visibleText)) return true;
  return nudgeCount === 0 && !FINALISH_RE.test(visibleText);
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
