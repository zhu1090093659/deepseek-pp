import { describe, expect, it } from 'vitest';
import {
  buildContinuationPrompt,
  buildNudgePrompt,
  replaceTaskCompleteBlocks,
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

  it('renders task_complete control blocks as their user-visible summary', () => {
    const text = [
      'before',
      '<task_complete>{"summary":"任务已经完成。","artifacts":["demo.html"]}</task_complete>',
      'after',
    ].join('\n');

    expect(replaceTaskCompleteBlocks(text)).toBe('before\n任务已经完成。\nafter');
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
