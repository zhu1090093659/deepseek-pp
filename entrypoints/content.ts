import type { Memory, ModelType, Skill, SystemPromptPreset, ToolCall } from '../core/types';
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

    chrome.runtime.onMessage.addListener((message) => {
      if (message.type === 'STATE_UPDATED') {
        syncToMainWorld(message.memories, message.skills, message.activePreset, message.modelType);
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
    showMemoryBadge(payload.name);
  }
}

function showMemoryBadge(name: string) {
  const badge = document.createElement('div');
  badge.className = 'deepseek-pp-memory-badge';
  badge.textContent = `🧠 已记住: ${name}`;
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
