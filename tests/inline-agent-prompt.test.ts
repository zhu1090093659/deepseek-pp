import { describe, expect, it } from 'vitest';
import {
  buildContinuationPrompt,
  buildNudgePrompt,
  buildResumePrompt,
  isInlineAgentContinuationPrompt,
  isInlineAgentContinuationStructure,
  normalizeInlineAgentFinalAnswerText,
  replaceTaskCompleteBlocks,
  INLINE_AGENT_FULL_TOOL_RESULT_WINDOW,
  shouldNudge,
} from '../core/inline-agent/prompt';
import {
  getInlineAgentAnswerText,
  getInlineAgentDisplayFinalText,
  getInlineAgentDisplayStepText,
  getInlineAgentProcessText,
  resolveInlineAgentAnswerText,
  stripInlineAgentTruncationSuffix,
  summarizeInlineAgentToolParams,
} from '../core/inline-agent/display-text';
import { createArtifactToolDescriptors } from '../core/artifact';
import type { ToolDescriptor } from '../core/types';
import { buildAutomationToolContinuationPrompt } from '../core/automation/runner';
import type { ToolExecutionRecord } from '../core/types';

const SUCCESS_EXECUTION: ToolExecutionRecord = {
  name: 'web_search',
  provider: {
    kind: 'local',
    id: 'web',
    displayName: 'DeepSeek++ Web Search',
    transport: 'in_process',
  },
  result: {
    ok: true,
    summary: 'Search completed with 1 results',
    detail: 'One result',
    output: [{ title: 'Result', url: 'https://example.com' }],
  },
};

const FAILED_EXECUTION: ToolExecutionRecord = {
  name: 'mcp_tool',
  provider: {
    kind: 'mcp',
    id: 'server',
    displayName: 'Server',
    transport: 'stdio_bridge',
  },
  result: {
    ok: false,
    summary: 'Failed',
    detail: 'Bad input',
    error: {
      code: 'bad_input',
      message: 'Bad input',
      retryable: true,
    },
  },
};

describe('inline-agent model prompts', () => {
  it('builds English continuation prompts while preserving control tags', () => {
    const prompt = buildContinuationPrompt('Find current docs', [SUCCESS_EXECUTION, FAILED_EXECUTION], 'en');

    expect(prompt).toContain('Continue like a real agent');
    expect(prompt).toContain('At least one tool failed');
    expect(prompt).toContain('<original_task>');
    expect(prompt).toContain('</original_task>');
    expect(prompt).toContain('<tool_results>');
    expect(prompt).toContain('</tool_results>');
    expect(prompt).not.toContain('以下是工具续跑任务');
  });

  it('keeps Chinese continuation prompts available', () => {
    const prompt = buildContinuationPrompt('查文档', [SUCCESS_EXECUTION], 'zh-CN');

    expect(prompt).toContain('以下是工具续跑任务');
    expect(prompt).toContain('<tool_results>');
    expect(prompt).not.toContain('Continue like a real agent');
  });

  it('pins native xychart grammar and rejects invented chart syntax in continuations', () => {
    const expectedGrammar = [
      'title "ARR"',
      'x-axis ["2024-01", "2024-02"]',
      'y-axis "ARR ($B)" 0 --> 50',
      'line [1, 2]',
    ];
    const invalidGrammar = [
      'x-label',
      'y-label',
      'chart-type',
      'data:',
      'series:',
      'xy ...',
    ];

    for (const locale of ['en', 'zh-CN'] as const) {
      const continuation = buildContinuationPrompt(
        locale === 'en' ? 'Build a chart' : '生成图表',
        [SUCCESS_EXECUTION],
        locale,
      );
      const nudge = buildNudgePrompt(
        locale === 'en' ? 'Build a chart' : '生成图表',
        locale === 'en' ? 'I will continue.' : '我会继续。',
        [SUCCESS_EXECUTION],
        1,
        locale,
      );

      for (const syntax of expectedGrammar) {
        expect(continuation).toContain(syntax);
        expect(nudge).toContain(syntax);
      }
      for (const syntax of invalidGrammar) {
        expect(continuation).toContain(syntax);
        expect(nudge).toContain(syntax);
      }
      expect(continuation).toContain('```xychart-beta');
      expect(continuation).not.toContain('<artifact_create>');
      expect(continuation).not.toContain('<artifact_bundle_create>');
    }
  });

  it('localizes nudge prompts without changing task_complete', () => {
    const nudge = buildNudgePrompt('Ship it', 'I will continue.', [SUCCESS_EXECUTION], 1, 'en');

    expect(nudge).toContain('did not include executable tool XML');
    expect(nudge).toContain('<task_complete>{"summary":"..."}</task_complete>');
    expect(nudge).toContain('<tool_results_so_far>');
  });

  it('keeps the completion-signal format without a final-answer split contract', () => {
    // Issue #551 follow-up: the summary-split contract was reverted — models
    // write real deliverables into the reply body, and the display layer
    // renders the full body as the answer. The <task_complete> signal remains
    // the termination marker only.
    const continuation = buildContinuationPrompt('查行情', [SUCCESS_EXECUTION], 'zh-CN');
    expect(continuation).not.toContain('完整最终答案');

    const nudge = buildNudgePrompt('查行情', '我会继续。', [SUCCESS_EXECUTION], 1, 'zh-CN');
    expect(nudge).toContain('<task_complete>{"summary":"..."}</task_complete>');
    expect(nudge).not.toContain('完整最终答案');

    const enContinuation = buildContinuationPrompt('Research docs', [SUCCESS_EXECUTION], 'en');
    expect(enContinuation).not.toContain('complete final answer for the user');
  });

  it('renders the full pre-signal reply body as the user-facing answer', () => {
    // Issue #551 follow-up: deliverables live in the reply body; the answer
    // area shows the complete body, not just the signal summary.
    const text = [
      '我先整理一下刚才获取的信息。',
      '',
      '<task_complete>{"summary":"最终答案：任务已经完成。","artifacts":["demo.html"]}</task_complete>',
    ].join('\n');

    expect(getInlineAgentAnswerText(text)).toBe('我先整理一下刚才获取的信息。');
  });

  it('falls back to the task_complete summary when the reply body is empty', () => {
    const text = '<task_complete>{"summary":"最终答案：任务已经完成。"}</task_complete>';
    expect(getInlineAgentAnswerText(text)).toBe('最终答案：任务已经完成。');
  });

  it('renders the reply body when the task_complete summary is empty', () => {
    const text = [
      '我先整理一下刚才获取的信息。',
      '<task_complete>{"summary":""}</task_complete>',
    ].join('\n');

    expect(getInlineAgentAnswerText(text)).toBe('我先整理一下刚才获取的信息。');
  });

  it('falls back to the full text when no task_complete signal exists', () => {
    expect(getInlineAgentAnswerText('正常回答内容。')).toBe('正常回答内容。');
    expect(getInlineAgentAnswerText('，用户想了解港股的走势。')).toBe('用户想了解港股的走势。');
  });

  it('resolves the longer reply when finalText is a prefix of the last step text', () => {
    // Issue #551 follow-up: traces persisted by older builds stored only a
    // summary/prefix as finalText while the complete reply (e.g. a generated
    // HTML document) survived solely in the last step. The longer same-origin
    // candidate is the answer, and the step body may be cleared.
    const prefix = '搜索结果中，我已经收集了足够的数据。';
    const full = prefix + '```html<html>完整交付物</html>```';
    expect(resolveInlineAgentAnswerText(prefix, full)).toEqual({ answer: full, fromStep: true });
    expect(resolveInlineAgentAnswerText(full, prefix)).toEqual({ answer: full, fromStep: false });
    expect(resolveInlineAgentAnswerText(full, full)).toEqual({ answer: full, fromStep: false });
  });

  it('keeps finalText when the candidates are unrelated (budget notice, summary split)', () => {
    expect(resolveInlineAgentAnswerText('已达到步骤预算，代理已暂停。', '最后一步的工作笔记。'))
      .toEqual({ answer: '已达到步骤预算，代理已暂停。', fromStep: false });
    expect(resolveInlineAgentAnswerText('最终答案。', ''))
      .toEqual({ answer: '最终答案。', fromStep: false });
    expect(resolveInlineAgentAnswerText('', '最后一步的完整回复。'))
      .toEqual({ answer: '最后一步的完整回复。', fromStep: true });
  });

  it('keeps working notes in process text without the control block', () => {
    const text = [
      '我先整理一下刚才获取的信息。',
      '',
      '<task_complete>{"summary":"最终答案"}</task_complete>',
    ].join('\n');

    expect(getInlineAgentProcessText(text)).toBe('我先整理一下刚才获取的信息。');
    expect(getInlineAgentProcessText('普通过程文本。')).toBe('普通过程文本。');
  });

  it('retires the artifact conversion: display text passes markdown through untouched', () => {
    // Issue (drop plugin artifact extension): the display layer no longer
    // converts `<artifact_create>` / `<artifact_bundle_create>` XML into
    // display shapes. The model delivers files as plain markdown fences that
    // the DeepSeek native renderer takes over; any artifact XML that still
    // arrives is stripped by the tool-call stripping layer (tool-parser), so
    // display-text itself never sees or reshapes the protocol.
    const raw = [
      '我已经生成了文件。',
      '',
      '<artifact_create>{"filename":"demo.html","content":"<h1>Hi</h1>"}</artifact_create>',
    ].join('\n');

    // Answer/process extraction strips only the `<task_complete>` control
    // block; artifact XML is NOT converted into any plugin-drawn shape.
    expect(getInlineAgentAnswerText(raw)).toBe(raw);
    expect(getInlineAgentProcessText(raw)).toBe(raw);

    // Plain markdown fences pass through byte-for-byte.
    const fences = '```html\n<h1>Hi</h1>\n```\n\n```xychart-beta\nline [1, 2, 3]\n```';
    expect(getInlineAgentAnswerText(fences)).toBe(fences);
  });

  it('keeps truncation-suffix normalization for same-origin answer resolution', () => {
    // Legacy persisted texts (old salvage conversion, clamp cuts) still carry
    // the marker + a trailing fence; the resolver normalizes both forms.
    expect(stripInlineAgentTruncationSuffix('abc\n...[truncated]')).toBe('abc');
    expect(stripInlineAgentTruncationSuffix('abc\n...[truncated]\n' + '````')).toBe('abc');
    expect(stripInlineAgentTruncationSuffix('abc')).toBe('abc');
    expect(stripInlineAgentTruncationSuffix('')).toBe('');
  });

  it('resolves marker-truncated step prefixes as the same answer', () => {
    // The stream redesign dedup: the last step streamed the final turn clamped
    // at 8000 chars (carrying `...[truncated]`), the finalText is the full
    // turn. The resolver must still recognize the same origin so the partial
    // narration is replaced instead of duplicated.
    expect(resolveInlineAgentAnswerText('完整回答正文。', '完整回答正\n...[truncated]'))
      .toEqual({ answer: '完整回答正文。', fromStep: false });

    // Code-blockified forms (legacy traces): a salvaged truncated block ends
    // with the marker + closing fence; the complete answer has the full
    // content.
    const answer = '```html\n<h1>Hi</h1>\n<p>完整</p>\n```';
    const step = '```html\n<h1>Hi</h1>\n<p>完\n...[truncated]\n```';
    expect(resolveInlineAgentAnswerText(answer, step))
      .toEqual({ answer, fromStep: false });
  });

  it('summarizes tool-call parameters for single-line entries', () => {
    expect(summarizeInlineAgentToolParams({ query: '天气' })).toBe('天气');
    expect(summarizeInlineAgentToolParams({ filename: 'demo.html', content: '<h1>x</h1>' })).toBe('demo.html');
    expect(summarizeInlineAgentToolParams({ url: 'https://example.com' })).toBe('https://example.com');
    expect(summarizeInlineAgentToolParams({})).toBeNull();
    expect(summarizeInlineAgentToolParams(null)).toBeNull();
    expect(summarizeInlineAgentToolParams(['x'])).toBeNull();
    const long = summarizeInlineAgentToolParams({ query: 'q'.repeat(500) });
    expect(long?.length).toBeLessThan(150);
    expect(long?.endsWith('…')).toBe(true);
  });

  it('bounds error payloads in windowed and full tool results', () => {
    const bigError = {
      code: 'shell_exit_nonzero',
      message: 'E'.repeat(2_000),
      retryable: true,
      details: { huge: 'x'.repeat(50_000) },
    };
    const executions = [
      { ...FAILED_EXECUTION, result: { ...FAILED_EXECUTION.result, error: bigError } },
      ...Array.from({ length: 5 }, (_, index) => ({
        ...SUCCESS_EXECUTION,
        result: { ...SUCCESS_EXECUTION.result, summary: `Execution ${index + 2}` },
      })),
    ];

    const prompt = buildContinuationPrompt('Run all six steps.', executions, 'en');
    const resultJson = prompt.match(/<tool_results>\n([\s\S]*?)\n<\/tool_results>/)?.[1] ?? '[]';
    const results = JSON.parse(resultJson) as Array<Record<string, unknown>>;

    const windowed = results[0];
    expect(windowed.windowed).toBe(true);
    expect(windowed.error).toEqual({
      code: 'shell_exit_nonzero',
      message: 'E'.repeat(400) + '\n...[truncated]',
      retryable: true,
    });
    expect((windowed.error as Record<string, unknown>).details).toBeUndefined();

    const full = results[results.length - 1];
    expect(full.windowed).toBeUndefined();
    expect(full.error).toBeUndefined();
    expect((full as Record<string, unknown>).detail).toContain('One result');
  });

  it('counts the first real nudge correction as attempt 1', () => {
    const english = buildNudgePrompt('Ship it', 'I will continue.', [SUCCESS_EXECUTION], 1, 'en');
    const chinese = buildNudgePrompt('发货', '我会继续。', [SUCCESS_EXECUTION], 1, 'zh-CN');

    expect(english).toContain('This is no-tool-call correction attempt 1.');
    expect(chinese).toContain('这是第 1 次无工具调用纠偏。');
  });

  it('builds resume prompts with the original task framing and no nudge semantics', () => {
    const english = buildResumePrompt('Research quarterly data', 1, 'en');
    const chinese = buildResumePrompt('调研季度数据', 2, 'zh-CN');

    expect(english).toContain(
      'Your previous response was interrupted mid-stream. Continue exactly where you left off; do not repeat completed work.',
    );
    expect(english).toContain('This is stream-interruption resume attempt 1.');
    expect(chinese).toContain('你之前的回复在流式输出中途被打断');
    expect(chinese).toContain('这是第 2 次流中断续跑。');
    for (const prompt of [english, chinese]) {
      expect(prompt).toContain('<original_task>');
      expect(prompt).toContain('</original_task>');
      // Nudge semantics do not apply to an interrupted stream.
      expect(prompt).not.toContain('<previous_assistant_text>');
    }
  });

  it('clamps the resume prompt task at 8000 chars', () => {
    const prompt = buildResumePrompt('T'.repeat(8_001), 1, 'en');
    const task = prompt.match(/<original_task>\n([\s\S]*?)\n<\/original_task>/)?.[1] ?? '';

    expect(task.length).toBe(8_015);
    expect(task.endsWith('\n...[truncated]')).toBe(true);
  });

  it('keeps recent tool results full and compresses older executions', () => {
    const executions = Array.from({ length: 6 }, (_, index) => ({
      ...SUCCESS_EXECUTION,
      name: index % 2 === 0 ? 'web_search' : 'mcp_tool',
      provider: index % 2 === 0 ? SUCCESS_EXECUTION.provider : FAILED_EXECUTION.provider,
      result: {
        ...SUCCESS_EXECUTION.result,
        ok: index !== 3,
        summary: `Execution ${index + 1}`,
        detail: `Detail ${index + 1}`,
      },
    }));

    const prompt = buildContinuationPrompt('Run all six steps.', executions, 'en');
    const resultJson = prompt.match(/<tool_results>\n([\s\S]*?)\n<\/tool_results>/)?.[1] ?? '[]';
    const results = JSON.parse(resultJson) as Array<Record<string, unknown>>;

    expect(results).toHaveLength(6);
    const firstTwo = results.slice(0, INLINE_AGENT_FULL_TOOL_RESULT_WINDOW - 2);
    const lastFour = results.slice(-INLINE_AGENT_FULL_TOOL_RESULT_WINDOW);

    for (const entry of firstTwo) {
      expect(entry.windowed).toBe(true);
      expect(entry.detail).toBeUndefined();
      expect(entry.output).toBeUndefined();
      expect(entry.summary).toContain('Execution');
    }
    for (const entry of lastFour) {
      expect(entry.windowed).toBeUndefined();
      expect(entry.detail).toBe('Detail ' + (results.indexOf(entry) + 1));
      expect(entry.error).toBeUndefined();
    }
    expect(results[3].ok).toBe(false);
  });

  it('detects inline-agent continuation prompts as internal requests', () => {
    const continuation = buildContinuationPrompt('查港股行情', [SUCCESS_EXECUTION], 'zh-CN');
    const nudge = buildNudgePrompt('查港股行情', 'I will continue.', [SUCCESS_EXECUTION], 0, 'en');

    expect(isInlineAgentContinuationPrompt(continuation)).toBe(true);
    expect(isInlineAgentContinuationPrompt(nudge)).toBe(true);
    expect(isInlineAgentContinuationPrompt('<original_task>user text</original_task>')).toBe(false);
    expect(isInlineAgentContinuationPrompt('普通用户提问：帮我搜索港股行情')).toBe(false);
  });

  it('detects continuation bubbles structurally even when DeepSeek chrome dilutes the keywords', () => {
    // Live DOM text may interleave DeepSeek's own chrome (timestamps, action
    // rows) with the continuation prompt, so the strict keyword check misses.
    // The paired tags alone are a strong enough signal for DOM-layer hiding.
    const diluted = [
      '刚刚',
      '<original_task>查港股行情</original_task>',
      '<tool_results>[{"tool":"web_search","ok":true}]</tool_results>',
    ].join('\n');
    const dilutedNudge = [
      '<original_task>查港股行情</original_task>',
      '<tool_results_so_far>[{"tool":"web_search","ok":true}]</tool_results_so_far>',
    ].join('\n');

    expect(isInlineAgentContinuationStructure(diluted)).toBe(true);
    expect(isInlineAgentContinuationStructure(dilutedNudge)).toBe(true);
    // Strict detector misses the diluted text (no continuation keywords)...
    expect(isInlineAgentContinuationPrompt(diluted)).toBe(false);
    // ...but still guards the API-layer cleanup for intact prompt text.
    expect(isInlineAgentContinuationPrompt(buildContinuationPrompt('查港股行情', [SUCCESS_EXECUTION], 'zh-CN'))).toBe(true);

    // A real user message carrying only one half of the pair is not hidden.
    expect(isInlineAgentContinuationStructure('<original_task>我的任务</original_task>')).toBe(false);
    expect(isInlineAgentContinuationStructure('<tool_results>结果</tool_results>')).toBe(false);
    expect(isInlineAgentContinuationStructure('帮我把这段代码重构一下')).toBe(false);
  });

  it('detects the auto-resume prompt as an internal request without tool_results tags', () => {
    // The resume prompt carries <original_task> but deliberately no
    // <tool_results> tag: the resume turn must still be treated as an
    // internal turn (fetch suppression, live-DOM hiding, history cleanup).
    const resumeEn = buildResumePrompt('Research quarterly data', 1, 'en');
    const resumeZh = buildResumePrompt('调研季度数据', 2, 'zh-CN');

    expect(isInlineAgentContinuationPrompt(resumeEn)).toBe(true);
    expect(isInlineAgentContinuationPrompt(resumeZh)).toBe(true);
    expect(isInlineAgentContinuationStructure(resumeEn)).toBe(true);
    expect(isInlineAgentContinuationStructure(resumeZh)).toBe(true);

    // Line-level DeepSeek chrome (timestamps, action rows) interleaved with
    // the prompt must not defeat detection in the live DOM.
    const diluted = ['刚刚', ...resumeEn.split('\n')].join('\n');
    expect(isInlineAgentContinuationPrompt(diluted)).toBe(true);
    expect(isInlineAgentContinuationStructure(diluted)).toBe(true);
  });

  it('does not mistake ordinary interrupted-task wording for the resume prompt', () => {
    // The resume wording without the <original_task> pair is never enough.
    expect(isInlineAgentContinuationPrompt(
      'Your previous response was interrupted mid-stream. Continue where you left off.',
    )).toBe(false);
    expect(isInlineAgentContinuationStructure('我之前的回复被打断了，请继续。')).toBe(false);
    // Near-miss wording next to the pair must not match the resume marker.
    expect(isInlineAgentContinuationPrompt('<original_task>查行情</original_task>\n被打断了，请继续。')).toBe(false);
    expect(isInlineAgentContinuationStructure('<original_task>查行情</original_task>\n被打断了，请继续。')).toBe(false);
    // ...while the tool-results rule keeps its own keyword-free structural
    // behavior for the DOM layer.
    expect(isInlineAgentContinuationStructure(
      '<original_task>查行情</original_task>\n<tool_results>[]</tool_results>',
    )).toBe(true);
  });

  it('renders task_complete control blocks as their user-visible summary', () => {
    const text = [
      'before',
      '<task_complete>{"summary":"任务已经完成。","artifacts":["demo.html"]}</task_complete>',
      'after',
    ].join('\n');

    expect(replaceTaskCompleteBlocks(text)).toBe('before\n任务已经完成。\nafter');
  });

  it('removes dangling leading punctuation from stripped tool-prefixed final answers', () => {
    expect(normalizeInlineAgentFinalAnswerText('，用户想了解港股的走势。')).toBe('用户想了解港股的走势。');
    expect(normalizeInlineAgentFinalAnswerText(', final answer is ready.')).toBe('final answer is ready.');
    expect(normalizeInlineAgentFinalAnswerText('。；：结论如下。')).toBe('结论如下。');
  });

  it('nudges only when the visible tail is still asking to continue tool work', () => {
    expect(shouldNudge('查行情', [SUCCESS_EXECUTION], '')).toBe(true);
    expect(shouldNudge('查行情', [SUCCESS_EXECUTION], '我会调用 web_search 获取最新行情。')).toBe(true);
    expect(shouldNudge('查行情', [SUCCESS_EXECUTION], 'I still need to call search next.')).toBe(true);
    expect(shouldNudge('查行情', [SUCCESS_EXECUTION], '我想下载这份报告。')).toBe(true);
    expect(shouldNudge('查行情', [SUCCESS_EXECUTION], '我打算先核对一下刚才的结果。')).toBe(true);
    expect(shouldNudge('查行情', [SUCCESS_EXECUTION], "I'm going to look up the latest price.")).toBe(true);
    expect(shouldNudge('查行情', [SUCCESS_EXECUTION], 'I need to check the file now.')).toBe(true);
    expect(shouldNudge('查行情', [SUCCESS_EXECUTION], "Let's fetch the second page.")).toBe(true);
    expect(shouldNudge('查行情', [SUCCESS_EXECUTION], 'I will summarize the findings now.')).toBe(false);

    // Issue (mid-output silent stop): common "让我…" / "我再…" phrasings
    // promised continued tool work but were missed by the detector, so the
    // loop ended on a sentence that read like a normal final answer. These
    // must nudge exactly like the covered phrasings.
    expect(shouldNudge('查行情', [SUCCESS_EXECUTION], '让我再抓取雪球那篇详尽的24个月梳理文章，获取更完整的月度数据。')).toBe(true);
    expect(shouldNudge('查行情', [SUCCESS_EXECUTION], '让我先搜索一下最新行情。')).toBe(true);
    expect(shouldNudge('查行情', [SUCCESS_EXECUTION], '我再抓取一次页面确认数据。')).toBe(true);
    expect(shouldNudge('查行情', [SUCCESS_EXECUTION], '先让我调用 web_fetch 获取详情。')).toBe(true);
    // Statements of what ALREADY happened do not nudge.
    expect(shouldNudge('查行情', [SUCCESS_EXECUTION], '我已经获得了大量数据。')).toBe(false);
    expect(shouldNudge('查行情', [SUCCESS_EXECUTION], '让我来总结一下结论。')).toBe(false);

    // Issue (artifact deliverable silently swallowed): turns whose visible
    // tail promises a deliverable WITHOUT 我 ("现在为你创建…") were missed by
    // the detector, so a turn that ended on an empty promise completed
    // silently. These must nudge exactly like the 我-prefixed phrasings.
    expect(shouldNudge('查行情', [SUCCESS_EXECUTION], '现在为你创建一份包含折线图和增速分析的可视化报告。')).toBe(true);
    expect(shouldNudge('查行情', [SUCCESS_EXECUTION], '为你创建一个包含汇总分析和交互式折线图的 HTML 页面。')).toBe(true);
    expect(shouldNudge('查行情', [SUCCESS_EXECUTION], '现在为您生成一份包含汇总分析的 HTML 页面。')).toBe(true);
    expect(shouldNudge('查行情', [SUCCESS_EXECUTION], '这就帮你绘制交互式折线图。')).toBe(true);
    // Completed-delivery statements and past-tense claims do not nudge.
    expect(shouldNudge('查行情', [SUCCESS_EXECUTION], '我已经为你创建好了 HTML 页面。')).toBe(false);
    expect(shouldNudge('查行情', [SUCCESS_EXECUTION], '这是我为你创建的报告。')).toBe(false);
    expect(shouldNudge('查行情', [SUCCESS_EXECUTION], '为你创建了文件。')).toBe(false);
    expect(shouldNudge('查行情', [SUCCESS_EXECUTION], '报告如下，已为你生成完毕。')).toBe(false);

    const answerAfterPlanning = [
      '要求查看贵金属走势，之前的搜索已经提供了一些结果。我需要基于这些结果给出一个全面的回答。',
      '为了更全面地获取信息，我将同时打开这些相关的链接。',
      '',
      '根据截至2026年6月下旬的多份市场分析，贵金属市场已经进入高位震荡与分化阶段。',
      '',
      '### 黄金',
      '黄金短期震荡，但长期逻辑仍受央行购金和避险需求支撑。',
      '',
      '### 白银',
      '白银受工业需求驱动，波动弹性高于黄金。',
      '',
      '总的来看，黄金偏震荡，白银和铂金更受产业需求影响。',
    ].join('\n');

    expect(shouldNudge('查行情', [SUCCESS_EXECUTION], answerAfterPlanning)).toBe(false);
    expect(shouldNudge('查行情', [SUCCESS_EXECUTION], '根据搜索结果，恒生指数今日下跌，市场风险偏好偏弱。')).toBe(false);
  });

  it('strips retired artifact protocol from display text while keeping fences and other tools', () => {
    // Issue (artifact deliverable silently swallowed): the display layer must
    // strip residual artifact XML (retired internal protocol) WITHOUT
    // touching user-visible content — plain markdown fences and other tool
    // calls pass through, and the stripped text is what the nudge decision
    // runs on, so nothing is ever silently swallowed.
    const descriptors: ToolDescriptor[] = [...createArtifactToolDescriptors('en')];
    const raw = [
      '我已经整理好数据。',
      '',
      '<artifact_create>{"filename":"report.html","content":"<h1>汇总</h1>"}</artifact_create>',
      '',
      '```html',
      '<h1>最终交付</h1>',
      '```',
    ].join('\n');

    const finalText = getInlineAgentDisplayFinalText(raw, descriptors);
    expect(finalText).toContain('```html');
    expect(finalText).toContain('<h1>最终交付</h1>');
    expect(finalText).not.toContain('artifact_create');
    expect(finalText).not.toContain('"filename"');
    expect(finalText).toContain('我已经整理好数据。');

    const stepText = getInlineAgentDisplayStepText(raw, descriptors);
    expect(stepText).toContain('```html');
    expect(stepText).not.toContain('artifact_create');
  });

  it('keeps plain fences byte-for-byte in display text (native renderer input)', () => {
    const descriptors: ToolDescriptor[] = [];
    const fences = [
      '现在为你创建以下可视化报告：',
      '',
      '```xychart-beta',
      'line [1, 2, 3]',
      '```',
      '',
      '```html',
      '<h1>Hello</h1>',
      '```',
    ].join('\n');

    expect(getInlineAgentDisplayFinalText(fences, descriptors)).toBe(fences.trim());
    expect(getInlineAgentDisplayStepText(fences, descriptors)).toBe(fences.trim());
  });
});

describe('automation model prompts', () => {
  it('localizes automation continuation prompts and preserves tool_results tags', () => {
    const english = buildAutomationToolContinuationPrompt([SUCCESS_EXECUTION], 'en');
    const chinese = buildAutomationToolContinuationPrompt([SUCCESS_EXECUTION], 'zh-CN');

    expect(english).toContain('MCP tool results just executed for the automation');
    expect(english).toContain('<tool_results>');
    expect(english).toContain('</tool_results>');
    expect(chinese).toContain('以下是自动化任务刚刚执行的 MCP 工具结果');
    expect(chinese).toContain('<tool_results>');
  });
});
