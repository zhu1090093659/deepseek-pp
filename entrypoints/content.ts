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

function removeBackground() {
  document.getElementById('dpp-bg')?.remove();
  document.getElementById('dpp-bg-style')?.remove();
  document.body.classList.remove('dpp-bg-active');
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

  const bgDiv = existingBg || document.createElement('div');
  bgDiv.id = 'dpp-bg';
  Object.assign(bgDiv.style, {
    position: 'fixed',
    inset: '0',
    zIndex: '-1',
    backgroundImage: `url("${imageUrl.replace(/[\\"]/g, '\\$&')}")`,
    backgroundSize: 'cover',
    backgroundPosition: 'center',
    backgroundRepeat: 'no-repeat',
    opacity: String(config.opacity),
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
      background: rgba(255, 255, 255, 0.82) !important;
      backdrop-filter: blur(16px) !important;
      -webkit-backdrop-filter: blur(16px) !important;
    }

    body.dpp-bg-active .ds-icon-button,
    body.dpp-bg-active header,
    body.dpp-bg-active nav {
      background: transparent !important;
    }

    @media (prefers-color-scheme: dark) {
      body.dpp-bg-active #root > div > div,
      body.dpp-bg-active #__next > div > div {
        background: rgba(30, 30, 30, 0.82) !important;
      }
    }
  `;
  if (!existingStyle) document.head.appendChild(styleEl);
}
