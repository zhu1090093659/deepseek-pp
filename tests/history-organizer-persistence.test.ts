import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  HISTORY_ORGANIZER_STORAGE_KEY,
  startDeepSeekHistoryOrganizer,
  type HistoryOrganizerController,
  type HistoryOrganizerLabels,
} from '../entrypoints/content/adapters/history-organizer';

let storage: Record<string, unknown>;
let storageSet: ReturnType<typeof vi.fn>;
let controller: HistoryOrganizerController | null;
let consoleError: ReturnType<typeof vi.spyOn>;

const labels: HistoryOrganizerLabels = {
  enhancedSearchTitle: 'History',
  tagFilterLabel: 'Filter',
  tagPlaceholder: 'tag',
  currentTagsLabel: 'Current tags',
  currentTagsPlaceholder: 'tags',
  emptySearchStatus: 'empty',
  visibleStatus: (visible, total) => `${visible}/${total}`,
  storageError: (action, message) => `${action}:${message}`,
};

beforeEach(() => {
  storage = {};
  controller = null;
  storageSet = vi.fn(async (patch: Record<string, unknown>) => {
    storage = { ...storage, ...structuredClone(patch) };
  });
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: vi.fn(async (key: string) => (
          Object.prototype.hasOwnProperty.call(storage, key)
            ? { [key]: structuredClone(storage[key]) }
            : {}
        )),
        set: storageSet,
      },
    },
  });
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  window.history.replaceState({}, '', '/a/chat/s/session-one');
  document.body.innerHTML = historySurface();
});

afterEach(() => {
  controller?.stop();
  consoleError.mockRestore();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
  window.history.replaceState({}, '', '/');
});

describe('history organizer persistence', () => {
  it('latches future-state load errors and refuses to overwrite the original value', async () => {
    const future = { schemaVersion: 2, tagsBySessionId: {} };
    storage[HISTORY_ORGANIZER_STORAGE_KEY] = future;
    controller = startDeepSeekHistoryOrganizer(() => labels);

    await vi.waitFor(() => {
      expect(statusText()).toContain('load:historyOrganizer.schemaVersion');
    });
    changeCurrentTags('release');
    await vi.waitFor(() => {
      expect(statusText()).toContain('save:historyOrganizer.schemaVersion');
    });

    expect(storage[HISTORY_ORGANIZER_STORAGE_KEY]).toEqual(future);
    expect(storageSet).not.toHaveBeenCalled();
  });

  it('publishes only confirmed state when a storage write fails', async () => {
    const confirmed = {
      tagsBySessionId: { 'session-one': ['confirmed'] },
    };
    storage[HISTORY_ORGANIZER_STORAGE_KEY] = confirmed;
    storageSet.mockRejectedValueOnce(new Error('quota exceeded'));
    controller = startDeepSeekHistoryOrganizer(() => labels);
    await vi.waitFor(() => expect(statusText()).toBe('2/2'));

    changeCurrentTags('unconfirmed');
    await vi.waitFor(() => expect(statusText()).toContain('save:quota exceeded'));

    expect(storage[HISTORY_ORGANIZER_STORAGE_KEY]).toEqual(confirmed);
    const taggedItem = document.querySelector<HTMLElement>('a[href*="session-one"]')?.parentElement;
    expect(taggedItem?.dataset.dppHistoryTags).toBe('confirmed');
  });

  it('serializes rapid writes and re-reads confirmed storage before each mutation', async () => {
    storage[HISTORY_ORGANIZER_STORAGE_KEY] = { tagsBySessionId: {} };
    controller = startDeepSeekHistoryOrganizer(() => labels);
    await vi.waitFor(() => expect(statusText()).toBe('2/2'));

    changeCurrentTags('first');
    window.history.pushState({}, '', '/a/chat/s/session-two');
    changeCurrentTags('second');

    await vi.waitFor(() => {
      expect(storage[HISTORY_ORGANIZER_STORAGE_KEY]).toMatchObject({
        schemaVersion: 1,
        tagsBySessionId: {
          'session-one': ['first'],
          'session-two': ['second'],
        },
      });
    });
    expect(storageSet).toHaveBeenCalledTimes(2);
  });
});

function historySurface(): string {
  return `
    <nav>
      <div><a href="https://chat.deepseek.com/a/chat/s/session-one">One</a></div>
      <div><a href="https://chat.deepseek.com/a/chat/s/session-two">Two</a></div>
    </nav>
    <div role="dialog">
      <div><input role="searchbox" /></div>
      <div role="listbox">
        <div role="option">One</div>
        <div role="option">Two</div>
      </div>
    </div>
  `;
}

function changeCurrentTags(value: string): void {
  const input = document.querySelector<HTMLInputElement>('[data-dpp-current-tags]');
  if (!input) throw new Error('History tag input was not mounted');
  input.value = value;
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

function statusText(): string {
  return document.querySelector('[data-dpp-history-status]')?.textContent ?? '';
}
