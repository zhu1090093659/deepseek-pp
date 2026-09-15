import { describe, expect, it, vi } from 'vitest';
import { createStreamingToolCallParser } from '../core/interceptor/streaming-tool-call-parser';
import { createArtifactToolDescriptors } from '../core/artifact';
import { isExternalizedToolPayload } from '../core/tool/externalized-payload';
import { ToolProviderRegistry, type RuntimeToolProvider } from '../core/tool/provider-registry';
import { createRuntimeToolRuntime } from '../core/tool/runtime';
import type { ToolDescriptor } from '../core/tool/types';

describe('createStreamingToolCallParser', () => {
  const descriptors = createArtifactToolDescriptors('en');

  it('emits a start event before a large artifact body completes', () => {
    const parser = createStreamingToolCallParser(descriptors);

    const start = parser.append('Intro <artifact_create>');
    expect(start.started).toHaveLength(1);
    expect(start.started[0]).toMatchObject({
      name: 'artifact_create',
      payload: {},
      raw: '<artifact_create>',
    });
    expect(start.completed).toHaveLength(0);

    const body = parser.append('{"filename":"demo.html","content":"');
    expect(body.started).toHaveLength(0);
    expect(body.completed).toHaveLength(0);
  });

  it('parses a completed artifact without carrying the huge raw block', () => {
    const parser = createStreamingToolCallParser(descriptors);
    const largeHtml = '<!doctype html>' + 'x'.repeat(20_000);

    parser.append('<artifact_create>');
    parser.append(JSON.stringify({
      filename: 'demo.html',
      content: largeHtml,
    }).slice(0, 12_000));
    const result = parser.append(`${JSON.stringify({
      filename: 'demo.html',
      content: largeHtml,
    }).slice(12_000)}</artifact_create>`);

    expect(result.completed).toHaveLength(1);
    expect(result.completed[0].payload).toMatchObject({
      filename: 'demo.html',
      content: largeHtml,
    });
    expect(result.completed[0].raw.length).toBeLessThan(2200);
    expect(result.completed[0].raw).toContain('payload');
  });

  it('handles literal less-than text before a tool tag', () => {
    const parser = createStreamingToolCallParser(descriptors);

    const result = parser.append('A < draft <artifact_create>{"filename":"a.txt","content":"ok"}</artifact_create>');

    expect(result.started).toHaveLength(1);
    expect(result.completed).toHaveLength(1);
    expect(result.completed[0].payload).toMatchObject({ filename: 'a.txt', content: 'ok' });
  });

  it('fail-fasts a foreign-closed call into failed and parses the following block', () => {
    const parser = createStreamingToolCallParser(descriptors);
    const start = parser.append('<artifact_create>');
    const result = parser.append('{"filename":"a.txt"}</invoke><artifact_create>{"filename":"b.txt","content":"ok"}</artifact_create>');

    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]).toMatchObject({
      id: start.started[0].id,
      invocationName: 'artifact_create',
      parseError: { code: 'tool_call_close_mismatched', retryable: false },
    });
    expect(result.completed).toHaveLength(1);
    expect(result.completed[0].payload).toMatchObject({ filename: 'b.txt', content: 'ok' });
  });

  it('accepts whitespace-padded tool tags across chunks', () => {
    const parser = createStreamingToolCallParser(descriptors);
    const html = '<!doctype html><canvas id="stage"></canvas>' + '<script>draw()</script>'.repeat(2000);
    const payload = JSON.stringify({
      filename: 'canvas-demo.html',
      content: html,
      language: 'html',
    });

    const start = parser.append('Intro < artifact');
    expect(start.started).toHaveLength(0);

    const open = parser.append('_create >');
    expect(open.started).toHaveLength(1);
    expect(open.started[0]).toMatchObject({
      name: 'artifact_create',
      payload: {},
      raw: '< artifact_create >',
    });

    parser.append(payload.slice(0, 20_000));
    parser.append(payload.slice(20_000));
    expect(parser.append('</ artifact')).toMatchObject({ started: [], completed: [] });

    const completed = parser.append('_create > done');
    expect(completed.completed).toHaveLength(1);
    expect(completed.completed[0].payload).toMatchObject({
      filename: 'canvas-demo.html',
      content: html,
      language: 'html',
    });
    expect(completed.completed[0].raw.length).toBeLessThan(2200);
  });

  it('externalizes very large artifact payloads instead of retaining them in the page parser', () => {
    const parser = createStreamingToolCallParser(descriptors);
    const html = '<!doctype html>' + '<section>chunk</section>'.repeat(6000);
    const payload = JSON.stringify({
      filename: 'huge.html',
      content: html,
      language: 'html',
    });

    parser.append('<artifact_create>');
    const mid = parser.append(payload.slice(0, 40000));
    const end = parser.append(`${payload.slice(40000)}</artifact_create>`);

    expect(mid.streamed.length).toBe(0);
    expect(end.streamed.length).toBeGreaterThan(0);
    expect(end.completed).toHaveLength(1);
    expect(isExternalizedToolPayload(end.completed[0].payload)).toBe(true);
    expect(end.completed[0].raw).toContain('externalized');
  });

  it('emits one same-id non-executable failure when EOF leaves a call unclosed', () => {
    const parser = createStreamingToolCallParser(descriptors);
    const start = parser.append('<artifact_create>{"filename":"unfinished.html"');

    const terminal = parser.flush();

    expect(terminal.completed).toHaveLength(0);
    expect(terminal.failed).toHaveLength(1);
    expect(terminal.failed[0]).toMatchObject({
      id: start.started[0].id,
      name: 'artifact_create',
      payload: {},
      parseError: {
        code: 'tool_call_incomplete',
        retryable: false,
      },
    });
    expect(terminal.failed[0].raw).not.toContain('</artifact_create>');
    expect(parser.flush()).toEqual({ started: [], completed: [], failed: [], streamed: [] });
  });

  it('keeps the externalized payload reference on an incomplete terminal event for cleanup', () => {
    const parser = createStreamingToolCallParser(descriptors);
    const payload = JSON.stringify({
      filename: 'unfinished.html',
      content: 'x'.repeat(70_000),
    });

    parser.append('<artifact_create>');
    const streamed = parser.append(payload);
    const terminal = parser.flush();

    expect(streamed.streamed.length).toBeGreaterThan(0);
    expect(terminal.failed).toHaveLength(1);
    expect(isExternalizedToolPayload(terminal.failed[0].payload)).toBe(true);
    expect(terminal.failed[0].parseError?.code).toBe('tool_call_incomplete');
  });

  it('fails and discards an oversized artifact body before it can grow without bound', () => {
    const parser = createStreamingToolCallParser(descriptors);
    const start = parser.append('<artifact_create>');

    const oversized = parser.append('A'.repeat(1_100_000));

    expect(oversized.completed).toEqual([]);
    expect(oversized.failed).toHaveLength(1);
    expect(oversized.failed[0]).toMatchObject({
      id: start.started[0].id,
      name: 'artifact_create',
      payload: {},
      parseError: {
        code: 'tool_call_payload_too_large',
        retryable: false,
      },
    });
    expect(oversized.failed[0].raw.length).toBeLessThan(2200);

    expect(parser.append('</artifact_create>')).toEqual({
      started: [],
      completed: [],
      failed: [],
      streamed: [],
    });
    const recovered = parser.append('<artifact_create>{"filename":"ok.txt","content":"ok"}</artifact_create>');
    expect(recovered.completed).toHaveLength(1);
    expect(recovered.completed[0].payload).toMatchObject({ filename: 'ok.txt', content: 'ok' });
    expect(parser.flush()).toEqual({ started: [], completed: [], failed: [], streamed: [] });

    const eofParser = createStreamingToolCallParser(descriptors);
    eofParser.append('<artifact_create>');
    eofParser.append('A'.repeat(1_100_000));
    expect(eofParser.flush()).toEqual({ started: [], completed: [], failed: [], streamed: [] });
  });

  it('never sends an incomplete terminal call to a tool provider', async () => {
    const descriptor = descriptors[0];
    const providerExecute = vi.fn();
    const provider: RuntimeToolProvider = {
      registration: { kind: descriptor.provider.kind, id: descriptor.provider.id },
      listTools: async () => [descriptor],
      execute: providerExecute,
    };
    const runtime = createRuntimeToolRuntime(new ToolProviderRegistry([provider]));
    const parser = createStreamingToolCallParser([descriptor]);
    parser.append(`<${descriptor.invocationName}>{"filename":"unfinished.html"`);
    const failure = parser.flush().failed[0];
    vi.stubGlobal('chrome', {
      storage: {
        local: {
          get: vi.fn(async () => ({})),
          set: vi.fn(async () => undefined),
        },
      },
    });

    try {
      await expect(runtime.executeToolCall(failure, {
        kind: 'trusted',
        trigger: 'agent_run',
        requestId: 'request-unclosed',
      }, 'en')).resolves.toMatchObject({
        ok: false,
        error: { code: 'tool_call_incomplete' },
      });
      expect(providerExecute).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  // 方案A：当某个 local skill 处于激活态时，解析出的命令型工具调用必须贴上该 skill 的
  // skillDir，最终在 background runtime 落实 cwd 硬强制（见 local-skill-cwd.ts）。
  describe('local skill cwd enforcement (方案A)', () => {
    const shellExecDescriptor: ToolDescriptor = {
      id: 'shell_exec',
      provider: { kind: 'local', id: 'local-shell', displayName: 'Local Shell', transport: 'in_process' },
      name: 'shell_exec',
      invocationName: 'shell_exec',
      title: 'Shell Exec',
      description: 'Run a shell command inside the active local skill directory',
      inputSchema: { type: 'object', properties: { command: { type: 'string' } } },
      execution: { mode: 'auto', enabled: true, risk: 'medium' },
    };

    it('stamps completed shell_exec calls with the active local skill dir', () => {
      const parser = createStreamingToolCallParser([shellExecDescriptor], { activeLocalSkillDir: '/skills/demo' });
      const result = parser.append('<shell_exec>{"command":"ls"}</shell_exec>');

      expect(result.completed).toHaveLength(1);
      expect(result.completed[0]).toMatchObject({
        invocationName: 'shell_exec',
        localSkillDir: '/skills/demo',
      });
    });

    it('leaves localSkillDir undefined when no local skill is active', () => {
      const parser = createStreamingToolCallParser([shellExecDescriptor]);
      const result = parser.append('<shell_exec>{"command":"ls"}</shell_exec>');

      expect(result.completed).toHaveLength(1);
      expect(result.completed[0].localSkillDir).toBeUndefined();
    });

    it('stamps the local skill dir even when the tool call body is invalid JSON', () => {
      const parser = createStreamingToolCallParser([shellExecDescriptor], { activeLocalSkillDir: '/skills/demo' });
      const result = parser.append('<shell_exec>not-json</shell_exec>');

      expect(result.completed).toHaveLength(1);
      expect(result.completed[0]).toMatchObject({
        invocationName: 'shell_exec',
        localSkillDir: '/skills/demo',
        parseError: { code: 'tool_call_json_invalid' },
      });
    });
  });
});

// 并发/重叠请求隔离回归（评审 #1：禁止全局可变状态导致 cwd 串扰）。
// 两个重叠请求各自携带不同的 activeLocalSkillDir，必须以请求级隔离——
// 先发请求拿到的 cwd 不得被后发请求覆盖，亦不得读到 undefined。
describe('createStreamingToolCallParser 请求级 cwd 隔离（评审 #1）', () => {
  const makeShellDescriptor = (dir: string): ToolDescriptor => ({
    id: 'shell_exec',
    provider: { kind: 'local', id: 'local-shell', displayName: 'Local Shell', transport: 'in_process' },
    name: 'shell_exec',
    invocationName: 'shell_exec',
    title: 'Shell Exec',
    description: 'Run a shell command inside the active local skill directory',
    inputSchema: { type: 'object', properties: { command: { type: 'string' } } },
    execution: { mode: 'auto', enabled: true, risk: 'medium' },
  });

  it('两个重叠请求各自 stamp 各自的 skillDir，互不串扰', () => {
    // 模拟先发请求 A（skillDir=/skills/a）与后发请求 B（skillDir=/skills/b）
    const parserA = createStreamingToolCallParser([makeShellDescriptor('/skills/a')], { activeLocalSkillDir: '/skills/a' });
    const parserB = createStreamingToolCallParser([makeShellDescriptor('/skills/b')], { activeLocalSkillDir: '/skills/b' });

    // 不依赖全局：分别解析各自的 tool call
    const resA = parserA.append('<shell_exec>{"command":"ls"}</shell_exec>');
    const resB = parserB.append('<shell_exec>{"command":"ls"}</shell_exec>');

    expect(resA.completed[0]).toMatchObject({ invocationName: 'shell_exec', localSkillDir: '/skills/a' });
    expect(resB.completed[0]).toMatchObject({ invocationName: 'shell_exec', localSkillDir: '/skills/b' });
    // 关键不变量：A 绝不被 B 覆盖
    expect(resA.completed[0].localSkillDir).not.toBe('/skills/b');
  });

  it('legacy fallback：无激活 Skill 的请求 cwd 为 undefined，且不污染其它请求', () => {
    const parserLegacy = createStreamingToolCallParser([makeShellDescriptor('')], { activeLocalSkillDir: undefined });
    const parserActive = createStreamingToolCallParser([makeShellDescriptor('/skills/a')], { activeLocalSkillDir: '/skills/a' });

    const resLegacy = parserLegacy.append('<shell_exec>{"command":"ls"}</shell_exec>');
    const resActive = parserActive.append('<shell_exec>{"command":"ls"}</shell_exec>');

    expect(resLegacy.completed[0].localSkillDir).toBeUndefined();
    expect(resActive.completed[0].localSkillDir).toBe('/skills/a');
  });
});
