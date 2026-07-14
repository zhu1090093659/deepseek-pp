import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createImageAttachmentManifestArtifact,
  createMessageMarkdownArtifact,
  createSavedItemsJsonArtifact,
  createSavedItemsMarkdownArtifact,
} from '../core/export/secondary-artifacts';
import {
  extractHistoryItems,
  parseSessionId,
  startDeepSeekHistoryOrganizer,
} from '../entrypoints/content/adapters/history-organizer';
import { decodeHistoryOrganizerState } from '../core/history-organizer/codec';
import {
  collectCodeBlocks,
  getCodeBlockText,
  inferCodeFilename,
  startContentUxPolish,
} from '../entrypoints/content/adapters/ux-polish';
import type { SavedItem } from '../core/saved-items';

let storage: Record<string, unknown>;

beforeEach(() => {
  storage = {};
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: vi.fn(async (key: string) => ({ [key]: storage[key] })),
        set: vi.fn(async (values: Record<string, unknown>) => {
          storage = { ...storage, ...values };
        }),
      },
    },
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('Phase 5 product surface helpers', () => {
  it('extracts DeepSeek history items with tags isolated from DOM text', () => {
    document.body.innerHTML = `
      <nav>
        <div><a href="https://chat.deepseek.com/a/chat/s/session-one">Release notes</a></div>
        <div><a href="https://chat.deepseek.com/a/chat/s/session-two">Android WebView</a></div>
        <div><a href="https://chat.deepseek.com/a/chat/s/session-three">Refactor adapters</a><span>2m ago</span></div>
      </nav>
    `;
    const state = decodeHistoryOrganizerState({
      tagsBySessionId: {
        'session-one': ['release'],
        'session-two': ['android'],
        'session-three': ['refactor'],
      },
    });
    const items = extractHistoryItems(document, state);

    expect(parseSessionId('https://chat.deepseek.com/a/chat/s/session-one')).toBe('session-one');
    expect(items.map((item) => item.sessionId)).toEqual(['session-one', 'session-two', 'session-three']);
    expect(items.map((item) => item.tags)).toEqual([['release'], ['android'], ['refactor']]);
    // Title comes from the anchor text, not the surrounding row noise (timestamps, etc.).
    expect(items.map((item) => item.title)).toEqual(['Release notes', 'Android WebView', 'Refactor adapters']);
  });

  it('collects code blocks and infers download filenames', () => {
    document.body.innerHTML = `
      <pre><code class="language-ts">const ok: boolean = true;</code></pre>
      <pre><code class="language-python">print("ok")</code></pre>
    `;
    const blocks = collectCodeBlocks(document);

    expect(blocks).toHaveLength(2);
    expect(inferCodeFilename(blocks[0], 0)).toBe('deepseek-code-1.ts');
    expect(inferCodeFilename(blocks[1], 1)).toBe('deepseek-code-2.py');
    blocks[0].appendChild(Object.assign(document.createElement('button'), { textContent: 'Download' }));
    expect(getCodeBlockText(blocks[0])).toBe('const ok: boolean = true;');
  });

  it('renders injected content controls with provided localized labels', () => {
    document.body.innerHTML = `
      <nav>
        <div><a href="https://chat.deepseek.com/a/chat/s/session-one">Release notes</a></div>
      </nav>
      <div role="dialog">
        <div><input role="searchbox" /></div>
        <div role="listbox">
          <div role="option">Release notes yesterday</div>
        </div>
      </div>
      <pre><code class="language-ts">const ok = true;</code></pre>
      <div data-message-id="message-1" data-message-role="assistant">Hello</div>
    `;

    const history = startDeepSeekHistoryOrganizer(() => ({
      enhancedSearchTitle: 'DeepSeek++ 搜索增强',
      tagFilterLabel: '按标签筛选结果',
      tagPlaceholder: '输入标签名',
      currentTagsLabel: '给当前对话加标签',
      currentTagsPlaceholder: '逗号分隔，例如：港股, 写作',
      emptySearchStatus: 'DeepSeek++：等待官方搜索结果',
      visibleStatus: (visibleCount, totalCount) => `DeepSeek++：已显示 ${visibleCount}/${totalCount}`,
      storageError: (_action, message) => `DeepSeek++：历史标签错误：${message}`,
    }));
    const polish = startContentUxPolish(() => ({
      codeDownloadButton: '下载',
      messageMarkdownButton: 'MD',
      messageMarkdownTitle: '下载消息为 Markdown',
    }));

    try {
      expect(document.querySelector('#dpp-history-search-enhancer')).not.toBeNull();
      expect(document.querySelector('[data-dpp-history-title]')?.textContent).toBe('DeepSeek++ 搜索增强');
      expect(document.querySelector('[data-dpp-history-search]')).toBeNull();
      expect(document.querySelector('[data-dpp-history-tag-label]')?.textContent).toBe('按标签筛选结果');
      expect(document.querySelector<HTMLInputElement>('[data-dpp-history-tag]')?.placeholder).toBe('输入标签名');
      expect(document.querySelector('[data-dpp-current-tags-label]')?.textContent).toBe('给当前对话加标签');
      expect(document.querySelector<HTMLInputElement>('[data-dpp-current-tags]')?.placeholder).toBe('逗号分隔，例如：港股, 写作');
      expect(document.querySelector('[data-dpp-history-status]')?.textContent).toBe('DeepSeek++：已显示 1/1');
      expect(document.querySelector<HTMLButtonElement>('.dpp-code-download')?.textContent).toBe('下载');
      expect(document.querySelector('pre')?.querySelector('.dpp-code-download')).toBeNull();
      expect(document.querySelector<HTMLButtonElement>('.dpp-message-download')?.title).toBe('下载消息为 Markdown');
    } finally {
      history.stop();
      polish.stop();
    }
  });

  it('does not rescan processed large code block text while streaming', async () => {
    vi.useFakeTimers();
    document.body.innerHTML = '<section id="stream"></section>';
    const polish = startContentUxPolish(() => ({
      codeDownloadButton: '下载',
      messageMarkdownButton: 'MD',
      messageMarkdownTitle: '下载消息为 Markdown',
    }));

    try {
      const host = document.getElementById('stream')!;
      const pre = document.createElement('pre');
      const code = document.createElement('code');
      pre.appendChild(code);
      host.appendChild(pre);

      await Promise.resolve();
      vi.advanceTimersByTime(60);
      expect(document.querySelector('.dpp-code-download')).not.toBeNull();
      expect(pre.querySelector('.dpp-code-download')).toBeNull();
      expect(Array.from(pre.childNodes)).toEqual([code]);

      Object.defineProperty(pre, 'textContent', {
        configurable: true,
        get() {
          throw new Error('processed code block text should not be read again');
        },
      });
      code.appendChild(document.createTextNode('<!doctype html>' + '<canvas></canvas>'.repeat(5000)));

      await Promise.resolve();
      vi.advanceTimersByTime(60);
      expect(document.querySelectorAll('.dpp-code-download')).toHaveLength(1);
      expect(Array.from(pre.childNodes)).toEqual([code]);
    } finally {
      polish.stop();
    }
  });

  it('filters official search results by DeepSeek++ history tags', async () => {
    storage.deepseek_pp_history_organizer = {
      tagsBySessionId: {
        'session-one': ['release'],
      },
    };
    document.body.innerHTML = `
      <nav>
        <div><a href="https://chat.deepseek.com/a/chat/s/session-one">Release notes</a></div>
        <div><a href="https://chat.deepseek.com/a/chat/s/session-two">Android WebView</a></div>
      </nav>
      <div role="dialog">
        <div><input role="searchbox" /></div>
        <div role="listbox">
          <div role="option" data-testid="release-result">Release notes yesterday</div>
          <div role="option" data-testid="android-result">Android WebView</div>
        </div>
      </div>
    `;

    const history = startDeepSeekHistoryOrganizer(() => ({
      enhancedSearchTitle: 'DeepSeek++ 搜索增强',
      tagFilterLabel: '按标签筛选结果',
      tagPlaceholder: '输入标签名',
      currentTagsLabel: '给当前对话加标签',
      currentTagsPlaceholder: '逗号分隔，例如：港股, 写作',
      emptySearchStatus: 'DeepSeek++：等待官方搜索结果',
      visibleStatus: (visibleCount, totalCount) => `DeepSeek++：已显示 ${visibleCount}/${totalCount}`,
      storageError: (_action, message) => `DeepSeek++：历史标签错误：${message}`,
    }));

    try {
      const tagInput = document.querySelector<HTMLInputElement>('[data-dpp-history-tag]');
      tagInput!.value = 'rel';
      tagInput!.dispatchEvent(new Event('input', { bubbles: true }));

      await vi.waitFor(() => {
        expect(document.querySelector<HTMLElement>('[data-testid="release-result"]')?.hidden).toBe(false);
        expect(document.querySelector<HTMLElement>('[data-testid="android-result"]')?.hidden).toBe(true);
        expect(document.querySelector('[data-dpp-history-status]')?.textContent).toBe('DeepSeek++：已显示 1/2');
      });
    } finally {
      history.stop();
    }
  });

  it('creates optional message, saved-item, and image export artifacts', () => {
    const savedItems: SavedItem[] = [{
      id: 'saved-1',
      syncId: 'sync-1',
      kind: 'snippet',
      title: 'Prompt',
      content: 'Summarize this.',
      tags: ['prompt'],
      createdAt: 1,
      updatedAt: 2,
    }];

    expect(createMessageMarkdownArtifact({
      id: 'message-1',
      role: 'assistant',
      content: 'Hello',
      createdAt: null,
    }).content).toContain('Hello');
    expect(createSavedItemsMarkdownArtifact(savedItems).content).toContain('Summarize this.');
    expect(JSON.parse(createSavedItemsJsonArtifact(savedItems).content).items[0].id).toBe('saved-1');
    expect(createImageAttachmentManifestArtifact([{
      id: 'image-1',
      fileName: 'chart.png',
      mimeType: 'image/png',
      sizeBytes: 128,
      status: 'metadata_available',
      sourceMessageIds: ['message-1'],
    }]).content).toContain('chart.png');
  });
});
