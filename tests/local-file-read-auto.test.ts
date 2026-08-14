// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// @ts-expect-error 宿主 file-provider.mjs 为纯 JS 实现，无类型声明文件
import { readTextFileWindow } from '../packages/shell-host/native/file-provider.mjs';
import { callLocalFileReadAuto, callMcpTool } from '../core/mcp/client';
import type { McpServerConfig, McpProtocolTransport, McpCallToolResult } from '../core/mcp/types';

function makeTempFile(content: string | Uint8Array): string {
  const dir = mkdtempSync(join(tmpdir(), 'lfr-'));
  const p = join(dir, 'sample.txt');
  writeFileSync(p, content as never, typeof content === 'string' ? 'utf8' : undefined);
  return p;
}

// Shell Native Host 身份（displayName 命中 SHELL_MCP_SERVER_NAME），auto 续读仅对其生效。
function makeServer(overrides: Partial<McpServerConfig> = {}): McpServerConfig {
  return {
    id: 's', displayName: 'Shell Local', enabled: true,
    transport: { kind: 'native_messaging', nativeHost: 'com.deepseek_pp.shell' },
    timeouts: { connectMs: 0, requestMs: 30000, discoveryMs: 0 },
    limits: { maxResultBytes: 64000, maxToolCount: 100 },
    version: 1, status: 'ready', lastConnectedAt: null, lastError: null,
    createdAt: 0, updatedAt: 0, headers: [], secrets: [],
    allowlist: { mode: 'all', toolNames: [] },
    execution: { mode: 'local', enabled: true },
    ...overrides,
  } as unknown as McpServerConfig;
}

// 第三方 MCP server：暴露同名 local_file_read，但不是 Shell Native Host。
function makeThirdPartyServer(): McpServerConfig {
  return makeServer({
    id: 'third-party',
    displayName: 'Some Other MCP',
    transport: { kind: 'stdio_bridge' },
  } as Partial<McpServerConfig>);
}

function makeTransport(windows: McpCallToolResult[]): McpProtocolTransport {
  let i = 0;
  const request = async () => {
    const result = windows[i] ?? windows[windows.length - 1];
    i++;
    return { jsonrpc: '2.0', id: 1, result } as unknown as Awaited<ReturnType<McpProtocolTransport['request']>>;
  };
  return { request } as unknown as McpProtocolTransport;
}

function windowResult(
  content: string,
  nextStart: number,
  totalChars: number,
  truncated: boolean,
  sha256?: string,
  sizeBytes?: number,
): McpCallToolResult {
  return {
    content: [{ type: 'text', text: `Read ${content.length} characters` }],
    structuredContent: { data: { path: '/x', content, start: 0, nextStart, maxChars: content.length, totalChars, truncated, ...(sha256 !== undefined ? { sha256 } : {}), ...(sizeBytes !== undefined ? { sizeBytes } : {}) } },
  };
}

// 按调用方实际申请的 max_chars 供给内容的宿主模拟，用于校验总量预算语义。
function makeBudgetAwareTransport(totalCharsInFile: number): {
  transport: McpProtocolTransport;
  requestedMaxChars: number[];
} {
  const requestedMaxChars: number[] = [];
  let served = 0;
  const request = async (payload: unknown) => {
    const args = (payload as { params?: { arguments?: Record<string, unknown> } })?.params?.arguments ?? {};
    const want = Number(args.max_chars ?? 0);
    requestedMaxChars.push(want);
    const give = Math.min(want, totalCharsInFile - served);
    const content = 'x'.repeat(Math.max(0, give));
    served += content.length;
    return {
      jsonrpc: '2.0',
      id: 1,
      result: windowResult(content, served, totalCharsInFile, served < totalCharsInFile),
    } as unknown as Awaited<ReturnType<McpProtocolTransport['request']>>;
  };
  return { transport: { request } as unknown as McpProtocolTransport, requestedMaxChars };
}

function autoReadData(result: { output?: unknown }): {
  content: string;
  windows: number;
  totalChars: number;
  charsReturned: number;
  truncated: boolean;
} {
  return (result.output as { data: never }).data;
}

describe('readTextFileWindow (宿主防 OOM)', () => {
  it('中文混排无乱码且窗口连续拼接等于原文', () => {
    const mixed = 'Hello 世界 🌍 中文测试 abc 混合内容 12345 emoji😀 结尾';
    const totalChars = Array.from(mixed).length;
    const path = makeTempFile(mixed);
    const window = 5;
    let acc = '';
    let start = 0;
    let guard = 0;
    while (guard < 1000) {
      guard++;
      const { content, totalChars: tc, charsRead } = readTextFileWindow(path, start, window);
      expect(tc).toBe(totalChars);
      // 回归保护：charsRead 必须与返回内容的 Unicode 码点数一致（emoji 代理对场景下 UTF-16 length 会偏高）
      expect(charsRead).toBe(Array.from(content).length);
      acc += content;
      // 按 Unicode 码点单位推进（与宿主 nextStart = start + charsRead 同单位）
      start += charsRead;
      if (charsRead < window) break;
    }
    expect(acc).toBe(mixed);
  });

  it('首窗从 0 读取返回正确字符数', () => {
    const s = 'abcdefghij';
    const path = makeTempFile(s);
    const { content, totalChars } = readTextFileWindow(path, 0, 3);
    expect(content).toBe('abc');
    expect(totalChars).toBe(10);
  });

  it('start 超出文件字符数返回空且 totalChars 正确', () => {
    const s = 'abc';
    const path = makeTempFile(s);
    const { content, totalChars } = readTextFileWindow(path, 100, 10);
    expect(content).toBe('');
    expect(totalChars).toBe(3);
  });

  it('中等大文件（约 5MB）按需读取不整文件入内存，窗口正确', () => {
    const unit = '中a🌍'; // 4 字符 ≈ 9 字节
    const repeat = 580_000; // ≈ 5MB
    const big = unit.repeat(repeat);
    const path = makeTempFile(big);
    const totalChars = Array.from(big).length;
    const mid = Math.floor(totalChars / 2);
    const { content, totalChars: tc } = readTextFileWindow(path, mid, 100);
    expect(tc).toBe(totalChars);
    expect(content).toBe(Array.from(big).slice(mid, mid + 100).join(''));
  });

  // T1：LRC#3 精确边界回归。多字节字符的首字节恰好落在 64KiB 物理读取块的最后一个字节，
  // 修复前 scanUtf8Chars 会把孤立首字节计入 consumed，解码产出 U+FFFD。
  it('T1 多字节字符首字节位于 64KiB 边界末尾时不产生 U+FFFD', () => {
    const text = `${'a'.repeat(65535)}🌍b`;
    const path = makeTempFile(text);
    const { content, charsRead } = readTextFileWindow(path, 0, 65536);
    expect(content).not.toContain('\uFFFD');
    expect(charsRead).toBe(65536);
    const codePoints = Array.from(content);
    expect(codePoints.length).toBe(65536);
    expect(codePoints[65535]).toBe('🌍');
    expect(content).toBe(`${'a'.repeat(65535)}🌍`);
  });

  // T2：LRC#3 同源第二处。起始偏移定位循环此前用 bytePos += got 而非 consumed，
  // 会让字节指针停在字符中间，导致后续窗口整体错位。
  it('T2 start 落在 64KiB 边界之后时窗口拼接仍等于原文', () => {
    const text = `${'a'.repeat(65535)}🌍中文尾部bcdef`;
    const path = makeTempFile(text);
    const all = Array.from(text);
    const tail = readTextFileWindow(path, 65535, 10);
    expect(tail.content).not.toContain('\uFFFD');
    expect(tail.content).toBe(all.slice(65535, 65545).join(''));

    // 逐窗续读全文，拼接必须与原文逐字节相同
    let acc = '';
    let start = 0;
    for (let guard = 0; guard < 200; guard++) {
      const { content, charsRead } = readTextFileWindow(path, start, 4096);
      acc += content;
      start += charsRead;
      if (charsRead < 4096) break;
    }
    expect(acc).toBe(text);
    expect(acc).not.toContain('\uFFFD');
  });

  // T7：文件尾部是损坏的不完整 UTF-8 序列（孤立首字节）。atEof 分支必须原样保留、
  // 不因回退而丢字符或陷入死循环。
  it('T7 文件尾部为不完整 UTF-8 序列时不死循环且能终止', () => {
    const broken = Buffer.concat([Buffer.from('abc中文', 'utf8'), Buffer.from([0xf0, 0x9f])]);
    const path = makeTempFile(broken);
    let start = 0;
    let guard = 0;
    let lastCharsRead = -1;
    while (guard < 50) {
      guard++;
      const { content, charsRead } = readTextFileWindow(path, start, 3);
      lastCharsRead = charsRead;
      expect(charsRead).toBe(Array.from(content).length);
      start += charsRead;
      if (charsRead < 3) break;
    }
    expect(guard).toBeLessThan(50); // 未死循环
    expect(lastCharsRead).toBeGreaterThanOrEqual(0);
  });

  // T8：Buffer.alloc 为零填充，若把整个 buf 而非 subarray(0, got) 交给扫描器，
  // 尾部 0x00 会被误计为字符。窗口大小远超文件长度时应只返回真实字符。
  it('T8 窗口大于文件长度时不返回零填充字符', () => {
    const s = '短文本abc';
    const path = makeTempFile(s);
    const { content, charsRead, totalChars } = readTextFileWindow(path, 0, 100_000);
    expect(content).toBe(s);
    expect(content).not.toContain('\u0000');
    expect(charsRead).toBe(Array.from(s).length);
    expect(totalChars).toBe(Array.from(s).length);
  });
});

describe('callMcpTool 提供方身份闸门 (LRC#1)', () => {
  const call = { name: 'local_file_read', payload: { path: '/x' } } as never;

  // T3：第三方 MCP server 暴露同名 local_file_read 时不得被劫持进 Shell 专用续读路径。
  it('T3 非 Shell server 的同名工具走通用路径，不进入 auto 续读', async () => {
    let calls = 0;
    const transport = {
      request: async () => {
        calls++;
        return {
          jsonrpc: '2.0',
          id: 1,
          result: { content: [{ type: 'text', text: 'third-party payload' }] },
        } as unknown as Awaited<ReturnType<McpProtocolTransport['request']>>;
      },
    } as unknown as McpProtocolTransport;

    const result = await callMcpTool(makeThirdPartyServer(), transport, { call } as never);
    expect(result.ok).toBe(true);
    expect(calls).toBe(1); // 仅一次调用，未进入多窗循环
    expect(result.summary).not.toContain('auto 续读');
  });

  // T4：Shell Native Host 的 local_file_read 仍进入续读路径，行为不回退。
  it('T4 Shell server 的 local_file_read 仍进入 auto 续读', async () => {
    const transport = makeTransport([
      windowResult('AAAA', 4, 8, true),
      windowResult('BBBB', 8, 8, false),
    ]);
    const result = await callMcpTool(makeServer(), transport, { call } as never);
    expect(result.ok).toBe(true);
    expect(result.summary).toBe('local_file_read auto 续读完成');
    const t4Data = autoReadData(result);
    expect(t4Data.content).toBe('AAAABBBB');
    // 契约形状硬断言：data.content 必须为单字符串而非逐窗数组，防止误回退为 contents[]。
    expect(typeof t4Data.content).toBe('string');
    expect(Array.isArray(t4Data.content)).toBe(false);
  });
});

describe('callLocalFileReadAuto (扩展侧 auto 续读)', () => {
  const server = makeServer();
  const call = { name: 'local_file_read', payload: { path: '/x' } } as never;

  it('循环读取直到 truncated=false，聚合内容与窗口数正确', async () => {
    const transport = makeTransport([
      windowResult('AAAA', 4, 12, true),
      windowResult('BBBB', 8, 12, true),
      windowResult('CCCC', 12, 12, false),
    ]);
    const result = await callLocalFileReadAuto(server, transport, { call } as never);
    expect(result.ok).toBe(true);
    const data = autoReadData(result);
    expect(data.content).toBe('AAAABBBBCCCC');
    expect(data.windows).toBe(3);
    expect(data.totalChars).toBe(12);
    expect(data.charsReturned).toBe(12);
    expect(data.truncated).toBe(false);
  });

  it('nextStart 不前进时 fail-closed', async () => {
    const transport = makeTransport([
      windowResult('AAAA', 4, 12, true),
      windowResult('BBBB', 4, 12, true),
    ]);
    const result = await callLocalFileReadAuto(server, transport, { call } as never);
    expect(result.ok).toBe(false);
    expect(autoReadData(result).windows).toBe(2);
  });

  it('窗口内容非字符串时 fail-closed', async () => {
    const transport = makeTransport([
      { structuredContent: { data: { truncated: true, nextStart: 4 } } } as McpCallToolResult,
    ]);
    const result = await callLocalFileReadAuto(server, transport, { call } as never);
    expect(result.ok).toBe(false);
  });

  it('单窗调用失败时 fail-closed', async () => {
    const transport = {
      request: async () => {
        throw new Error('boom');
      },
    } as unknown as McpProtocolTransport;
    const result = await callLocalFileReadAuto(server, transport, { call } as never);
    expect(result.ok).toBe(false);
  });

  // T5：max_chars 为「本次最多返回字符数」总量语义，而非每窗上限。
  it('T5 max_chars 是总量上限，多窗合计不得超出', async () => {
    const { transport, requestedMaxChars } = makeBudgetAwareTransport(50_000);
    const budgetedCall = { name: 'local_file_read', payload: { path: '/x', max_chars: 5000 } } as never;
    const result = await callLocalFileReadAuto(server, transport, { call: budgetedCall } as never);
    expect(result.ok).toBe(true);
    const data = autoReadData(result);
    expect(data.charsReturned).toBe(5000);
    expect(Array.from(data.content).length).toBeLessThanOrEqual(5000);
    expect(data.truncated).toBe(true); // 文件更长，如实标记未读完
    // 单窗申请值不得超过总预算，也不得被放大到 12000
    expect(Math.max(...requestedMaxChars)).toBeLessThanOrEqual(5000);
  });

  it('T5b 未传 max_chars 时按契约缺省 16000 总量', async () => {
    const { transport } = makeBudgetAwareTransport(50_000);
    const result = await callLocalFileReadAuto(server, transport, { call } as never);
    expect(result.ok).toBe(true);
    const data = autoReadData(result);
    expect(data.charsReturned).toBe(16000);
    expect(data.truncated).toBe(true);
  });

  it('T5c max_chars 超过契约硬上限时收敛到 100000', async () => {
    const { transport } = makeBudgetAwareTransport(500_000);
    const hugeCall = { name: 'local_file_read', payload: { path: '/x', max_chars: 999_999 } } as never;
    const result = await callLocalFileReadAuto(server, transport, { call: hugeCall } as never);
    expect(result.ok).toBe(true);
    expect(autoReadData(result).charsReturned).toBe(100_000);
  });

  // T6：聚合结果仍须经统一 normalization 施加 maxResultBytes 字节上限。
  it('T6 聚合后 detail 受 maxResultBytes 约束并标记 truncated', async () => {
    const tinyLimitServer = makeServer({ limits: { maxResultBytes: 500, maxToolCount: 100 } } as Partial<McpServerConfig>);
    const { transport } = makeBudgetAwareTransport(50_000);
    const result = await callLocalFileReadAuto(tinyLimitServer, transport, { call } as never);
    expect(new TextEncoder().encode(result.detail).byteLength).toBeLessThanOrEqual(500);
    expect(result.truncated).toBe(true);
  });

  it('窗口数达上限时 fail-closed（不静默谎报成功）', async () => {
    // 模拟宿主每窗仅回 1 字符但持续 truncated=true：预算充足而窗口数先耗尽，
    // 验证 M1 修复——此时必须 ok:false 且 truncated:true，而非谎报成功（fail-open）。
    let i = 0;
    const transport = {
      request: async () => {
        i++;
        return {
          jsonrpc: '2.0',
          id: 1,
          result: windowResult('A', i, 12_000_000, true),
        } as unknown as Awaited<ReturnType<McpProtocolTransport['request']>>;
      },
    } as unknown as McpProtocolTransport;
    const bigBudgetCall = { name: 'local_file_read', payload: { path: '/x', max_chars: 100_000 } } as never;
    const result = await callLocalFileReadAuto(server, transport, { call: bigBudgetCall } as never);
    expect(result.ok).toBe(false);
    const data = autoReadData(result);
    expect(data.truncated).toBe(true);
    expect(data.windows).toBe(1000);
  });

  // ===== snapshot 一致性 + 元数据透传（本次修复）=====

  it('单窗透传 sha256 与 sizeBytes', async () => {
    const transport = makeTransport([
      windowResult('AAAA', 4, 4, false, 'abc123', 4),
    ]);
    const result = await callLocalFileReadAuto(server, transport, { call } as never);
    expect(result.ok).toBe(true);
    const data = autoReadData(result) as { sha256?: unknown; sizeBytes?: unknown };
    expect(data.sha256).toBe('abc123');
    expect(data.sizeBytes).toBe(4);
  });

  it('多窗 SHA 相同且保留 sha256', async () => {
    const transport = makeTransport([
      windowResult('AAAA', 4, 8, true, 'same', 8),
      windowResult('BBBB', 8, 8, false, 'same', 8),
    ]);
    const result = await callLocalFileReadAuto(server, transport, { call } as never);
    expect(result.ok).toBe(true);
    const data = autoReadData(result) as { content?: unknown; sha256?: unknown; sizeBytes?: unknown };
    expect(data.content).toBe('AAAABBBB');
    expect(data.sha256).toBe('same');
    expect(data.sizeBytes).toBe(8);
  });

  it('两窗 SHA 不同必须失败，不得返回混合文件', async () => {
    const transport = makeTransport([
      windowResult('AAAA', 4, 8, true, 'sha-A', 8),
      windowResult('BBBB', 8, 8, false, 'sha-B', 8),
    ]);
    const result = await callLocalFileReadAuto(server, transport, { call } as never);
    expect(result.ok).toBe(false);
    const data = autoReadData(result) as { content?: unknown; windows?: number };
    expect(data.content).not.toBe('AAAABBBB');
    expect(data.windows).toBe(1);
  });

  it('第一窗有 SHA、后续窗 SHA 缺失必须失败', async () => {
    const transport = makeTransport([
      windowResult('AAAA', 4, 8, true, 'sha-A', 8),
      windowResult('BBBB', 8, 8, false, undefined, 8),
    ]);
    const result = await callLocalFileReadAuto(server, transport, { call } as never);
    expect(result.ok).toBe(false);
    const data = autoReadData(result) as { content?: unknown; windows?: number };
    expect(data.content).not.toBe('AAAABBBB');
    expect(data.windows).toBe(1);
  });

  it('legacy 宿主无 SHA 时仍能读取，但不伪造 SHA', async () => {
    const transport = makeTransport([
      windowResult('AAAA', 4, 4, false),
    ]);
    const result = await callLocalFileReadAuto(server, transport, { call } as never);
    expect(result.ok).toBe(true);
    const data = autoReadData(result) as { content?: unknown; sha256?: unknown };
    expect(data.content).toBe('AAAA');
    expect(data.sha256).toBeFalsy();
  });
});
