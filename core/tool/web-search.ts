import type {
  JsonValue,
  ToolCall,
  ToolDescriptor,
  ToolProviderIdentity,
  ToolResult,
} from './types';

export const WEB_SEARCH_TOOL_PROVIDER: ToolProviderIdentity = {
  kind: 'local',
  id: 'web',
  displayName: 'DeepSeek++ Web Search',
  transport: 'in_process',
};

export const WEB_SEARCH_TOOL_NAMES = ['web_search', 'web_fetch'] as const;

export type WebSearchToolName = typeof WEB_SEARCH_TOOL_NAMES[number];

export const WEB_SEARCH_TOOL_DESCRIPTORS: ToolDescriptor[] = [
  {
    id: 'local:web:web_search',
    provider: WEB_SEARCH_TOOL_PROVIDER,
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
      additionalProperties: false,
    },
    execution: {
      mode: 'auto',
      enabled: true,
      risk: 'low',
    },
  },
  {
    id: 'local:web:web_fetch',
    provider: WEB_SEARCH_TOOL_PROVIDER,
    name: 'web_fetch',
    invocationName: 'web_fetch',
    title: '获取网页',
    description: '下载指定 URL 的页面内容，返回可视文本（自动去除导航、脚本和样式）',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: '要抓取的完整 URL（http:// 或 https://）' },
      },
      required: ['url'],
      additionalProperties: false,
    },
    execution: {
      mode: 'auto',
      enabled: true,
      risk: 'low',
    },
  },
];

export function isWebSearchToolName(name: string): name is WebSearchToolName {
  return (WEB_SEARCH_TOOL_NAMES as readonly string[]).includes(name);
}

export async function executeWebSearchToolCall(call: ToolCall): Promise<ToolResult> {
  switch (call.name) {
    case 'web_search':
      return performWebSearch(call);
    case 'web_fetch':
      return performWebFetch(call);
    default:
      return {
        ok: false,
        name: call.name,
        summary: '不支持的搜索工具',
        error: {
          code: 'web_tool_unsupported',
          message: `Unsupported web tool: ${call.name}`,
          retryable: false,
        },
      };
  }
}

// ---------------------------------------------------------------------------
// Web Search via Bing (不需要 API Key，国内可访问)
// ---------------------------------------------------------------------------

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

async function performWebSearch(call: ToolCall): Promise<ToolResult> {
  const query = typeof call.payload.query === 'string' ? call.payload.query.trim() : '';
  if (!query) {
    return {
      ok: false,
      name: call.name,
      summary: '搜索查询不能为空',
      error: { code: 'empty_query', message: 'query is required', retryable: false },
    };
  }

  const topK = typeof call.payload.topK === 'number'
    ? Math.min(Math.max(1, Math.floor(call.payload.topK)), 10)
    : 5;

  // Try multiple Bing domains as fallback.
  // Each domain times out in 8s; total stays under 20s.
  const domains = ['cn.bing.com', 'www.bing.com'];
  let lastError: string | null = null;
  const startTime = Date.now();

  for (let i = 0; i < domains.length; i++) {
    // Guard: if we've been searching for >18s, give up
    if (Date.now() - startTime > 18_000) {
      lastError = lastError || 'Search timed out (>18s)';
      break;
    }
    try {
      const results = await bingSearch(domains[i], query, topK);
      if (results.length === 0) {
        lastError = `${domains[i]} returned no parseable search results`;
        continue;
      }
      return {
        ok: true,
        name: call.name,
        summary: `搜索完成，找到 ${results.length} 条结果`,
        output: results as unknown as JsonValue,
        detail: results
          .map((r, i) => `${i + 1}. [${r.title}](${r.url})\n   ${r.snippet}`)
          .join('\n'),
      };
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      // On permission error don't retry — user needs to reload the extension
      if (lastError.includes('opaque') || lastError.includes('status 0')) break;
      // On other errors try the next domain
    }
  }

  const isPermissionError =
    lastError?.includes('Failed to fetch') ||
    lastError?.includes('NetworkError') ||
    lastError?.includes('opaque') ||
    lastError?.includes('status 0');
  const hasNoParseableResults = lastError?.includes('no parseable search results') === true;

  return {
    ok: false,
    name: call.name,
    summary: hasNoParseableResults ? '搜索无结果' : '搜索失败',
    detail: isPermissionError
      ? `扩展没有访问必应的权限。请完全移除扩展后重新加载 dist/chrome-mv3 目录，或在 chrome://extensions → DeepSeek++ 详情中确认 cn.bing.com 已列入网站访问权限。`
      : hasNoParseableResults
        ? `未找到可解析搜索结果: ${lastError}`
        : `搜索失败: ${lastError}`,
    error: {
      code: isPermissionError
        ? 'search_permission_denied'
        : hasNoParseableResults
          ? 'search_no_results'
          : 'search_failed',
      message: lastError ?? 'unknown error',
      retryable: !isPermissionError,
    },
  };
}

async function bingSearch(domain: string, query: string, topK: number): Promise<SearchResult[]> {
  let url: URL;
  try {
    url = new URL(`https://${domain}/search`);
    url.searchParams.set('q', query);
  } catch {
    throw new Error(`Invalid search domain: ${domain}`);
  }

  // Manual AbortController for timeout (more compatible than AbortSignal.timeout)
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8_000);

  let response: Response;
  try {
    response = await fetch(url.toString(), {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        Accept: 'text/html,application/xhtml+xml',
      },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    if (response.status === 0) {
      throw new Error(`Host permission denied (opaque response) for ${domain}`);
    }
    throw new Error(`${domain} returned status ${response.status}`);
  }

  let html: string;
  try {
    html = await response.text();
  } catch {
    throw new Error(`${domain} response body unreadable`);
  }
  if (html.length < 200) {
    throw new Error(`${domain} returned an empty or blocked response (${html.length} bytes)`);
  }
  return parseBingResults(html, topK);
}

function parseBingResults(html: string, topK: number): SearchResult[] {
  const results: SearchResult[] = [];

  // Bing search results structure:
  // <li class="b_algo">
  //   <h2><a href="URL">Title</a></h2>
  //   <div class="b_caption"><p>Snippet...</p></div>
  // </li>
  const algoRegex = /<li[^>]*class="[^"]*\bb_algo\b[^"]*"[^>]*>([\s\S]*?)<\/li>/gi;

  let match: RegExpExecArray | null;
  while ((match = algoRegex.exec(html)) !== null && results.length < topK) {
    const block = match[1];

    // Extract title link: <h2><a href="URL">Title</a></h2>
    const titleLink = /<h2[^>]*>[\s\S]*?<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<\/h2>/i.exec(block);
    if (!titleLink) continue;

    let url = titleLink[1];
    const title = stripHtml(titleLink[2]).replace(/\s+/g, ' ').trim();

    // Extract snippet from b_caption
    const captionBlock = /<div[^>]*class="[^"]*\bb_caption\b[^"]*"[^>]*>([\s\S]*?)<\/div>/i.exec(block);
    let snippet = '';
    if (captionBlock) {
      // Try <p> inside caption first, otherwise full caption text
      const paraText = /<p[^>]*>([\s\S]*?)<\/p>/i.exec(captionBlock[1]);
      snippet = paraText
        ? stripHtml(paraText[1]).replace(/\s+/g, ' ').trim()
        : stripHtml(captionBlock[1]).replace(/\s+/g, ' ').trim();
    }

    // Bing results sometimes have protocol-relative URLs
    if (url.startsWith('//')) url = 'https:' + url;

    if (title && url) {
      results.push({ title, url, snippet });
    }
  }

  return results.slice(0, topK);
}

// ---------------------------------------------------------------------------
// Web Fetch: download a URL and extract visible text
// ---------------------------------------------------------------------------

async function performWebFetch(call: ToolCall): Promise<ToolResult> {
  const url = typeof call.payload.url === 'string' ? call.payload.url.trim() : '';
  if (!url) {
    return {
      ok: false,
      name: call.name,
      summary: 'URL 不能为空',
      error: { code: 'empty_url', message: 'url is required', retryable: false },
    };
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    return {
      ok: false,
      name: call.name,
      summary: '无效的 URL',
      detail: `无法解析 URL: ${url}`,
      error: { code: 'invalid_url', message: `Invalid URL: ${url}`, retryable: false },
    };
  }

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const contentType = response.headers.get('content-type') || '';
    let text: string;

    if (contentType.includes('text/html') || contentType.includes('text/plain') || contentType.includes('application/json')) {
      text = await response.text();
    } else {
      return {
        ok: true,
        name: call.name,
        summary: `页面类型: ${contentType}`,
        detail: `Content-Type: ${contentType}\nURL: ${url}\n（内容非文本，无法显示）`,
        output: { url, contentType } as unknown as JsonValue,
      };
    }

    const extracted = contentType.includes('text/html') ? extractTextFromHtml(text) : text;
    const maxLength = 50_000;
    const truncated = extracted.length > maxLength;
    const outputText = truncated
      ? extracted.slice(0, maxLength) +
        `\n\n... [内容已截断，共 ${extracted.length} 字符]`
      : extracted;

    return {
      ok: true,
      name: call.name,
      summary: `已获取 ${url}`,
      detail: truncated
        ? `页面长度 ${extracted.length} 字符，已截断至 ${maxLength} 字符`
        : `页面长度 ${extracted.length} 字符`,
      output: { url, content: outputText, contentType, truncated } as unknown as JsonValue,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const isPermissionError =
      message.includes('Failed to fetch') ||
      message.includes('NetworkError') ||
      message.includes('opaque') ||
      message.includes('status 0');
    return {
      ok: false,
      name: call.name,
      summary: '获取页面失败',
      detail: isPermissionError
        ? `无法访问 ${url}，缺少主机权限。`
        : message,
      error: {
        code: isPermissionError ? 'fetch_permission_denied' : 'fetch_failed',
        message: isPermissionError
          ? `Host permission for ${parsedUrl.origin} is not granted.`
          : message,
        retryable: isPermissionError,
      },
    };
  }
}

function extractTextFromHtml(html: string): string {
  // Strip scripts and styles
  let text = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ');
  text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ');
  text = text.replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, ' ');
  text = text.replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, ' ');
  text = text.replace(/<header[^>]*>[\s\S]*?<\/header>/gi, ' ');

  // Strip all remaining HTML tags
  text = text.replace(/<[^>]+>/g, ' ');

  // Decode common HTML entities
  text = text.replace(/&amp;/g, '&');
  text = text.replace(/&lt;/g, '<');
  text = text.replace(/&gt;/g, '>');
  text = text.replace(/&quot;/g, '"');
  text = text.replace(/&#39;/g, "'");
  text = text.replace(/&nbsp;/g, ' ');

  // Collapse whitespace
  text = text.replace(/[\r\n]+/g, '\n');
  text = text.replace(/[ \t]+/g, ' ');
  text = text.replace(/\n\s+\n/g, '\n');
  text = text.replace(/\n{3,}/g, '\n\n');

  return text.trim();
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, '').trim();
}
