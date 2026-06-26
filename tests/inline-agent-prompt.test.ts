import { describe, expect, it } from 'vitest';
import {
  buildContinuationPrompt,
  buildNudgePrompt,
  isInlineAgentContinuationPrompt,
  isInlineAgentContinuationStructure,
  normalizeInlineAgentFinalAnswerText,
  replaceTaskCompleteBlocks,
  shouldNudge,
} from '../core/inline-agent/prompt';
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

  it('localizes nudge prompts without changing task_complete', () => {
    const nudge = buildNudgePrompt('Ship it', 'I will continue.', [SUCCESS_EXECUTION], 1, 'en');

    expect(nudge).toContain('did not include executable tool XML');
    expect(nudge).toContain('<task_complete>{"summary":"..."}</task_complete>');
    expect(nudge).toContain('<tool_results_so_far>');
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
