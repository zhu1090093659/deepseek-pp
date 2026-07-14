import {
  createEmptyHistoryOrganizerState,
  decodeHistoryOrganizerState,
  normalizeHistoryTags,
  type HistoryOrganizerState,
} from '../../../core/history-organizer/codec';
import { createSerialOperationQueue } from '../../../core/persistence/serial-operation-queue';

export interface HistoryItem {
  sessionId: string;
  title: string;
  element: HTMLElement;
  tags: string[];
}

export interface HistoryOrganizerController {
  stop(): void;
  refreshLabels(): void;
}

export interface HistoryOrganizerLabels {
  enhancedSearchTitle: string;
  tagFilterLabel: string;
  tagPlaceholder: string;
  currentTagsLabel: string;
  currentTagsPlaceholder: string;
  emptySearchStatus: string;
  visibleStatus: (visibleCount: number, totalCount: number) => string;
  storageError: (action: 'load' | 'save', message: string) => string;
}

export const HISTORY_ORGANIZER_STORAGE_KEY = 'deepseek_pp_history_organizer';
const STYLE_ID = 'dpp-history-organizer-css';
const ENHANCER_ID = 'dpp-history-search-enhancer';
const HISTORY_LINK_SELECTOR = [
  'a[href*="/chat/s/"]',
  'a[href*="/a/chat/s/"]',
  'a[href*="chat_session_id="]',
].join(',');
const SYNTHETIC_HISTORY_SURFACE_SELECTOR = '[data-dpp-history-synthetic="true"]';
const PROJECT_SIDEBAR_HIDDEN_ATTR = 'data-dpp-project-sidebar-hidden';
const OFFICIAL_SEARCH_OPTION_SELECTOR = '[role="option"]';

export function extractHistoryItems(root: ParentNode, state: HistoryOrganizerState): HistoryItem[] {
  const seen = new Set<string>();
  const items: HistoryItem[] = [];
  for (const anchor of Array.from(root.querySelectorAll<HTMLAnchorElement>(HISTORY_LINK_SELECTOR))) {
    if (anchor.closest(SYNTHETIC_HISTORY_SURFACE_SELECTOR)) continue;
    const sessionId = parseSessionId(anchor.href);
    if (!sessionId || seen.has(sessionId)) continue;
    seen.add(sessionId);
    const element = findHistoryRow(anchor);
    const title = normalizeTitle(anchor.textContent || element.textContent || sessionId);
    items.push({
      sessionId,
      title,
      element,
      tags: state.tagsBySessionId[sessionId] ?? [],
    });
  }
  return items;
}

export function parseSessionId(href: string): string | null {
  try {
    const url = new URL(href, location.href);
    const pathMatch = url.pathname.match(/\/(?:a\/)?chat\/s\/([^/?#]+)/);
    const value = pathMatch?.[1] ?? url.searchParams.get('chat_session_id');
    return value ? decodeURIComponent(value) : null;
  } catch {
    return null;
  }
}

export function startDeepSeekHistoryOrganizer(
  getLabels: () => HistoryOrganizerLabels,
): HistoryOrganizerController {
  let stopped = false;
  let state = createEmptyHistoryOrganizerState();
  let persistenceError: { action: 'load' | 'save'; message: string } | null = null;
  let tagFilter = '';
  let timer: ReturnType<typeof setTimeout> | null = null;
  const persistenceOperations = createSerialOperationQueue();

  injectStyles();

  const refreshLabels = () => {
    const enhancer = findSearchEnhancer();
    if (enhancer) renderSearchEnhancerLabels(enhancer, getLabels());
    refresh();
  };

  const refresh = () => {
    if (stopped) return;
    const items = extractHistoryItems(document, state);
    for (const item of items) {
      if (item.element.getAttribute(PROJECT_SIDEBAR_HIDDEN_ATTR) !== 'true') {
        item.element.hidden = false;
      }
      item.element.dataset.dppHistoryTags = item.tags.join(', ');
    }

    const dialog = findOfficialSearchDialog(document);
    if (!dialog) return;

    const enhancer = ensureSearchEnhancer(dialog);
    renderSearchEnhancerLabels(enhancer, getLabels());
    bindSearchEnhancer(enhancer, {
      onTagFilterChange(value) {
        tagFilter = value;
        refresh();
      },
      onCurrentTagsChange(value) {
        const sessionId = getCurrentSessionId();
        if (!sessionId) return;
        void persistSessionTags(sessionId, normalizeHistoryTags(value.split(',')));
      },
    });

    const tagInput = enhancer.querySelector<HTMLInputElement>('[data-dpp-history-tag]');
    if (tagInput && tagInput.value !== tagFilter) tagInput.value = tagFilter;

    const currentTagInput = enhancer.querySelector<HTMLInputElement>('[data-dpp-current-tags]');
    const currentSessionId = getCurrentSessionId();
    if (currentTagInput && currentSessionId && document.activeElement !== currentTagInput) {
      currentTagInput.value = (state.tagsBySessionId[currentSessionId] ?? []).join(', ');
    }

    const status = enhancer.querySelector<HTMLElement>('[data-dpp-history-status]');
    const result = applyOfficialSearchTags(dialog, items, tagFilter);
    if (status) {
      const labels = getLabels();
      status.textContent = persistenceError
        ? labels.storageError(persistenceError.action, persistenceError.message)
        : result.total === 0
          ? labels.emptySearchStatus
          : labels.visibleStatus(result.visible, result.total);
    }
  };

  const readPersistedState = async (): Promise<HistoryOrganizerState> => {
    const data = await chrome.storage.local.get(HISTORY_ORGANIZER_STORAGE_KEY) as Record<string, unknown>;
    const value = data[HISTORY_ORGANIZER_STORAGE_KEY];
    return value === undefined
      ? createEmptyHistoryOrganizerState()
      : decodeHistoryOrganizerState(value, 'historyOrganizer');
  };

  const persistSessionTags = async (
    sessionId: string,
    tags: string[],
  ): Promise<void> => {
    try {
      await persistenceOperations.run(async () => {
        const current = await readPersistedState();
        const next: HistoryOrganizerState = {
          ...current,
          schemaVersion: 1,
          tagsBySessionId: {
            ...current.tagsBySessionId,
            [sessionId]: tags,
          },
        };
        await chrome.storage.local.set({ [HISTORY_ORGANIZER_STORAGE_KEY]: next });
        if (stopped) return;
        state = next;
        persistenceError = null;
        refresh();
      });
    } catch (error) {
      if (stopped) return;
      persistenceError = { action: 'save', message: getErrorMessage(error) };
      reportStorageError('save', error);
      refresh();
    }
  };

  const schedule = () => {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      refresh();
    }, 200);
  };

  persistenceOperations.run(readPersistedState)
    .then((loaded) => {
      if (stopped) return;
      state = loaded;
      persistenceError = null;
      refresh();
    })
    .catch((error) => {
      if (stopped) return;
      persistenceError = { action: 'load', message: getErrorMessage(error) };
      reportStorageError('load', error);
      refresh();
    });

  const observer = new MutationObserver(schedule);
  observer.observe(document.body, { childList: true, subtree: true });
  window.addEventListener('dpp:navigation', schedule);
  refresh();

  return {
    refreshLabels,
    stop() {
      stopped = true;
      observer.disconnect();
      window.removeEventListener('dpp:navigation', schedule);
      if (timer) clearTimeout(timer);
      findSearchEnhancer()?.remove();
      for (const item of extractHistoryItems(document, state)) {
        item.element.hidden = false;
        delete item.element.dataset.dppHistoryTags;
      }
      for (const option of document.querySelectorAll<HTMLElement>(OFFICIAL_SEARCH_OPTION_SELECTOR)) {
        option.hidden = false;
        delete option.dataset.dppOfficialHistoryOption;
        delete option.dataset.dppHistoryTags;
      }
      document.getElementById(STYLE_ID)?.remove();
    },
  };
}

export function findOfficialSearchDialog(root: ParentNode): HTMLElement | null {
  for (const dialog of Array.from(root.querySelectorAll<HTMLElement>('[role="dialog"]'))) {
    const hasSearchbox = Boolean(dialog.querySelector('input[role="searchbox"]'));
    const hasListbox = Boolean(dialog.querySelector('[role="listbox"]'));
    if (hasSearchbox && hasListbox) return dialog;
  }
  return null;
}

function findSearchEnhancer(): HTMLElement | null {
  return document.getElementById(ENHANCER_ID);
}

function ensureSearchEnhancer(dialog: HTMLElement): HTMLElement {
  const existing = dialog.querySelector<HTMLElement>(`#${ENHANCER_ID}`);
  if (existing) return existing;
  findSearchEnhancer()?.remove();

  const enhancer = document.createElement('section');
  enhancer.id = ENHANCER_ID;
  enhancer.dataset.dppHistorySearchEnhancer = 'true';
  enhancer.innerHTML = `
    <div class="dpp-history-search-enhancer__bar">
      <span class="dpp-history-search-enhancer__title" data-dpp-history-title></span>
      <span class="dpp-history-search-enhancer__status" data-dpp-history-status></span>
    </div>
    <div class="dpp-history-search-enhancer__controls">
      <div class="dpp-history-search-enhancer__field">
        <label for="dpp-history-tag-filter" data-dpp-history-tag-label></label>
        <input id="dpp-history-tag-filter" data-dpp-history-tag />
      </div>
      <div class="dpp-history-search-enhancer__field">
        <label for="dpp-current-chat-tags" data-dpp-current-tags-label></label>
        <input id="dpp-current-chat-tags" data-dpp-current-tags />
      </div>
    </div>
  `;

  const searchbox = dialog.querySelector<HTMLInputElement>('input[role="searchbox"]');
  const anchor = searchbox?.parentElement ?? null;
  if (anchor) {
    anchor.insertAdjacentElement('afterend', enhancer);
    return enhancer;
  }

  const listbox = dialog.querySelector<HTMLElement>('[role="listbox"]');
  if (listbox?.parentElement) {
    listbox.parentElement.insertBefore(enhancer, listbox);
    return enhancer;
  }

  dialog.prepend(enhancer);
  return enhancer;
}

function bindSearchEnhancer(
  enhancer: HTMLElement,
  handlers: {
    onTagFilterChange(value: string): void;
    onCurrentTagsChange(value: string): void;
  },
): void {
  if (enhancer.dataset.dppBound === 'true') return;
  enhancer.dataset.dppBound = 'true';

  const tagInput = enhancer.querySelector<HTMLInputElement>('[data-dpp-history-tag]');
  const currentTagInput = enhancer.querySelector<HTMLInputElement>('[data-dpp-current-tags]');

  tagInput?.addEventListener('input', () => {
    handlers.onTagFilterChange(tagInput.value);
  });
  currentTagInput?.addEventListener('change', () => {
    handlers.onCurrentTagsChange(currentTagInput.value);
  });
}

function renderSearchEnhancerLabels(enhancer: HTMLElement, labels: HistoryOrganizerLabels): void {
  const title = enhancer.querySelector<HTMLElement>('[data-dpp-history-title]');
  const tagLabel = enhancer.querySelector<HTMLElement>('[data-dpp-history-tag-label]');
  const tagInput = enhancer.querySelector<HTMLInputElement>('[data-dpp-history-tag]');
  const currentTagLabel = enhancer.querySelector<HTMLElement>('[data-dpp-current-tags-label]');
  const currentTagInput = enhancer.querySelector<HTMLInputElement>('[data-dpp-current-tags]');

  if (title) title.textContent = labels.enhancedSearchTitle;
  if (tagLabel) tagLabel.textContent = labels.tagFilterLabel;
  if (tagInput) {
    tagInput.placeholder = labels.tagPlaceholder;
    tagInput.setAttribute('aria-label', labels.tagFilterLabel);
  }
  if (currentTagLabel) currentTagLabel.textContent = labels.currentTagsLabel;
  if (currentTagInput) {
    currentTagInput.placeholder = labels.currentTagsPlaceholder;
    currentTagInput.setAttribute('aria-label', labels.currentTagsLabel);
  }
}

export function applyOfficialSearchTags(
  dialog: ParentNode,
  items: readonly HistoryItem[],
  tagFilter: string,
): { visible: number; total: number } {
  const options = Array.from(dialog.querySelectorAll<HTMLElement>(OFFICIAL_SEARCH_OPTION_SELECTOR));
  const normalizedFilter = tagFilter.trim().toLowerCase();
  let visible = 0;

  for (const option of options) {
    const tags = findTagsForOfficialSearchOption(option, items);
    const matches = !normalizedFilter || tags.some((tag) => tag.toLowerCase().includes(normalizedFilter));
    option.hidden = !matches;
    option.dataset.dppOfficialHistoryOption = 'true';
    option.dataset.dppHistoryTags = tags.join(', ');
    if (matches) visible += 1;
  }

  return { visible, total: options.length };
}

function findTagsForOfficialSearchOption(option: HTMLElement, items: readonly HistoryItem[]): string[] {
  const optionText = normalizeTitle(option.textContent ?? '').toLowerCase();
  if (!optionText) return [];

  return normalizeHistoryTags(items.flatMap((item) => {
    const title = item.title.toLowerCase();
    if (!title || !item.tags.length) return [];
    return optionText.includes(title) || title.includes(optionText) ? item.tags : [];
  }));
}

function injectStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    #${ENHANCER_ID} {
      --dpp-history-accent: #5d81ff;
      --dpp-history-line: rgba(128, 136, 160, 0.22);
      --dpp-history-field: rgba(128, 136, 160, 0.12);
      --dpp-history-field-hover: rgba(128, 136, 160, 0.18);
      --dpp-history-muted: color-mix(in srgb, currentColor 58%, transparent);
      display: grid;
      gap: 9px;
      padding: 10px 18px 12px;
      border-top: 1px solid var(--dpp-history-line);
      border-bottom: 1px solid var(--dpp-history-line);
      background: rgba(128, 136, 160, 0.06);
      background: color-mix(in srgb, currentColor 5%, transparent);
      color: inherit;
      font: 12px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", sans-serif;
    }
    #${ENHANCER_ID} .dpp-history-search-enhancer__bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      min-width: 0;
    }
    #${ENHANCER_ID} .dpp-history-search-enhancer__title {
      flex: 0 0 auto;
      font-weight: 650;
      letter-spacing: 0;
      color: inherit;
    }
    #${ENHANCER_ID} .dpp-history-search-enhancer__status {
      min-width: 0;
      overflow: hidden;
      color: var(--dpp-history-muted);
      text-align: right;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    #${ENHANCER_ID} .dpp-history-search-enhancer__controls {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
      gap: 8px;
    }
    #${ENHANCER_ID} .dpp-history-search-enhancer__field {
      display: grid;
      gap: 5px;
      min-width: 0;
    }
    #${ENHANCER_ID} label {
      overflow: hidden;
      color: var(--dpp-history-muted);
      font-size: 11px;
      font-weight: 560;
      letter-spacing: 0;
      line-height: 1.25;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    #${ENHANCER_ID} input {
      width: 100%;
      min-width: 0;
      min-height: 34px;
      box-sizing: border-box;
      padding: 7px 10px;
      border: 1px solid var(--dpp-history-line);
      border-radius: 8px;
      outline: none;
      background: var(--dpp-history-field);
      color: inherit;
      font: inherit;
    }
    #${ENHANCER_ID} input::placeholder {
      color: currentColor;
      opacity: 0.48;
    }
    #${ENHANCER_ID} input:hover {
      background: var(--dpp-history-field-hover);
    }
    #${ENHANCER_ID} input:focus {
      border-color: color-mix(in srgb, var(--dpp-history-accent) 72%, currentColor);
      box-shadow: 0 0 0 2px color-mix(in srgb, var(--dpp-history-accent) 26%, transparent);
    }
    [data-dpp-history-tags]:not([data-dpp-history-tags=""])::after {
      content: attr(data-dpp-history-tags);
      display: inline-block;
      margin-left: 6px;
      padding: 1px 6px;
      border-radius: 999px;
      background: color-mix(in srgb, var(--dpp-history-accent, #5d81ff) 16%, transparent);
      color: color-mix(in srgb, var(--dpp-history-accent, #5d81ff) 86%, currentColor);
      font-size: 10px;
      font-weight: 560;
      line-height: 1.5;
      vertical-align: middle;
    }
    [role="option"][data-dpp-history-tags]:not([data-dpp-history-tags=""])::after {
      margin-left: 10px;
    }
    @media (max-width: 640px) {
      #${ENHANCER_ID} {
        padding-inline: 14px;
      }
      #${ENHANCER_ID} .dpp-history-search-enhancer__controls {
        grid-template-columns: 1fr;
      }
    }
  `;
  document.head.appendChild(style);
}

function findHistoryRow(anchor: HTMLAnchorElement): HTMLElement {
  let el: HTMLElement = anchor;
  let depth = 0;
  while (el.parentElement && depth < 4) {
    const parent: HTMLElement = el.parentElement;
    if (parent.querySelectorAll('a').length === 1 && parent.textContent && parent.textContent.trim().length <= 240) {
      el = parent;
    }
    depth += 1;
  }
  return el;
}

function normalizeTitle(value: string): string {
  return value.replace(/\s+/g, ' ').trim() || 'Untitled chat';
}

function reportStorageError(
  action: 'load' | 'save',
  error: unknown,
): void {
  console.error(`DeepSeek++ failed to ${action} history tags`, error);
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function getCurrentSessionId(): string | null {
  return parseSessionId(location.href);
}
