import { Buffer } from 'node:buffer';
import { dirname, resolve } from 'node:path';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  buildContinuationPrompt,
  buildNudgePrompt,
  INLINE_AGENT_CONTINUATION_PLACEHOLDER,
  normalizeInlineAgentFinalAnswerText,
} from '../core/inline-agent/prompt';
import { augmentRequestBody } from '../core/interceptor/request-augmentation';
import { normalizeMcpToolDescriptor, type McpServerConfig, type McpToolDefinition } from '../core/mcp';
import { buildPromptAugmentation } from '../core/prompt';
import {
  createMemoryToolDescriptors,
  createToolInvocationCatalog,
  getToolCloseTag,
  getToolOpenTag,
} from '../core/tool';
import {
  appendExternalizedToolPayloadChunk,
  takeExternalizedToolPayloadText,
} from '../core/tool/externalized-payload';
import { findFirstXmlToolTag, getPartialXmlToolTagTailLength } from '../core/tool/xml-tags';
import type { Memory, ToolDescriptor, ToolExecutionRecord } from '../core/types';

const CONTRACT_DATE = Date.UTC(2026, 6, 13);

const SUCCESS_EXECUTION: ToolExecutionRecord = {
  name: 'capture_page',
  provider: {
    kind: 'mcp',
    id: 'browser-tools',
    displayName: 'Browser Tools',
    transport: 'streamable_http',
  },
  result: {
    ok: true,
    summary: 'Captured the compatibility page',
    detail: 'Title: Compatibility Contract',
    output: {
      title: 'Compatibility Contract',
      url: 'https://example.test/contracts',
    },
  },
};

const FAILED_EXECUTION: ToolExecutionRecord = {
  name: 'shell_exec',
  provider: {
    kind: 'mcp',
    id: 'shell-local',
    displayName: 'Shell Local',
    transport: 'native_messaging',
  },
  result: {
    ok: false,
    summary: 'Command failed',
    detail: 'exit code 2',
    error: {
      code: 'shell_exit_nonzero',
      message: 'Command exited with code 2',
      retryable: true,
    },
  },
};

describe('prompt output compatibility contract', () => {
  it('freezes exact augmented prompt bytes for memory, composed Skills, preset, project, MCP, and Shell', () => {
    const result = augmentRequestBody(JSON.stringify({
      prompt: '/planner reviewer Audit sync compatibility',
      parent_message_id: null,
      thinking_enabled: true,
      ref_file_ids: ['contract.txt'],
    }), {
      memories: [
        memory(11, 'global', undefined, 'Compatibility preference', 'Preserve existing output bytes.', true),
        memory(12, 'project', 'deepseek-pp', 'Project invariant', 'Keep direct XML tool tags stable.'),
        memory(13, 'project', 'other-project', 'Foreign invariant', 'This must not be injected.'),
      ],
      skills: [
        { name: 'planner', instructions: 'Plan from explicit compatibility contracts.', memoryEnabled: false },
        { name: 'reviewer', instructions: 'Review byte-level outputs before changing behavior.', memoryEnabled: true },
      ],
      activePreset: {
        id: 'preset-contract-first',
        name: 'Contract First',
        content: 'Act as the DeepSeek++ compatibility maintainer.',
        createdAt: CONTRACT_DATE,
        updatedAt: CONTRACT_DATE,
      },
      projectContext: '## Project Context\nRepository: deepseek-pp\nInvariant: preserve public behavior.',
      projectId: 'deepseek-pp',
      modelType: 'expert',
      toolDescriptors: createRepresentativeToolDescriptors(),
      messageCount: 0,
      locale: 'en',
    });

    expect(result).not.toBeNull();
    const requestBody = JSON.parse(result!.body) as Record<string, unknown>;
    const prompt = String(requestBody.prompt);
    delete requestBody.prompt;
    expectUtf8Golden('request/en-composed.txt', [
      `prompt:\n${prompt}`,
      `requestBodyWithoutPrompt=${JSON.stringify(requestBody)}`,
      `agentTaskPrompt=${result!.agentTaskPrompt}`,
      `usedMemoryIds=${JSON.stringify(result!.usedMemoryIds)}`,
      `messageCount=${result!.messageCount}`,
    ].join('\n'));
  });

  it('freezes the exact Chinese chat prompt without tools', () => {
    const result = buildPromptAugmentation('请总结兼容性计划。', {
      memories: [],
      thinkingEnabled: false,
      presetContent: null,
      projectContext: '## 项目上下文\n保持现有行为。',
      toolDescriptors: [],
      locale: 'zh-CN',
      forceResponseLanguage: 'zh-CN',
    });

    expectUtf8Golden('prompt/zh-chat-no-tools.txt', [
      result.augmented,
      `usedMemoryIds=${JSON.stringify(result.usedMemoryIds)}`,
      `renderedToolCount=${result.renderedToolCount}`,
    ].join('\n'));
  });
});

describe('tool XML compatibility contract', () => {
  it('freezes rendered names and complete or partial XML tag matches', () => {
    const descriptors = createRepresentativeToolDescriptors();
    const catalog = createToolInvocationCatalog(descriptors);
    const names = new Set(catalog.invocationNames);
    const text = [
      'before',
      '< mcp_browser_tools_capture_page >',
      '{"url":"https://example.test"}',
      '< / mcp_browser_tools_capture_page >',
      'after',
    ].join('\n');

    expectUtf8Golden('tools/catalog-and-tags.json', JSON.stringify({
      invocationNames: catalog.invocationNames,
      tags: catalog.invocationNames.map((name) => [getToolOpenTag(name), getToolCloseTag(name)]),
      opening: findFirstXmlToolTag(text, names, { closing: false }),
      closing: findFirstXmlToolTag(text, names, { closing: true }),
      partialOpeningTail: getPartialXmlToolTagTailLength('prefix < mcp_shell_local_shell', names, { closing: false }),
      partialClosingTail: getPartialXmlToolTagTailLength('prefix < / mcp_shell_local_shell', names, { closing: true }),
      partialOpeningEightSpaces: getPartialXmlToolTagTailLength(`<${' '.repeat(8)}mcp_shell_local_shell`, names, { closing: false }),
      partialOpeningNineSpaces: getPartialXmlToolTagTailLength(`<${' '.repeat(9)}mcp_shell_local_shell`, names, { closing: false }),
      completeOpeningNineSpaces: findFirstXmlToolTag(`<${' '.repeat(9)}shell_exec>`, names, { closing: false }),
    }, null, 2));
  });

  it('freezes one-shot deletion after an externalized payload name mismatch', () => {
    appendExternalizedToolPayloadChunk(
      'contract-mismatched-take',
      'capture_page',
      '{"url":"https://example.test/contracts"}',
    );

    expect(takeExternalizedToolPayloadText('contract-mismatched-take', 'shell_exec')).toBeNull();
    expect(takeExternalizedToolPayloadText('contract-mismatched-take', 'capture_page')).toBeNull();
  });
});

describe('inline-agent output compatibility contract', () => {
  it('freezes exact continuation and nudge prompt bytes', () => {
    const continuation = buildContinuationPrompt(
      'Verify the compatibility contract and report exact evidence.',
      [SUCCESS_EXECUTION, FAILED_EXECUTION],
      'en',
    );
    const nudge = buildNudgePrompt(
      '验证兼容性契约并报告证据。',
      '我会继续调用工具完成验证。',
      [SUCCESS_EXECUTION],
      1,
      'zh-CN',
    );

    expectUtf8Golden('inline/continuation-and-nudge.txt', `continuation:\n${continuation}\n\nnudge:\n${nudge}`);
  });

  it('freezes truncation boundaries without storing oversized golden text', () => {
    const continuation = buildContinuationPrompt('T'.repeat(8_001), [{
      ...SUCCESS_EXECUTION,
      result: {
        ...SUCCESS_EXECUTION.result,
        detail: 'D'.repeat(4_001),
        output: 'O'.repeat(8_001),
      },
    }], 'en');
    const task = continuation.match(/<original_task>\n([\s\S]*?)\n<\/original_task>/)?.[1] ?? '';
    const resultJson = continuation.match(/<tool_results>\n([\s\S]*?)\n<\/tool_results>/)?.[1] ?? '[]';
    const [toolResult] = JSON.parse(resultJson) as Array<{ detail: string; output: string }>;

    expect({
      taskLength: task.length,
      taskSuffix: task.slice(-32),
      detailLength: toolResult.detail.length,
      detailSuffix: toolResult.detail.slice(-32),
      outputLength: toolResult.output.length,
      outputSuffix: toolResult.output.slice(-32),
    }).toEqual({
      taskLength: 8_015,
      taskSuffix: 'TTTTTTTTTTTTTTTTT\n...[truncated]',
      detailLength: 4_015,
      detailSuffix: 'DDDDDDDDDDDDDDDDD\n...[truncated]',
      outputLength: 8_015,
      outputSuffix: 'OOOOOOOOOOOOOOOOO\n...[truncated]',
    });
  });

  it('freezes final-answer completion normalization', () => {
    expect([
      normalizeInlineAgentFinalAnswerText('，<task_complete>{"summary":"兼容性检查完成。","artifacts":["report.md"]}</task_complete>'),
      normalizeInlineAgentFinalAnswerText(', <task_complete>plain summary</task_complete>'),
      normalizeInlineAgentFinalAnswerText('No control block.'),
    ]).toEqual([
      '兼容性检查完成。',
      'plain summary',
      'No control block.',
    ]);
    expect(INLINE_AGENT_CONTINUATION_PLACEHOLDER)
      .toBe('[DeepSeek++ internal inline-agent continuation hidden]');
  });
});

function expectUtf8Golden(relativePath: string, value: string): void {
  const goldenPath = resolve(
    dirname(fileURLToPath(import.meta.url)),
    'fixtures',
    'prompt-output',
    relativePath,
  );
  expect(value).not.toContain('\r');
  expect(value).not.toContain('\uFEFF');
  expect(Buffer.from(value, 'utf8').toString('utf8')).toBe(value);

  if (process.env.DEEPSEEK_PP_UPDATE_PROMPT_GOLDENS === '1') {
    mkdirSync(dirname(goldenPath), { recursive: true });
    writeFileSync(goldenPath, value, 'utf8');
  }

  expect(existsSync(goldenPath), `Missing prompt golden: ${relativePath}`).toBe(true);
  const expectedBytes = readFileSync(goldenPath);
  assertCanonicalGoldenBytes(expectedBytes);
  expect(value).toBe(expectedBytes.toString('utf8'));
  expect(Buffer.from(value, 'utf8').equals(expectedBytes)).toBe(true);
}

function assertCanonicalGoldenBytes(value: Buffer): void {
  expect(value.includes(0x0d)).toBe(false);
  expect(value.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))).toBe(false);
}

function createRepresentativeToolDescriptors(): ToolDescriptor[] {
  const memorySave = createMemoryToolDescriptors('en')[0];
  const browserServer = mcpServer('browser-tools', 'Browser Tools', 'streamable_http');
  const shellServer = mcpServer('shell-local', 'Shell Local', 'native_messaging');

  return [
    memorySave,
    normalizeMcpToolDescriptor(browserServer, {
      name: 'capture_page',
      title: 'Capture page',
      description: 'Capture a browser page for compatibility evidence.',
      inputSchema: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'Page URL' },
          fullPage: { type: 'boolean', description: 'Capture the full page' },
        },
        required: ['url'],
        additionalProperties: false,
      },
      annotations: { risk: 'low' },
    }),
    normalizeMcpToolDescriptor(shellServer, shellToolDefinition()),
  ];
}

function shellToolDefinition(): McpToolDefinition {
  return {
    name: 'shell_exec',
    title: 'Execute command',
    description: 'Execute a local shell command and return stdout, stderr, and the exit code.',
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Shell command' },
        cwd: { type: 'string', description: 'Working directory file path' },
      },
      required: ['command'],
      additionalProperties: false,
    },
    annotations: { risk: 'high' },
  };
}

function mcpServer(
  id: string,
  displayName: string,
  transportKind: 'streamable_http' | 'native_messaging',
): McpServerConfig {
  return {
    version: 1,
    id,
    displayName,
    enabled: true,
    transport: transportKind === 'native_messaging'
      ? { kind: transportKind, nativeHost: 'com.deepseek_pp.shell' }
      : { kind: transportKind, url: 'https://example.test/mcp' },
    headers: [],
    secrets: [],
    timeouts: { connectMs: 5_000, requestMs: 60_000, discoveryMs: 10_000 },
    limits: { maxResultBytes: 128_000, maxToolCount: 16 },
    allowlist: { mode: 'all', toolNames: [] },
    execution: { mode: 'auto', enabled: true },
    status: 'ready',
    lastConnectedAt: CONTRACT_DATE,
    lastError: null,
    createdAt: CONTRACT_DATE,
    updatedAt: CONTRACT_DATE,
  };
}

function memory(
  id: number,
  scope: Memory['scope'],
  projectId: string | undefined,
  name: string,
  content: string,
  pinned = false,
): Memory {
  return {
    id,
    syncId: `memory-${id}`,
    scope,
    projectId,
    type: 'reference',
    name,
    content,
    description: '',
    tags: ['compatibility'],
    pinned,
    createdAt: CONTRACT_DATE,
    updatedAt: CONTRACT_DATE,
    accessCount: id,
    lastAccessedAt: CONTRACT_DATE,
  };
}
