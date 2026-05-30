#!/usr/bin/env node
/**
 * web_search / web_fetch 全链路模拟测试
 *
 * 模拟从 AI 回复中提取 <web_search> 标签到执行搜索再到结果回传的完整流程。
 *
 * 用法: node scripts/web-search-smoke.mjs
 */

// =========================================================================
// 第一步：模拟工具描述符（和 core/tool/web-search.ts 中的定义一致）
// =========================================================================

const WEB_SEARCH_TOOL_DESCRIPTORS = [
  {
    id: 'local:web:web_search',
    provider: { kind: 'local', id: 'web', displayName: 'DeepSeek++ Web Search', transport: 'in_process' },
    name: 'web_search',
    invocationName: 'web_search',
    title: '搜索互联网',
    description: '搜索互联网，返回与查询相关的网页标题、URL 和摘要',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '搜索查询关键词' },
        topK: { type: 'integer', description: '返回结果数量，默认 5' },
      },
      required: ['query'],
    },
    execution: { mode: 'auto', enabled: true, risk: 'low' },
  },
  {
    id: 'local:web:web_fetch',
    provider: { kind: 'local', id: 'web', displayName: 'DeepSeek++ Web Search', transport: 'in_process' },
    name: 'web_fetch',
    invocationName: 'web_fetch',
    title: '获取网页',
    description: '下载指定 URL 并提取可视文本',
    inputSchema: {
      type: 'object',
      properties: { url: { type: 'string', description: '完整 URL' } },
      required: ['url'],
    },
    execution: { mode: 'auto', enabled: true, risk: 'low' },
  },
];

const MEMORY_TOOL_DESCRIPTORS = [
  {
    id: 'local:memory:memory_save',
    provider: { kind: 'local', id: 'memory', displayName: 'DeepSeek++ Memory', transport: 'in_process' },
    name: 'memory_save', invocationName: 'memory_save', title: '保存记忆', description: '保存长期记忆',
    inputSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
    execution: { mode: 'auto', enabled: true, risk: 'low' },
  },
];

// 所有工具描述符（模拟 DEFAULT_TOOL_DESCRIPTORS）
const ALL_DESCRIPTORS = [...MEMORY_TOOL_DESCRIPTORS, ...WEB_SEARCH_TOOL_DESCRIPTORS];

// =========================================================================
// 第二步：模拟 extractToolCalls（和 core/tool/invocation.ts 中的逻辑一致）
// =========================================================================

function createInvocationCatalog(descriptors) {
  const descriptorByInvocationName = new Map();
  for (const d of descriptors) {
    const name = d.invocationName.trim();
    if (!descriptorByInvocationName.has(name)) {
      descriptorByInvocationName.set(name, d);
    }
  }
  return {
    descriptors,
    invocationNames: [...descriptorByInvocationName.keys()],
    descriptorByInvocationName,
  };
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function createXmlToolCallRegex(catalog) {
  if (catalog.invocationNames.length === 0) return /$a/g;
  const names = catalog.invocationNames.map(escapeRegExp).join('|');
  return new RegExp(`<(${names})>\\s*([\\s\\S]*?)\\s*<\\/\\1>`, 'g');
}

function extractToolCalls(text, descriptors) {
  const catalog = createInvocationCatalog(descriptors);
  const regex = createXmlToolCallRegex(catalog);
  const calls = [];
  let match;
  while ((match = regex.exec(text)) !== null) {
    const invocationName = match[1];
    const body = match[2].trim();
    const descriptor = catalog.descriptorByInvocationName.get(invocationName);
    let payload = {};
    try { payload = body.length === 0 ? {} : JSON.parse(body); } catch {}
    calls.push({
      name: descriptor?.name ?? invocationName,
      invocationName,
      payload,
      raw: match[0],
      descriptorId: descriptor?.id,
      provider: descriptor?.provider,
      createdAt: Date.now(),
    });
  }
  return calls;
}

// =========================================================================
// 第三步：模拟 performWebSearch（和 core/tool/web-search.ts 中的逻辑一致）
// =========================================================================

function createSearchResult(title, url, snippet) {
  return { title, url, snippet };
}

function parseBingResults(html, topK) {
  const results = [];
  const algoRegex = /<li[^>]*class="[^"]*\bb_algo\b[^"]*"[^>]*>([\s\S]*?)<\/li>/gi;
  let match;
  while ((match = algoRegex.exec(html)) !== null && results.length < topK) {
    const block = match[1];
    const titleLink = /<h2[^>]*>[\s\S]*?<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<\/h2>/i.exec(block);
    if (!titleLink) continue;
    let url = titleLink[1];
    const title = titleLink[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    if (url.startsWith('//')) url = 'https:' + url;
    const captionBlock = /<div[^>]*class="[^"]*\bb_caption\b[^"]*"[^>]*>([\s\S]*?)<\/div>/i.exec(block);
    let snippet = '';
    if (captionBlock) {
      const paraText = /<p[^>]*>([\s\S]*?)<\/p>/i.exec(captionBlock[1]);
      snippet = paraText
        ? paraText[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
        : captionBlock[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    }
    if (title && url) results.push(createSearchResult(title, url, snippet));
  }
  return results.slice(0, topK);
}

async function performWebSearch(query, topK) {
  const domains = ['cn.bing.com', 'www.bing.com'];
  let lastError = null;

  for (const domain of domains) {
    try {
      const url = `https://${domain}/search?q=${encodeURIComponent(query)}`;
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept-Language': 'zh-CN,zh;q=0.9',
          Accept: 'text/html,application/xhtml+xml',
        },
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw new Error(`${domain} returned status ${response.status}`);
      const html = await response.text();
      if (html.length < 200) throw new Error(`${domain} returned empty response`);
      const results = parseBingResults(html, topK);
      return { ok: true, summary: `搜索完成，找到 ${results.length} 条结果`, results, domain, status: response.status };
    } catch (e) {
      lastError = e.message;
    }
  }
  return { ok: false, summary: '搜索失败', error: lastError };
}

// =========================================================================
// 第四步：模拟 buildContinuationPrompt（和 core/inline-agent/prompt.ts 中的逻辑一致）
// =========================================================================

function buildContinuationPrompt(originalTask, executions) {
  const results = executions.map((e) => ({
    tool: e.name,
    provider: e.provider?.displayName,
    ok: e.result.ok,
    summary: e.result.summary,
    detail: e.result.detail?.slice(0, 4000),
    output: e.result.output ? JSON.stringify(e.result.output).slice(0, 8000) : undefined,
  }));
  return [
    '以下是工具续跑任务刚刚执行的工具结果。请基于原始任务和这些工具结果继续推进。',
    '',
    '<original_task>',
    originalTask.slice(0, 8000),
    '</original_task>',
    '',
    '<tool_results>',
    JSON.stringify(results, null, 2),
    '</tool_results>',
  ].join('\n');
}

// =========================================================================
// 主测试流程
// =========================================================================

let passed = 0;
let failed = 0;

function check(ok, msg) {
  if (ok) { console.log(`  ✅ ${msg}`); passed++; }
  else { console.log(`  ❌ ${msg}`); failed++; }
}

async function main() {
  console.log('========================================');
  console.log('  web_search 全链路模拟测试');
  console.log('========================================\n');

  // ── 测试 1：从模拟 AI 回复中提取工具调用 ──
  console.log('=== 测试 1: 工具调用提取 ===');

  const mockAiResponse = `当然，我来帮你搜索一下这位 up 主的信息。

<web_search>
{"query": "橘鸦 up主"}
</web_search>

请稍等，搜索完成后我会为你整理结果。`;

  const calls = extractToolCalls(mockAiResponse, ALL_DESCRIPTORS);
  check(calls.length === 1, `从 AI 回复中提取到 ${calls.length} 个工具调用（预期 1）`);
  if (calls.length > 0) {
    const call = calls[0];
    check(call.name === 'web_search', `工具名称: ${call.name}`);
    check(call.payload.query === '橘鸦 up主', `查询参数: ${call.payload.query}`);
    check(call.provider?.id === 'web', `provider.id = ${call.provider?.id}`);
    check(call.provider?.kind === 'local', `provider.kind = ${call.provider?.kind}`);
  }

  // ── 测试 2：同时存在多个工具调用 ──
  console.log('\n=== 测试 2: 混合工具调用 ===');
  const mixedResponse = `我记住了。

<memory_save>
{"name": "用户偏好", "content": "喜欢科技视频"}
</memory_save>

让我搜索一下更多信息。

<web_search>
{"query": "橘鸦 科技 up主"}
</web_search>` ;

  const mixedCalls = extractToolCalls(mixedResponse, ALL_DESCRIPTORS);
  check(mixedCalls.length === 2, `提取到 ${mixedCalls.length} 个工具调用（预期 2）`);
  check(mixedCalls[0].name === 'memory_save', `第一个工具: ${mixedCalls[0].name}`);
  check(mixedCalls[1].name === 'web_search', `第二个工具: ${mixedCalls[1].name}`);
  check(mixedCalls[1].provider?.id === 'web', `web_search provider.id = ${mixedCalls[1].provider?.id}`);

  // ── 测试 3：模拟 stripToolCalls（从文本中移除 XML 标签） ──
  console.log('\n=== 测试 3: 工具调用标签剥离 ===');
  const catalog = createInvocationCatalog(ALL_DESCRIPTORS);
  const regex = createXmlToolCallRegex(catalog);
  const stripped = mockAiResponse.replace(regex, '').replace(/\n{3,}/g, '\n\n').trim();
  const expected = '当然，我来帮你搜索一下这位 up 主的信息。\n\n请稍等，搜索完成后我会为你整理结果。';
  check(stripped === expected, `剥离后文本正确\n  期望: ${expected.slice(0, 40)}...\n  实际: ${stripped.slice(0, 40)}...`);

  // ── 测试 4（联网）：实际执行搜索 ──
  console.log('\n=== 测试 4: 实际执行搜索 ===');
  try {
    const result = await performWebSearch('橘鸦 up主', 5);
    if (result.ok) {
      check(true, `搜索成功: ${result.summary} (${result.domain}, HTTP ${result.status})`);
      result.results.forEach((r, i) => {
        console.log(`     ${i+1}. ${r.title.slice(0, 50)}`);
      });
    } else {
      check(false, `搜索失败: ${result.error}`);
    }
  } catch (e) {
    check(false, `搜索异常: ${e.message}`);
  }

  // ── 测试 5（联网）：验证搜索结果的 ToolResult 格式 ──
  console.log('\n=== 测试 5: ToolResult 格式验证 ===');
  try {
    const result = await performWebSearch('橘鸦 up主', 3);
    if (result.ok) {
      // 模拟返回的 ToolResult（和 executeWebSearchToolCall 中的一致）
      const toolResult = {
        ok: true,
        name: 'web_search',
        summary: result.summary,
        detail: result.results.map((r, i) => `${i + 1}. [${r.title}](${r.url})\n   ${r.snippet}`).join('\n'),
        output: result.results,
      };
      check(toolResult.ok === true, `ok = ${toolResult.ok}`);
      check(toolResult.name === 'web_search', `name = ${toolResult.name}`);
      check(Array.isArray(toolResult.output), `output 是数组: ${Array.isArray(toolResult.output)}`);
      check(toolResult.output.length <= 3, `output 长度 ${toolResult.output.length} ≤ 3`);
      check(typeof toolResult.detail === 'string', `detail 是字符串`);
      check(toolResult.detail.length > 0, `detail 非空`);
    } else {
      check(false, `搜索失败，跳过 ToolResult 验证: ${result.error}`);
    }
  } catch (e) {
    check(false, `ToolResult 验证异常: ${e.message}`);
  }

  // ── 测试 6：模拟 Continuation Prompt 生成 ──
  console.log('\n=== 测试 6: Continuation Prompt 生成 ===');
  const mockExecutions = [{
    name: 'web_search',
    provider: { kind: 'local', id: 'web', displayName: 'DeepSeek++ Web Search' },
    result: {
      ok: true,
      summary: '搜索完成，找到 5 条结果',
      detail: '1. [结果一](https://example.com)\n   摘要内容',
      output: [{ title: '结果一', url: 'https://example.com', snippet: '摘要内容' }],
    },
  }];
  const continuationPrompt = buildContinuationPrompt('帮我搜索橘鸦 up主', mockExecutions);
  check(continuationPrompt.includes('<original_task>'), '包含 original_task');
  check(continuationPrompt.includes('<tool_results>'), '包含 tool_results');
  check(continuationPrompt.includes('橘鸦 up主'), '包含原始查询');
  check(continuationPrompt.includes('结果一'), '包含搜索结果');
  check(continuationPrompt.includes('</tool_results>'), '正确闭合');

  // ── 汇总 ──
  const total = passed + failed;
  console.log(`\n========================================`);
  console.log(`  结果: ${passed}/${total} 通过`);
  if (failed > 0) {
    console.log(`  ${failed} 个失败`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error('\n未捕获错误:', e);
  process.exit(1);
});
