import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectContextState } from '../core/types';
import {
  renderProjectSidebar,
  startDeepSeekProjectSidebarOrganizer,
  type ProjectSidebarOrganizerLabels,
} from '../entrypoints/content/adapters/project-sidebar-organizer';

const NOW = 1_700_000_000_000;

const labels: ProjectSidebarOrganizerLabels = {
  title: '项目',
  empty: '还没有项目',
  expandProject: (name) => `展开项目：${name}`,
  collapseProject: (name) => `收起项目：${name}`,
  showMore: '展开显示',
  showLess: '收起显示',
  moveCurrentToProject: (name) => `移入当前对话到 ${name}`,
  removeCurrentFromProject: (name) => `从 ${name} 移出当前对话`,
  joinProject: '加入项目',
  joinProjectNamed: (name) => `加入项目：${name}`,
  moveToProjectNamed: (name) => `移动到项目：${name}`,
  currentProjectNamed: (name) => `已在项目：${name}`,
  removeFromProjectNamed: (name) => `移除项目：${name}`,
  conversationActions: '会话操作',
  newConversationInProject: (name) => `在 ${name} 下开启新对话`,
  useNextConversation: (name) => `下一条新会话使用 ${name}`,
  cancelNextConversation: (name) => `取消下一条新会话使用 ${name}`,
  pendingNextConversation: '下一条新会话将使用此项目',
  untitledConversation: '未命名对话',
  operationFailed: (message) => `项目操作失败：${message}`,
  age: (timestamp) => `${Math.floor((NOW - timestamp) / 60000)} 分`,
};

let sendMessage: ReturnType<typeof vi.fn>;
let runtimeListeners: Set<(
  message: { type?: string; state?: unknown },
  sender: chrome.runtime.MessageSender,
) => void>;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  runtimeListeners = new Set();
  sendMessage = vi.fn();
  vi.stubGlobal('chrome', {
    runtime: {
      id: 'extension-id',
      getURL: vi.fn((path: string) => `chrome-extension://extension-id${path}`),
      sendMessage,
      onMessage: {
        addListener: vi.fn((listener: (
          message: { type?: string; state?: unknown },
          sender: chrome.runtime.MessageSender,
        ) => void) => {
          runtimeListeners.add(listener);
        }),
        removeListener: vi.fn((listener: (
          message: { type?: string; state?: unknown },
          sender: chrome.runtime.MessageSender,
        ) => void) => {
          runtimeListeners.delete(listener);
        }),
      },
    },
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
  document.head.innerHTML = '';
  window.history.pushState({}, '', '/');
  document.title = '';
});

describe('DeepSeek project sidebar organizer', () => {
  it('renders projects inside the native history sidebar and hides project conversations from the raw list', () => {
    const state = createProjectState();
    mountHistoryDom();

    const section = renderProjectSidebar(document, createRenderOptions({
      state,
      expandedProjectIds: new Set(['project-deepseek']),
    }));

    expect(section?.querySelector('.dpp-project-sidebar__section-title')?.textContent).toBe('项目');
    expect(section?.querySelector('.dpp-project-sidebar__project-name')?.textContent).toBe('deepseek-pp');
    expect(section?.querySelector('[data-dpp-project-conversation-id="session-one"]')?.textContent).toContain('发布 0.7.3 版本');
    expect(document.querySelector<HTMLElement>('[data-testid="session-one-row"]')?.hidden).toBe(true);
    expect(document.querySelector<HTMLElement>('[data-testid="session-one-row"]')?.style.getPropertyValue('display')).toBe('none');
    expect(document.querySelector<HTMLElement>('[data-testid="session-two-row"]')?.hidden).toBe(false);
    expect(section?.nextElementSibling?.textContent).toBe('今天');
  });

  it('keeps injected project links out of history extraction on repeated renders', () => {
    const state = createProjectState();
    mountHistoryDom();
    const expandedProjectIds = new Set(['project-deepseek']);

    renderProjectSidebar(document, createRenderOptions({
      state,
      expandedProjectIds,
    }));
    renderProjectSidebar(document, createRenderOptions({
      state,
      expandedProjectIds,
    }));

    expect(document.querySelectorAll('#dpp-project-sidebar')).toHaveLength(1);
    expect(document.querySelectorAll('a[data-dpp-project-conversation-id="session-one"]')).toHaveLength(1);
  });

  it('normalizes stale project conversation urls to the matching history route', () => {
    const state = createProjectState({
      conversations: [{
        conversationId: 'session-one',
        projectId: 'project-deepseek',
        title: '发布 0.7.3 版本',
        url: 'https://chat.deepseek.com/a/chat/new',
        addedAt: NOW - 60_000,
        lastSeenAt: NOW - 60_000,
      }],
    });
    mountHistoryDom();

    const section = renderProjectSidebar(document, createRenderOptions({
      state,
      expandedProjectIds: new Set(['project-deepseek']),
    }));

    expect(section?.querySelector<HTMLAnchorElement>('a[data-dpp-project-conversation-id="session-one"]')?.href)
      .toBe('http://localhost:3000/a/chat/s/session-one');
  });

  it('opens project conversations through the matching native history link', async () => {
    const state = createProjectState();
    sendMessage.mockImplementation(async (message) => {
      if (message.type === 'GET_PROJECT_CONTEXT_STATE') return state;
      return { ok: true };
    });
    mountHistoryDom();
    const nativeOpen = vi.fn((event: Event) => event.preventDefault());
    document.querySelector<HTMLAnchorElement>('[data-testid="session-one-link"]')?.addEventListener('click', nativeOpen);

    const controller = startDeepSeekProjectSidebarOrganizer(() => labels);
    await flushProjectSidebar();

    document.querySelector<HTMLAnchorElement>('a[data-dpp-project-conversation-id="session-one"]')?.click();

    expect(nativeOpen).toHaveBeenCalledTimes(1);
    controller.stop();
  });

  it('does not reschedule renders from its own injected project DOM mutations', async () => {
    const state = createProjectState({ conversations: [] });
    sendMessage.mockImplementation(async (message) => {
      if (message.type === 'GET_PROJECT_CONTEXT_STATE') return state;
      return { ok: true };
    });
    mountHistoryDom();

    const controller = startDeepSeekProjectSidebarOrganizer(() => labels);
    await flushProjectSidebar();
    const row = document.querySelector('.dpp-project-sidebar__project-row');

    await flushProjectSidebar();

    expect(row).not.toBeNull();
    expect(document.querySelector('.dpp-project-sidebar__project-row')).toBe(row);
    controller.stop();
  });

  it('projects invalid repository responses through the shared Project codec', async () => {
    sendMessage.mockImplementation(async (message) => {
      if (message.type === 'GET_PROJECT_CONTEXT_STATE') {
        return {
          schemaVersion: 2,
          projects: [{ id: 'incomplete-project' }],
          conversations: [],
          pendingProjectId: null,
        };
      }
      return { ok: true };
    });
    mountHistoryDom();

    const controller = startDeepSeekProjectSidebarOrganizer(() => labels);
    await flushProjectSidebar();

    expect(document.getElementById('dpp-project-sidebar')?.textContent)
      .toContain('项目操作失败：projectSidebarState.projects[0].name must be a non-empty string');
    controller.stop();
  });

  it('keeps the last valid Project sidebar state when a corrupt update is broadcast', async () => {
    const state = createProjectState();
    sendMessage.mockImplementation(async (message) => {
      if (message.type === 'GET_PROJECT_CONTEXT_STATE') return state;
      return { ok: true };
    });
    mountHistoryDom();
    const controller = startDeepSeekProjectSidebarOrganizer(() => labels);
    await flushProjectSidebar();

    for (const listener of runtimeListeners) {
      listener({
        type: 'PROJECT_CONTEXT_UPDATED',
        state: {
          schemaVersion: 2,
          projects: [{ id: 'incomplete-project' }],
          conversations: [],
          pendingProjectId: null,
        },
      }, {
        id: 'extension-id',
        url: 'chrome-extension://extension-id/background.js',
      });
    }
    await flushProjectSidebar();

    expect(document.getElementById('dpp-project-sidebar')?.textContent)
      .toContain('项目操作失败：projectSidebarUpdate.projects[0].name must be a non-empty string');
    expect(document.querySelector('.dpp-project-sidebar__project-name')?.textContent)
      .toBe('deepseek-pp');
    controller.stop();
  });

  it('moves the current conversation from the project sidebar action', async () => {
    const state = createProjectState({ conversations: [] });
    sendMessage.mockImplementation(async (message) => {
      if (message.type === 'GET_PROJECT_CONTEXT_STATE') return state;
      return { ok: true };
    });
    mountHistoryDom();
    window.history.pushState({}, '', '/a/chat/s/session-two');
    document.title = '检查未提交更改 - DeepSeek';

    const controller = startDeepSeekProjectSidebarOrganizer(() => labels);
    await flushProjectSidebar();

    document.querySelector<HTMLButtonElement>('[data-dpp-project-action="move-current"]')?.click();
    await Promise.resolve();

    expect(sendMessage).toHaveBeenCalledWith({
      type: 'ADD_CONVERSATION_TO_PROJECT',
      payload: {
        projectId: 'project-deepseek',
        conversation: {
          conversationId: 'session-two',
          title: '检查未提交更改',
          url: 'http://localhost:3000/a/chat/s/session-two',
        },
      },
    });
    controller.stop();
  });

  it('injects project actions into DeepSeek native conversation menus', async () => {
    const state = createProjectState({ conversations: [] });
    sendMessage.mockImplementation(async (message) => {
      if (message.type === 'GET_PROJECT_CONTEXT_STATE') return state;
      return { ok: true };
    });
    mountHistoryDom();

    const controller = startDeepSeekProjectSidebarOrganizer(() => labels);
    await flushProjectSidebar();
    document.querySelector<HTMLButtonElement>('[data-testid="session-two-menu"]')?.click();
    document.body.insertAdjacentHTML('beforeend', `
      <div role="menu" data-testid="native-menu">
        <button>重命名</button>
        <button>置顶</button>
        <button>分享</button>
        <button>删除</button>
      </div>
    `);
    await flushProjectSidebar();

    expect(document.querySelector('[data-dpp-project-native-menu="true"]')?.textContent).toContain('加入项目');
    document.querySelector<HTMLButtonElement>('[data-dpp-project-native-action="join"]')?.click();
    await Promise.resolve();

    expect(sendMessage).toHaveBeenCalledWith({
      type: 'ADD_CONVERSATION_TO_PROJECT',
      payload: {
        projectId: 'project-deepseek',
        conversation: {
          conversationId: 'session-two',
          title: '检查未提交更改',
          url: 'https://chat.deepseek.com/a/chat/s/session-two',
        },
      },
    });
    controller.stop();
  });

  it('handles native project actions before the host menu can swallow click events', async () => {
    const state = createProjectState({ conversations: [] });
    sendMessage.mockImplementation(async (message) => {
      if (message.type === 'GET_PROJECT_CONTEXT_STATE') return state;
      return { ok: true };
    });
    mountHistoryDom();

    const controller = startDeepSeekProjectSidebarOrganizer(() => labels);
    await flushProjectSidebar();
    document.querySelector<HTMLButtonElement>('[data-testid="session-two-menu"]')?.click();
    document.body.insertAdjacentHTML('beforeend', `
      <div role="menu" data-testid="native-menu">
        <button>重命名</button>
        <button>置顶</button>
        <button>分享</button>
        <button>删除</button>
      </div>
    `);
    await flushProjectSidebar();

    const swallowHostClick = (event: Event) => {
      event.stopPropagation();
    };
    document.addEventListener('click', swallowHostClick, true);
    try {
      const join = document.querySelector<HTMLButtonElement>('[data-dpp-project-native-action="join"]')!;
      join.dispatchEvent(new Event('pointerdown', { bubbles: true, cancelable: true }));
      join.click();
      await Promise.resolve();
    } finally {
      document.removeEventListener('click', swallowHostClick, true);
      controller.stop();
    }

    const addCalls = sendMessage.mock.calls.filter(([message]) => message.type === 'ADD_CONVERSATION_TO_PROJECT');
    expect(addCalls).toHaveLength(1);
    expect(addCalls[0][0]).toMatchObject({
      payload: {
        projectId: 'project-deepseek',
        conversation: { conversationId: 'session-two' },
      },
    });
  });

  it('removes a conversation from its project through the project row menu', async () => {
    const state = createProjectState();
    sendMessage.mockImplementation(async (message) => {
      if (message.type === 'GET_PROJECT_CONTEXT_STATE') return state;
      return { ok: true };
    });
    mountHistoryDom();

    const controller = startDeepSeekProjectSidebarOrganizer(() => labels);
    await flushProjectSidebar();

    document.querySelector<HTMLButtonElement>('[data-dpp-project-conversation-menu="true"]')?.click();
    await flushProjectSidebar();
    expect(document.querySelector('.dpp-project-sidebar__conversation-menu')?.textContent).toContain('移除项目：deepseek-pp');

    document.querySelector<HTMLButtonElement>('[data-dpp-project-remove-conversation="true"]')?.click();
    await Promise.resolve();

    expect(sendMessage).toHaveBeenCalledWith({
      type: 'REMOVE_CONVERSATION_FROM_PROJECT',
      payload: { conversationId: 'session-one' },
    });
    controller.stop();
  });

  it('opens the project conversation menu before host sidebar click handlers can swallow the event', async () => {
    const state = createProjectState();
    sendMessage.mockImplementation(async (message) => {
      if (message.type === 'GET_PROJECT_CONTEXT_STATE') return state;
      return { ok: true };
    });
    mountHistoryDom();

    const controller = startDeepSeekProjectSidebarOrganizer(() => labels);
    await flushProjectSidebar();

    const swallowHostClick = (event: Event) => {
      event.stopPropagation();
    };
    document.addEventListener('click', swallowHostClick, true);
    try {
      const menuButton = document.querySelector<HTMLButtonElement>('[data-dpp-project-conversation-menu="true"]')!;
      menuButton.dispatchEvent(new Event('pointerdown', { bubbles: true, cancelable: true }));
      menuButton.click();
      await flushProjectSidebar();
      expect(document.querySelector('.dpp-project-sidebar__conversation-menu')?.textContent).toContain('移除项目：deepseek-pp');
    } finally {
      document.removeEventListener('click', swallowHostClick, true);
      controller.stop();
    }
  });

  it('removes injected UI and restores hidden history rows on stop', async () => {
    const state = createProjectState();
    sendMessage.mockResolvedValue(state);
    mountHistoryDom();

    const controller = startDeepSeekProjectSidebarOrganizer(() => labels);
    await flushProjectSidebar();
    expect(document.getElementById('dpp-project-sidebar')).not.toBeNull();
    expect(document.querySelector<HTMLElement>('[data-testid="session-one-row"]')?.hidden).toBe(true);

    controller.stop();

    expect(document.getElementById('dpp-project-sidebar')).toBeNull();
    expect(document.querySelector<HTMLElement>('[data-testid="session-one-row"]')?.hidden).toBe(false);
    expect(document.querySelector<HTMLElement>('[data-testid="session-one-row"]')?.style.getPropertyValue('display')).toBe('');
  });

  it('toggles a project as the pending context for the next new conversation', async () => {
    const state = createProjectState({ conversations: [] });
    sendMessage.mockImplementation(async (message) => {
      if (message.type === 'GET_PROJECT_CONTEXT_STATE') return state;
      return { ok: true };
    });
    mountHistoryDom();

    const controller = startDeepSeekProjectSidebarOrganizer(() => labels);
    await flushProjectSidebar();

    document.querySelector<HTMLButtonElement>('[data-dpp-project-action="toggle-pending"]')?.click();
    await Promise.resolve();

    expect(sendMessage).toHaveBeenCalledWith({
      type: 'SET_PENDING_PROJECT_CONTEXT',
      payload: { projectId: 'project-deepseek' },
    });
    controller.stop();
  });

  it('renders the pending banner and reflects pending state on the toggle button', () => {
    const state = createProjectState({ conversations: [], pendingProjectId: 'project-deepseek' });
    mountHistoryDom();

    const section = renderProjectSidebar(document, createRenderOptions({
      state,
      expandedProjectIds: new Set(['project-deepseek']),
    }));

    expect(section?.querySelector('.dpp-project-sidebar__pending')?.textContent).toBe('下一条新会话将使用此项目');
    const toggleButton = section?.querySelector<HTMLButtonElement>('[data-dpp-project-action="toggle-pending"]');
    expect(toggleButton?.dataset.active).toBe('true');
    expect(toggleButton?.getAttribute('aria-label')).toBe('取消下一条新会话使用 deepseek-pp');
  });

  it('exposes a one-step action to start a new conversation in a project', () => {
    const state = createProjectState({ conversations: [] });
    const onNewProjectConversation = vi.fn();
    mountHistoryDom();

    const section = renderProjectSidebar(document, createRenderOptions({
      state,
      onNewProjectConversation,
    }));

    const button = section?.querySelector<HTMLButtonElement>('[data-dpp-project-action="new-project-conversation"]');
    expect(button?.getAttribute('aria-label')).toBe('在 deepseek-pp 下开启新对话');
    button?.click();

    expect(onNewProjectConversation).toHaveBeenCalledWith('project-deepseek');
  });

  it('uses the native history title when a project conversation still has the default DeepSeek title', () => {
    const state = createProjectState({
      conversations: [{
        conversationId: 'session-one',
        projectId: 'project-deepseek',
        title: 'DeepSeek-探索未至之境',
        url: 'https://chat.deepseek.com/a/chat/s/session-one',
        addedAt: NOW - 60_000,
        lastSeenAt: NOW - 60_000,
      }],
    });
    mountHistoryDom();

    const section = renderProjectSidebar(document, createRenderOptions({
      state,
      expandedProjectIds: new Set(['project-deepseek']),
    }));

    expect(section?.querySelector('[data-dpp-project-conversation-id="session-one"]')?.textContent)
      .toContain('发布 0.7.3 版本');
  });

  it('localizes stored untitled project conversation placeholders', () => {
    const state = createProjectState({
      conversations: [{
        conversationId: 'session-missing',
        projectId: 'project-deepseek',
        title: 'Untitled conversation',
        url: 'https://chat.deepseek.com/a/chat/s/session-missing',
        addedAt: NOW - 60_000,
        lastSeenAt: NOW - 60_000,
      }],
    });
    mountHistoryDom();

    const section = renderProjectSidebar(document, createRenderOptions({
      state,
      expandedProjectIds: new Set(['project-deepseek']),
    }));

    expect(section?.querySelector('[data-dpp-project-conversation-id="session-missing"]')?.textContent)
      .toContain('未命名对话');
  });

  it('shows a toggle to expand conversations beyond the project limit', () => {
    const conversations = Array.from({ length: 6 }, (_, index) => ({
      conversationId: `session-${index}`,
      projectId: 'project-deepseek',
      title: `任务 ${index}`,
      url: `https://chat.deepseek.com/a/chat/s/session-${index}`,
      addedAt: NOW - index * 1000,
      lastSeenAt: NOW - index * 1000,
    }));
    const state = createProjectState({ conversations });
    mountHistoryDom();

    const collapsed = renderProjectSidebar(document, createRenderOptions({
      state,
      expandedProjectIds: new Set(['project-deepseek']),
    }));
    expect(collapsed?.querySelectorAll('.dpp-project-sidebar__conversation-row')).toHaveLength(5);
    expect(collapsed?.querySelector('[data-dpp-project-show-all]')?.textContent).toBe('展开显示');

    const onToggleShowAll = vi.fn();
    const expanded = renderProjectSidebar(document, createRenderOptions({
      state,
      expandedProjectIds: new Set(['project-deepseek']),
      showAllProjectIds: new Set(['project-deepseek']),
      onToggleShowAll,
    }));
    expect(expanded?.querySelectorAll('.dpp-project-sidebar__conversation-row')).toHaveLength(6);
    expect(expanded?.querySelector('[data-dpp-project-show-all]')?.textContent).toBe('收起显示');

    expanded?.querySelector<HTMLButtonElement>('[data-dpp-project-show-all]')?.click();
    expect(onToggleShowAll).toHaveBeenCalledWith('project-deepseek');
  });
});

function mountHistoryDom() {
  document.body.innerHTML = `
    <nav data-testid="sidebar">
      <button>开启新对话</button>
      <div>今天</div>
      <div data-testid="session-one-row"><a data-testid="session-one-link" href="https://chat.deepseek.com/a/chat/s/session-one">发布 0.7.3 版本</a><button data-testid="session-one-menu">...</button></div>
      <div data-testid="session-two-row"><a data-testid="session-two-link" href="https://chat.deepseek.com/a/chat/s/session-two">检查未提交更改</a><button data-testid="session-two-menu">...</button></div>
    </nav>
  `;
}

function createRenderOptions(
  overrides: Partial<Parameters<typeof renderProjectSidebar>[1]> & {
    state: ProjectContextState;
  },
): Parameters<typeof renderProjectSidebar>[1] {
  return {
    labels,
    statusMessage: '',
    expandedProjectIds: new Set(),
    showAllProjectIds: new Set(),
    onToggleProject: vi.fn(),
    onToggleShowAll: vi.fn(),
    onOpenProjectConversation: vi.fn(),
    onOpenProjectConversationMenu: vi.fn(),
    onRemoveConversationFromProject: vi.fn(),
    onMoveCurrent: vi.fn(),
    onNewProjectConversation: vi.fn(),
    onTogglePending: vi.fn(),
    ...overrides,
  };
}

function createProjectState(overrides: Partial<ProjectContextState> = {}): ProjectContextState {
  return {
    schemaVersion: 2,
    projects: [{
      id: 'project-deepseek',
      name: 'deepseek-pp',
      description: '',
      instructions: 'Keep release context.',
      createdAt: NOW - 100_000,
      updatedAt: NOW - 90_000,
    }],
    conversations: [{
      conversationId: 'session-one',
      projectId: 'project-deepseek',
      title: '发布 0.7.3 版本',
      url: 'https://chat.deepseek.com/a/chat/s/session-one',
      addedAt: NOW - 60_000,
      lastSeenAt: NOW - 60_000,
    }],
    pendingProjectId: null,
    ...overrides,
  };
}

async function flushProjectSidebar() {
  await Promise.resolve();
  vi.advanceTimersByTime(120);
  await Promise.resolve();
}
