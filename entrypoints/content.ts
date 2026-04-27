import type { Memory, Skill, ToolCall } from '../core/types';

export default defineContentScript({
  matches: ['*://chat.deepseek.com/*'],
  runAt: 'document_start',
  async main() {
    injectMainWorldScript();

    await new Promise((r) => {
      if (document.readyState === 'complete' || document.readyState === 'interactive') r(undefined);
      else document.addEventListener('DOMContentLoaded', () => r(undefined), { once: true });
    });

    const memories: Memory[] = (await chrome.runtime.sendMessage({ type: 'GET_MEMORIES' })) ?? [];
    const skills: Skill[] = (await chrome.runtime.sendMessage({ type: 'GET_SKILLS' })) ?? [];

    syncToMainWorld(memories, skills);

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
        syncToMainWorld(message.memories, message.skills);
      }
    });

    setupDOMObserver();
  },
});

function syncToMainWorld(memories: Memory[], skills: Skill[]) {
  window.postMessage({
    source: 'deepseek-pp-content',
    type: 'SYNC_STATE',
    memories,
    skills,
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
  const toRemove: { node: Text; start: number; end: number }[] = [];

  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    const text = node.textContent || '';
    const regex = /<tool_call\s+name="[^"]*">[\s\S]*?<\/tool_call>/g;
    let match;
    while ((match = regex.exec(text)) !== null) {
      toRemove.push({ node, start: match.index, end: match.index + match[0].length });
    }
  }

  for (const { node, start, end } of toRemove.reverse()) {
    const text = node.textContent || '';
    node.textContent = text.slice(0, start) + text.slice(end);
  }
}

function injectMainWorldScript() {
  const script = document.createElement('script');
  script.src = chrome.runtime.getURL('/injected.js');
  script.onload = () => script.remove();
  (document.head || document.documentElement).appendChild(script);
}

function setupDOMObserver() {
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType === Node.ELEMENT_NODE) {
          const el = node as HTMLElement;
          const text = el.textContent || '';
          if (text.includes('<tool_call')) {
            setTimeout(cleanToolCallsFromDOM, 100);
          }
        }
      }
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });
}
