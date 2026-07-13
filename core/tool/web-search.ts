import { DEFAULT_LOCALE, translate, type SupportedLocale } from '../i18n';
import { createAbortScope } from '../network/abort';
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
  displayName: translate(DEFAULT_LOCALE, 'tool.web.providerName'),
  transport: 'in_process',
};

export const WEB_SEARCH_TOOL_NAMES = ['web_search', 'web_fetch'] as const;

export type WebSearchToolName = typeof WEB_SEARCH_TOOL_NAMES[number];

export function createWebSearchToolProviderIdentity(
  locale: SupportedLocale = DEFAULT_LOCALE,
): ToolProviderIdentity {
  return {
    ...WEB_SEARCH_TOOL_PROVIDER,
    displayName: translate(locale, 'tool.web.providerName'),
  };
}

export function createWebSearchToolDescriptors(
  locale: SupportedLocale = DEFAULT_LOCALE,
): ToolDescriptor[] {
  const provider = createWebSearchToolProviderIdentity(locale);
  return [{
    id: 'local:web:web_search',
    provider,
    name: 'web_search',
    invocationName: 'web_search',
    title: translate(locale, 'tool.web.searchTitle'),
    description: translate(locale, 'tool.web.searchDescription'),
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: translate(locale, 'tool.web.queryDescription') },
        topK: { type: 'integer', description: translate(locale, 'tool.web.topKDescription') },
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
    provider,
    name: 'web_fetch',
    invocationName: 'web_fetch',
    title: translate(locale, 'tool.web.fetchTitle'),
    description: translate(locale, 'tool.web.fetchDescription'),
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: translate(locale, 'tool.web.urlDescription') },
      },
      required: ['url'],
      additionalProperties: false,
    },
    execution: {
      mode: 'manual',
      enabled: true,
      risk: 'medium',
    },
  },
  ];
}

export const WEB_SEARCH_TOOL_DESCRIPTORS: ToolDescriptor[] = createWebSearchToolDescriptors(DEFAULT_LOCALE);

export function isWebSearchToolName(name: string): name is WebSearchToolName {
  return (WEB_SEARCH_TOOL_NAMES as readonly string[]).includes(name);
}

export async function executeWebSearchToolCall(
  call: ToolCall,
  locale: SupportedLocale = DEFAULT_LOCALE,
  options?: { signal?: AbortSignal },
): Promise<ToolResult> {
  switch (call.name) {
    case 'web_search':
      return performWebSearch(call, locale, options?.signal);
    case 'web_fetch':
      return performWebFetch(call, locale, options?.signal);
    default:
      return {
        ok: false,
        name: call.name,
        provider: call.provider ?? createWebSearchToolProviderIdentity(locale),
        summary: translate(locale, 'tool.web.unsupported'),
        error: {
          code: 'web_tool_unsupported',
          message: `Unsupported web tool: ${call.name}`,
          retryable: false,
        },
      };
  }
}

// ---------------------------------------------------------------------------
// Web Search via Bing without requiring an API key.
// ---------------------------------------------------------------------------

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

async function performWebSearch(
  call: ToolCall,
  locale: SupportedLocale,
  signal?: AbortSignal,
): Promise<ToolResult> {
  const query = typeof call.payload.query === 'string' ? call.payload.query.trim() : '';
  if (!query) {
    return {
      ok: false,
      name: call.name,
      provider: call.provider ?? createWebSearchToolProviderIdentity(locale),
      summary: translate(locale, 'tool.web.emptyQuery'),
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
    throwIfWebToolAborted(signal);
    // Guard: if we've been searching for >18s, give up
    if (Date.now() - startTime > 18_000) {
      lastError = lastError || 'Search timed out (>18s)';
      break;
    }
    try {
      const results = await bingSearch(domains[i], query, topK, locale, signal);
      if (results.length === 0) {
        lastError = `${domains[i]} returned no parseable search results`;
        continue;
      }
      return {
        ok: true,
        name: call.name,
        provider: call.provider ?? createWebSearchToolProviderIdentity(locale),
        summary: translate(locale, 'tool.web.searchComplete', { count: results.length }),
        output: results as unknown as JsonValue,
        detail: results
          .map((r, i) => `${i + 1}. [${r.title}](${r.url})\n   ${r.snippet}`)
          .join('\n'),
      };
    } catch (error) {
      throwIfWebToolAborted(signal);
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
    provider: call.provider ?? createWebSearchToolProviderIdentity(locale),
    summary: hasNoParseableResults
      ? translate(locale, 'tool.web.searchNoResults')
      : translate(locale, 'tool.web.searchFailed'),
    detail: isPermissionError
      ? translate(locale, 'tool.web.permissionDenied')
      : hasNoParseableResults
        ? translate(locale, 'tool.web.noParseableResults', { error: lastError ?? 'unknown error' })
        : translate(locale, 'tool.web.searchFailedDetail', { error: lastError ?? 'unknown error' }),
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

async function bingSearch(
  domain: string,
  query: string,
  topK: number,
  locale: SupportedLocale,
  signal?: AbortSignal,
): Promise<SearchResult[]> {
  let url: URL;
  try {
    url = new URL(`https://${domain}/search`);
    url.searchParams.set('q', query);
  } catch {
    throw new Error(`Invalid search domain: ${domain}`);
  }

  const abortScope = createAbortScope(signal, 8_000);
  try {
    const response = await fetch(url.toString(), {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': locale === 'en' ? 'en-US,en;q=0.9,zh-CN;q=0.6' : 'zh-CN,zh;q=0.9,en;q=0.8',
        Accept: 'text/html,application/xhtml+xml',
      },
      signal: abortScope.signal,
    });

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
      throwIfWebToolAborted(signal);
      throw new Error(`${domain} response body unreadable`);
    }
    if (html.length < 200) {
      throw new Error(`${domain} returned an empty or blocked response (${html.length} bytes)`);
    }
    return parseBingResults(html, topK);
  } finally {
    abortScope.cleanup();
  }
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

async function performWebFetch(
  call: ToolCall,
  locale: SupportedLocale,
  signal?: AbortSignal,
): Promise<ToolResult> {
  const url = typeof call.payload.url === 'string' ? call.payload.url.trim() : '';
  if (!url) {
    return {
      ok: false,
      name: call.name,
      provider: call.provider ?? createWebSearchToolProviderIdentity(locale),
      summary: translate(locale, 'tool.web.emptyUrl'),
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
      provider: call.provider ?? createWebSearchToolProviderIdentity(locale),
      summary: translate(locale, 'tool.web.invalidUrl'),
      detail: translate(locale, 'tool.web.invalidUrlDetail', { url }),
      error: { code: 'invalid_url', message: `Invalid URL: ${url}`, retryable: false },
    };
  }

  try {
    throwIfWebToolAborted(signal);
    const abortScope = createAbortScope(signal, 15_000);
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        },
        signal: abortScope.signal,
      });

      if (!response.ok) {
        await cancelUnusedWebResponseBody(response);
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const contentType = response.headers.get('content-type') || '';
      let text: string;

      if (contentType.includes('text/html') || contentType.includes('text/plain') || contentType.includes('application/json')) {
        text = await response.text();
      } else {
        await cancelUnusedWebResponseBody(response);
        return {
          ok: true,
          name: call.name,
          provider: call.provider ?? createWebSearchToolProviderIdentity(locale),
          summary: translate(locale, 'tool.web.contentType', { contentType }),
          detail: translate(locale, 'tool.web.contentTypeDetail', { contentType, url }),
          output: { url, contentType } as unknown as JsonValue,
        };
      }

      const extracted = contentType.includes('text/html') ? extractTextFromHtml(text) : text;
      const maxLength = 50_000;
      const truncated = extracted.length > maxLength;
      const outputText = truncated
        ? extracted.slice(0, maxLength) +
          translate(locale, 'tool.web.truncated', { count: extracted.length })
        : extracted;

      return {
        ok: true,
        name: call.name,
        provider: call.provider ?? createWebSearchToolProviderIdentity(locale),
        summary: translate(locale, 'tool.web.fetchComplete', { url }),
        detail: truncated
          ? translate(locale, 'tool.web.fetchTruncatedDetail', { length: extracted.length, maxLength })
          : translate(locale, 'tool.web.fetchLengthDetail', { length: extracted.length }),
        output: { url, content: outputText, contentType, truncated } as unknown as JsonValue,
      };
    } finally {
      abortScope.cleanup();
    }
  } catch (error) {
    throwIfWebToolAborted(signal);
    const message = error instanceof Error ? error.message : String(error);
    const isPermissionError =
      message.includes('Failed to fetch') ||
      message.includes('NetworkError') ||
      message.includes('opaque') ||
      message.includes('status 0');
    return {
      ok: false,
      name: call.name,
      provider: call.provider ?? createWebSearchToolProviderIdentity(locale),
      summary: translate(locale, 'tool.web.fetchFailed'),
      detail: isPermissionError
        ? translate(locale, 'tool.web.missingHostPermission', { url })
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

async function cancelUnusedWebResponseBody(response: Response): Promise<void> {
  if (!response.body) return;
  try {
    await response.body.cancel();
  } catch (error) {
    console.warn('[DeepSeek++] Failed to cancel an unused web response body:', error);
  }
}

function throwIfWebToolAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  if (signal.reason instanceof Error) throw signal.reason;
  throw new DOMException('Web tool execution was aborted.', 'AbortError');
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
