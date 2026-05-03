import type { BackgroundConfig, Memory, ModelType, Skill, SystemPromptPreset, ToolCall } from '../core/types';
import { DSML } from '../core/constants';
import { stripToolCalls } from '../core/interceptor/tool-parser';
import {
  DSML_HIDDEN_CLASS,
  TOOL_CARD_CLASS,
  autoCollapseToolCard,
  createToolCard,
  setToolCardResult,
  type ToolCardResult,
} from '../core/ui/tool-card';

const DSML_START = `<${DSML}tool_calls>`;
const DSML_END = `</${DSML}tool_calls>`;

const pendingCards: HTMLElement[] = [];

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
          finalizeResponse();
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
  const card = createToolCard(call);
  pendingCards.push(card);

  attemptPlacement();

  const result = await executeToolCall(call);
  setToolCardResult(card, result);
  autoCollapseToolCard(card, 2000);
}

async function executeToolCall(call: ToolCall): Promise<ToolCardResult> {
  try {
    if (call.name === 'memory_save') {
      const payload = call.payload as {
        type?: string;
        name?: string;
        content?: string;
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
      return { ok: true, summary: '已保存', detail: payload.name || '' };
    }

    if (call.name === 'memory_update') {
      const payload = call.payload as {
        id?: number;
        type?: string;
        name?: string;
        content?: string;
        tags?: string[];
      };
      const id = Number(payload.id);
      if (!id) return { ok: false, summary: '无效 ID' };
      const existing = await chrome.runtime.sendMessage({ type: 'GET_MEMORY_BY_ID', payload: { id } });
      if (!existing) return { ok: false, summary: '未找到记忆', detail: `ID ${id} 不存在` };
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
      return { ok: true, summary: '已更新', detail: payload.name || existing.name };
    }

    if (call.name === 'memory_delete') {
      const payload = call.payload as { id?: number };
      const id = Number(payload.id);
      if (!id) return { ok: false, summary: '无效 ID' };
      await chrome.runtime.sendMessage({ type: 'DELETE_MEMORY', payload: { id } });
      return { ok: true, summary: '已删除', detail: `#${id}` };
    }

    return { ok: true, summary: '已识别' };
  } catch (err) {
    return { ok: false, summary: '执行失败', detail: err instanceof Error ? err.message : String(err) };
  }
}

function finalizeResponse() {
  hideRawDSMLText();
  attemptPlacement();
  cleanRemainingDSML();
  pendingCards.length = 0;
}

function attemptPlacement() {
  for (let i = pendingCards.length - 1; i >= 0; i--) {
    if (placeCardForCall(pendingCards[i])) {
      pendingCards.splice(i, 1);
    }
  }
}

function placeCardForCall(card: HTMLElement): boolean {
  const topHidden = getTopLevelHiddenElements();
  if (topHidden.length === 0) return false;

  const startIdx = topHidden.findIndex((el) =>
    (el.textContent || '').includes(DSML_START),
  );
  if (startIdx === -1) return false;

  let endIdx = -1;
  for (let i = startIdx; i < topHidden.length; i++) {
    if ((topHidden[i].textContent || '').includes(DSML_END)) {
      endIdx = i;
      break;
    }
  }
  if (endIdx === -1) return false;

  const group = topHidden.slice(startIdx, endIdx + 1);
  const first = group[0];
  const parent = first.parentNode;
  if (!parent) return false;

  parent.insertBefore(card, first);
  for (const el of group) el.remove();
  return true;
}

function getTopLevelHiddenElements(): HTMLElement[] {
  const all = Array.from(document.querySelectorAll<HTMLElement>(`.${DSML_HIDDEN_CLASS}`));
  return all.filter((el) => !el.parentElement?.closest(`.${DSML_HIDDEN_CLASS}`));
}

function hideRawDSMLText() {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = (node as Text).parentElement;
      if (!parent) return NodeFilter.FILTER_REJECT;
      if (parent.closest(`.${DSML_HIDDEN_CLASS}`)) return NodeFilter.FILTER_REJECT;
      if (parent.closest(`.${TOOL_CARD_CLASS}`)) return NodeFilter.FILTER_REJECT;
      if (!(node.textContent || '').includes(DSML)) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  const targets: Text[] = [];
  let n: Node | null;
  while ((n = walker.nextNode())) targets.push(n as Text);

  for (const node of targets) hideContainingBlock(node);
}

function hideContainingBlock(node: Text) {
  const direct = node.parentElement;
  if (!direct) return;

  let target: HTMLElement = direct;
  while (target.parentElement && target.parentElement !== document.body) {
    if (!isOnlyMeaningfulChild(target, target.parentElement)) break;
    target = target.parentElement;
  }
  target.classList.add(DSML_HIDDEN_CLASS);
}

function isOnlyMeaningfulChild(child: HTMLElement, parent: HTMLElement): boolean {
  for (const sibling of parent.childNodes) {
    if (sibling === child) continue;
    if (sibling.nodeType === Node.TEXT_NODE) {
      if ((sibling.textContent || '').trim() !== '') return false;
    } else if (sibling.nodeType === Node.ELEMENT_NODE) {
      const el = sibling as HTMLElement;
      if (el.classList.contains(DSML_HIDDEN_CLASS)) continue;
      if (el.classList.contains(TOOL_CARD_CLASS)) continue;
      if ((el.textContent || '').trim() !== '') return false;
    }
  }
  return true;
}

function cleanRemainingDSML() {
  const hidden = Array.from(document.querySelectorAll<HTMLElement>(`.${DSML_HIDDEN_CLASS}`));
  for (const el of hidden) el.remove();

  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    if (node.parentElement?.closest(`.${TOOL_CARD_CLASS}`)) continue;
    const text = node.textContent || '';
    if (!text.includes(DSML)) continue;
    const cleaned = stripToolCalls(text);
    if (cleaned !== text) node.textContent = cleaned;
  }
}

function setupDOMObserver() {
  let patchTimer: ReturnType<typeof setTimeout> | null = null;
  let dsmlTimer: ReturnType<typeof setTimeout> | null = null;

  const scheduleDSMLProcess = () => {
    if (dsmlTimer) return;
    dsmlTimer = setTimeout(() => {
      dsmlTimer = null;
      hideRawDSMLText();
      attemptPlacement();
    }, 50);
  };

  const observer = new MutationObserver((mutations) => {
    let needsDSML = false;
    let needsPatch = false;

    for (const mutation of mutations) {
      if (mutation.type === 'characterData') {
        if ((mutation.target.textContent || '').includes(DSML)) needsDSML = true;
        continue;
      }
      for (const node of mutation.addedNodes) {
        if (node.nodeType === Node.ELEMENT_NODE) {
          needsPatch = true;
          const el = node as HTMLElement;
          if (el.classList?.contains(TOOL_CARD_CLASS) || el.classList?.contains(DSML_HIDDEN_CLASS)) continue;
          if ((el.textContent || '').includes(DSML)) needsDSML = true;
        } else if (node.nodeType === Node.TEXT_NODE) {
          if ((node.textContent || '').includes(DSML)) needsDSML = true;
        }
      }
    }

    if (needsDSML) scheduleDSMLProcess();

    if (needsPatch && document.body.classList.contains('dpp-bg-active')) {
      if (patchTimer) clearTimeout(patchTimer);
      patchTimer = setTimeout(() => {
        patchTimer = null;
        patchContainerBackgrounds();
      }, 200);
    }
  });

  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
}

function hasVisibleBackground(style: CSSStyleDeclaration): boolean {
  const bg = style.backgroundColor;
  const bgImg = style.backgroundImage;
  return (bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') ||
         (bgImg !== 'none' && bgImg !== '');
}

function patchContainerBackgrounds() {
  if (!document.body.classList.contains('dpp-bg-active')) return;
  const root = document.getElementById('root');
  if (!root) return;

  const textarea = document.querySelector('textarea');
  if (!textarea) return;

  let inputBox: Element | null = null;
  let el: Element | null = textarea.parentElement;
  while (el && el !== root) {
    const bg = getComputedStyle(el).backgroundColor;
    if (bg === 'rgb(255, 255, 255)' || bg === 'rgb(249, 250, 251)') {
      inputBox = el;
      break;
    }
    el = el.parentElement;
  }

  if (!inputBox) return;

  el = inputBox.parentElement;
  while (el && el !== root && el !== document.body) {
    const style = getComputedStyle(el);
    if (hasVisibleBackground(style)) {
      (el as HTMLElement).setAttribute('data-dpp-transparent', '');
    }

    if (style.position === 'sticky') {
      for (const child of el.children) {
        if (child.contains(textarea)) continue;
        if (hasVisibleBackground(getComputedStyle(child))) {
          (child as HTMLElement).setAttribute('data-dpp-transparent', '');
        }
      }
    }

    el = el.parentElement;
  }
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
    #dpp-bg::after {
      content: '';
      position: absolute;
      inset: 0;
      background: var(--dpp-overlay-light);
      backdrop-filter: var(--dpp-blur);
      -webkit-backdrop-filter: var(--dpp-blur);
      pointer-events: none;
    }

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
      background: transparent !important;
    }

    body.dpp-bg-active [data-dpp-transparent] {
      background: transparent !important;
    }

    @media (prefers-color-scheme: dark) {
      #dpp-bg::after {
        background: var(--dpp-overlay-dark);
      }
    }
  `;
  if (!existingStyle) document.head.appendChild(styleEl);

  patchContainerBackgrounds();
}
