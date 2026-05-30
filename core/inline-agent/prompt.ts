import type { ToolExecutionRecord } from '../types';

const PENDING_ACTION_RE = /(?:我(?:将|会|先|直接|现在|继续|尝试|开始|需要)|(?:接下来|下一步|然后).{0,24}(?:调用|创建|编辑|检查|验证|生成|保存|尝试)|(?:i(?:'ll| will| need to)|let me|next,? i).{0,48}(?:call|create|edit|inspect|validate|generate|save|try))/i;
const FINALISH_RE = /(?:已(?:完成|创建|生成|保存|验证|写入|更新)|完成了|保存于|输出文件|最终|final answer|done|completed|created|saved|validated|written)/i;
const TASK_COMPLETE_RE = /<task_complete>\s*([\s\S]*?)\s*<\/task_complete>/;

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

export function buildContinuationPrompt(originalTask: string, executions: ToolExecutionRecord[]): string {
  const hasFailures = executions.some((e) => !e.result.ok);
  const results = renderToolResults(executions);

  return [
    '以下是工具续跑任务刚刚执行的工具结果。请像真正的 Agent 一样，基于原始任务和这些工具结果继续推进。',
    '如果结果已经足够，请输出最终结论；只有确实需要更多信息、验证或文件修改时才继续调用工具。',
    '不要要求用户点击继续，也不要输出伪工具调用 JSON；需要继续操作时只输出可执行 XML 工具标签。',
    '',
    '<original_task>',
    clampText(originalTask, 8000),
    '</original_task>',
    ...(hasFailures ? [
      '至少一个工具执行失败。不要因为可恢复错误就停止；先阅读 summary/detail/error，并修正参数或改用合适的下一步继续完成任务。',
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
): string {
  const results = renderToolResults(executions);

  return [
    '上一轮回复没有包含任何可执行工具 XML，因此自动化续跑无法继续执行。',
    '请根据原始任务和工具结果二选一：',
    '1. 如果任务仍未完成，本轮必须直接输出下一步可执行工具 XML。',
    '2. 如果任务已经完成，输出 <task_complete>{"summary":"..."}</task_complete>。',
    `这是第 ${nudgeCount + 1} 次无工具调用纠偏。`,
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

export function buildFinalizationPrompt(originalTask: string, executions: ToolExecutionRecord[]): string {
  const results = renderToolResults(executions);

  return [
    '以下是刚才已经自动执行完成的工具结果。请基于原始任务和这些结果给出最终回答。',
    '这是最终回答轮次：不要再调用任何工具。',
    '',
    '<original_task>',
    clampText(originalTask, 8000),
    '</original_task>',
    '',
    '<tool_results>',
    JSON.stringify(results, null, 2),
    '</tool_results>',
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
