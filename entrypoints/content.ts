import type { BackgroundConfig, Memory, ModelType, Skill, SystemPromptPreset, ToolCall } from '../core/types';
import { stripToolCalls } from '../core/interceptor/tool-parser';

export default defineContentScript({
  matches: ['*://chat.deepseek.com/*'],
  runAt: 'document_start',
  async main() {

    await new Promise((r) => {
      if (document.readyState === 'complete' || document.readyState === 'interactive') r(undefined);
      else document.addEventListener('DOMContentLoaded', () => r(undefined), { once: true });
    });

    const [memories, skills, activePreset, modelType] = await Promise.all([
      chrome.runtime.sendMessage({ type: 'GET_MEMORIES' }),
      chrome.runtime.sendMessage({ type: 'GET_SKILLS' }),
      chrome.runtime.sendMessage({ type: 'GET_ACTIVE_PRESET' }),
      chrome.runtime.sendMessage({ type: 'GET_MODEL_TYPE' }),
    ]);

    syncToMainWorld(memories ?? [], skills ?? [], activePreset, modelType);

    window.addEventListener('message', async (event) => {
      if (event.data?.source !== 'deepseek-pp-main') return;

      switch (event.data.type) {
        case 'TOOL_CALL': {
          const call = event.data.data as ToolCall;
          await handleToolCall(call);
          break;
        }
        case 'MEMORIES_USED': {
          const ids = event.data.ids as number[];
          await chrome.runtime.sendMessage({ type: 'TOUCH_MEMORIES', payload: { ids } });
          break;
        }
        case 'RESPONSE_COMPLETE': {
          cleanToolCallsFromDOM();
          break;
        }
      }
    });

    chrome.runtime.sendMessage({ type: 'GET_BACKGROUND' }).then((cfg: BackgroundConfig | null) => {
      applyBackground(cfg);
    });

    chrome.runtime.onMessage.addListener((message) => {
      if (message.type === 'STATE_UPDATED') {
        syncToMainWorld(message.memories, message.skills, message.activePreset, message.modelType);
      } else if (message.type === 'BACKGROUND_UPDATED') {
        applyBackground(message.config as BackgroundConfig | null);
      }
    });

    setupDOMObserver();
  },
});

function syncToMainWorld(memories: Memory[], skills: Skill[], activePreset: SystemPromptPreset | null, modelType: ModelType) {
  window.postMessage({
    source: 'deepseek-pp-content',
    type: 'SYNC_STATE',
    memories,
    skills,
    activePreset,
    modelType,
  });
}

async function handleToolCall(call: ToolCall) {
  if (call.name === 'memory_save') {
    const payload = call.payload as {
      type: string;
      name: string;
      content: string;
      tags?: string[];
    };
    await chrome.runtime.sendMessage({
      type: 'SAVE_MEMORY',
      payload: {
        type: payload.type || 'topic',
        name: payload.name || 'unnamed',
        content: payload.content || '',
        description: payload.name || '',
        tags: payload.tags || [],
        pinned: false,
      },
    });
    showMemoryBadge('save', payload.name);
  } else if (call.name === 'memory_update') {
    const payload = call.payload as {
      id: number;
      type?: string;
      name?: string;
      content?: string;
      tags?: string[];
    };
    const id = Number(payload.id);
    if (!id) return;
    const existing = await chrome.runtime.sendMessage({ type: 'GET_MEMORY_BY_ID', payload: { id } });
    if (!existing) return;
    await chrome.runtime.sendMessage({
      type: 'UPDATE_MEMORY',
      payload: {
        ...existing,
        type: payload.type || existing.type,
        name: payload.name || existing.name,
        content: payload.content || existing.content,
        description: payload.name || existing.description,
        tags: payload.tags || existing.tags,
      },
    });
    showMemoryBadge('update', payload.name || existing.name);
  } else if (call.name === 'memory_delete') {
    const payload = call.payload as { id: number };
    const id = Number(payload.id);
    if (!id) return;
    await chrome.runtime.sendMessage({ type: 'DELETE_MEMORY', payload: { id } });
    showMemoryBadge('delete', `#${id}`);
  }
}

function showMemoryBadge(action: 'save' | 'update' | 'delete', name: string) {
  const labels = { save: '已记住', update: '已更新', delete: '已删除' };
  const badge = document.createElement('div');
  badge.className = 'deepseek-pp-memory-badge';
  badge.textContent = `🧠 ${labels[action]}: ${name}`;
  badge.style.cssText = `
    position: fixed; bottom: 20px; right: 20px; z-index: 99999;
    background: #4D6BFE; color: white; padding: 10px 18px;
    border-radius: 10px; font-size: 13px; font-weight: 500;
    font-family: -apple-system, BlinkMacSystemFont, 'PingFang SC', sans-serif;
    box-shadow: 0 4px 12px rgba(77, 107, 254, 0.3);
    animation: slideIn 0.3s ease, fadeOut 0.3s ease 2.7s;
    opacity: 1; transition: opacity 0.3s;
  `;
  document.body.appendChild(badge);
  setTimeout(() => badge.remove(), 3000);
}

function cleanToolCallsFromDOM() {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);

  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    const text = node.textContent || '';
    const cleaned = stripToolCalls(text);
    if (cleaned !== text) {
      node.textContent = cleaned;
    }
  }
}

function setupDOMObserver() {
  let cleanTimer: ReturnType<typeof setTimeout> | null = null;

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType === Node.ELEMENT_NODE) {
          const el = node as HTMLElement;
          if ((el.textContent || '').includes('<｜DSML｜tool_calls')) {
            if (cleanTimer) clearTimeout(cleanTimer);
            cleanTimer = setTimeout(() => {
              cleanTimer = null;
              cleanToolCallsFromDOM();
            }, 100);
            return;
          }
        }
      }
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });
}

function getToolbarBottom(): number {
  const root = document.getElementById('root');
  if (!root) return 0;

  function walk(el: Element): number {
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    if (
      rect.top >= -2 && rect.top <= 5 &&
      rect.height > 30 && rect.height <= 80 &&
      rect.width > 300 &&
      (style.position === 'absolute' || style.position === 'sticky' || style.position === 'fixed')
    ) {
      return rect.bottom;
    }
    for (const child of el.children) {
      const result = walk(child);
      if (result > 0) return result;
    }
    return 0;
  }

  return walk(root);
}

function removeBackground() {
  document.getElementById('dpp-bg')?.remove();
  document.getElementById('dpp-bg-style')?.remove();
  document.body.classList.remove('dpp-bg-active');
  document.body.style.removeProperty('--dpp-overlay-light');
  document.body.style.removeProperty('--dpp-overlay-dark');
  document.body.style.removeProperty('--dpp-blur');
}

function applyBackground(config: BackgroundConfig | null) {
  const imageUrl = config?.enabled
    ? (config.type === 'url' ? config.url : config.imageData) || null
    : null;

  if (!imageUrl) {
    removeBackground();
    return;
  }

  const existingBg = document.getElementById('dpp-bg');
  const existingStyle = document.getElementById('dpp-bg-style');

  document.body.classList.add('dpp-bg-active');

  const overlayAlpha = (1 - config.opacity).toFixed(3);
  const blurPx = ((1 - config.opacity) * 8).toFixed(1);
  document.body.style.setProperty('--dpp-overlay-light', `rgba(255, 255, 255, ${overlayAlpha})`);
  document.body.style.setProperty('--dpp-overlay-dark', `rgba(30, 30, 30, ${overlayAlpha})`);
  document.body.style.setProperty('--dpp-blur', `blur(${blurPx}px)`);

  const topOffset = getToolbarBottom();

  const bgDiv = existingBg || document.createElement('div');
  bgDiv.id = 'dpp-bg';
  Object.assign(bgDiv.style, {
    position: 'fixed',
    top: `${topOffset}px`,
    left: '0',
    right: '0',
    bottom: '0',
    zIndex: '-1',
    backgroundImage: `url("${imageUrl.replace(/[\\"]/g, '\\$&')}")`,
    backgroundSize: 'cover',
    backgroundPosition: 'center',
    backgroundRepeat: 'no-repeat',
    pointerEvents: 'none',
  });
  if (!existingBg) document.body.prepend(bgDiv);

  const styleEl = existingStyle || document.createElement('style');
  styleEl.id = 'dpp-bg-style';
  styleEl.textContent = `
    body.dpp-bg-active,
    body.dpp-bg-active #root,
    body.dpp-bg-active #__next {
      background: transparent !important;
    }

    body.dpp-bg-active #root > div,
    body.dpp-bg-active #__next > div {
      background: transparent !important;
    }

    body.dpp-bg-active #root > div > div,
    body.dpp-bg-active #__next > div > div {
      background: var(--dpp-overlay-light) !important;
      backdrop-filter: var(--dpp-blur) !important;
      -webkit-backdrop-filter: var(--dpp-blur) !important;
    }

    body.dpp-bg-active .ds-icon-button {
      background: transparent !important;
    }

    @media (prefers-color-scheme: dark) {
      body.dpp-bg-active #root > div > div,
      body.dpp-bg-active #__next > div > div {
        background: var(--dpp-overlay-dark) !important;
      }
    }
  `;
  if (!existingStyle) document.head.appendChild(styleEl);
}
