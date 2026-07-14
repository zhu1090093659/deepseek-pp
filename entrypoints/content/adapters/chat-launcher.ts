import { getFloatingChatEnabled } from '../../../core/floating-chat/store';
import { resolveFloatingChatRuntimeState } from '../../../core/floating-chat/runtime-state';
import { isExtensionContextInvalidatedError } from '../../../core/platform/chrome-api';

export interface ChatLauncherController {
  stop(): void;
}

const STYLE_ID = 'dpp-chat-launcher-css';
const BUTTON_ID = 'dpp-chat-launcher-button';
const WINDOW_ID = 'dpp-floating-chat-window';
const SIDE_PANEL_PATH = 'sidepanel.html?surface=floating-chat';
const STORAGE_KEY = 'deepseek_pp_floating_chat_enabled';
const PET_SPRITE_PATH = 'pet/deepseek-whale-pet-states.png';
const OWNER_ATTRIBUTE = 'data-dpp-chat-launcher-owner';
// Pointer must move farther than this (px) to count as a drag instead of a click.
const DRAG_THRESHOLD = 6;

let dragState: {
  ownerId: string;
  isDragging: boolean;
  startX: number;
  startY: number;
  startRight: number;
  startBottom: number;
} | null = null;
let activeLauncherStop: (() => void) | null = null;

type HostTheme = 'light' | 'dark';

export function startChatLauncher(): ChatLauncherController {
  activeLauncherStop?.();
  removeButton();
  removeWindow();
  stopActiveDrag();

  // Bail out cleanly if the document isn't ready for injection. document_idle
  // should guarantee a body, but defending here avoids a null-deref crash on
  // the first addEventListener if the script runs earlier than expected.
  if (!document.body) {
    return { stop() {} };
  }

  const ownerId = createOwnerId();
  let spriteUrl: string;
  let floatingChatUrl: string;
  try {
    // Resolve extension URLs while the content-script context is known to be
    // alive. A content script can outlive an extension reload, so event handlers
    // must not touch chrome.runtime later when the user clicks the launcher.
    spriteUrl = chrome.runtime.getURL(PET_SPRITE_PATH);
    floatingChatUrl = chrome.runtime.getURL(SIDE_PANEL_PATH);
  } catch (error) {
    if (isExtensionContextInvalidatedError(error)) return { stop() {} };
    throw error;
  }

  injectStyles();
  const button = ensureButton(spriteUrl, ownerId);

  // Pointer state — a press only becomes a drag once the pointer moves past
  // DRAG_THRESHOLD. This avoids swallowing clicks that take longer than the
  // old 100ms long-press timer (slow clicks, trackpads, accessibility tools).
  let pressing = false;
  let movedPastThreshold = false;
  let pressStartX = 0;
  let pressStartY = 0;
  let startRight = 0;
  let startBottom = 0;

  const onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    pressing = true;
    movedPastThreshold = false;
    pressStartX = e.clientX;
    pressStartY = e.clientY;
    const rect = button.getBoundingClientRect();
    startRight = window.innerWidth - rect.right;
    startBottom = window.innerHeight - rect.bottom;
    // Capture so we keep getting move/up even if the pointer leaves the button.
    try { button.setPointerCapture(e.pointerId); } catch { /* ignore */ }
  };

  const onPointerMove = (e: PointerEvent) => {
    if (!pressing) return;
    const dx = e.clientX - pressStartX;
    const dy = e.clientY - pressStartY;
    if (!movedPastThreshold && Math.hypot(dx, dy) > DRAG_THRESHOLD) {
      movedPastThreshold = true;
      button.style.cursor = 'grabbing';
    }
    if (!movedPastThreshold) return;
    const newRight = Math.max(0, startRight - dx);
    const newBottom = Math.max(0, startBottom - dy);
    const maxRight = window.innerWidth - button.offsetWidth;
    const maxBottom = window.innerHeight - button.offsetHeight;
    button.style.right = `${Math.min(newRight, maxRight)}px`;
    button.style.bottom = `${Math.min(newBottom, maxBottom)}px`;
    button.style.top = 'auto';
    button.style.left = 'auto';
  };

  const onPointerUp = (e: PointerEvent) => {
    if (!pressing) return;
    pressing = false;
    try { button.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    button.style.cursor = 'pointer';
    if (!movedPastThreshold) {
      // It was a click, not a drag — toggle the chat window.
      e.preventDefault();
      toggleFloatingWindow(floatingChatUrl, ownerId);
    }
  };

  button.addEventListener('pointerdown', onPointerDown);
  button.addEventListener('pointermove', onPointerMove);
  button.addEventListener('pointerup', onPointerUp);
  button.addEventListener('pointercancel', onPointerUp);

  let disposed = false;
  const themeObserver = new MutationObserver(() => syncWindowTheme(ownerId));
  const onStorageChanged = (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => {
    if (areaName !== 'local') return;
    if (STORAGE_KEY in changes) void renderFromStorage();
  };
  const renderFromStorage = async () => {
    const state = await resolveFloatingChatRuntimeState({
      readEnabled: getFloatingChatEnabled,
      // Reaching this declared content script proves the page host permission.
      hasHostPermission: async () => true,
      isContextInvalidated: isExtensionContextInvalidatedError,
    });
    if (disposed) return;
    if (state.kind === 'invalidated') {
      stop();
      return;
    }
    renderLauncher(state.kind === 'ready', ownerId);
  };

  const stop = () => {
    if (disposed) return;
    disposed = true;
    button.removeEventListener('pointerdown', onPointerDown);
    button.removeEventListener('pointermove', onPointerMove);
    button.removeEventListener('pointerup', onPointerUp);
    button.removeEventListener('pointercancel', onPointerUp);
    try {
      chrome.storage?.onChanged?.removeListener(onStorageChanged);
    } catch (error) {
      if (!isExtensionContextInvalidatedError(error)) throw error;
    }
    themeObserver.disconnect();
    stopActiveDrag(ownerId);
    removeButton(ownerId);
    removeWindow(ownerId);
    if (activeLauncherStop === stop) activeLauncherStop = null;
  };

  try {
    chrome.storage?.onChanged?.addListener(onStorageChanged);
  } catch (error) {
    if (!isExtensionContextInvalidatedError(error)) throw error;
    stop();
    return { stop };
  }
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-dpp-theme'] });
  void renderFromStorage();

  activeLauncherStop = stop;
  return { stop };
}

function renderLauncher(enabled: boolean, ownerId: string): void {
  const button = document.getElementById(BUTTON_ID) as HTMLButtonElement | null;
  if (!button || button.getAttribute(OWNER_ATTRIBUTE) !== ownerId) return;
  button.style.display = enabled ? '' : 'none';
  button.title = 'Open DS++ Chat';
  button.setAttribute('aria-label', 'Open DS++ Chat');
}

function ensureButton(spriteUrl: string, ownerId: string): HTMLButtonElement {
  const button = document.createElement('button');
  button.id = BUTTON_ID;
  button.setAttribute(OWNER_ATTRIBUTE, ownerId);
  button.type = 'button';
  button.style.display = 'none';
  button.innerHTML = createWhaleMarkup(spriteUrl);
  document.body!.appendChild(button);
  return button;
}

function removeButton(ownerId?: string): void {
  const button = document.getElementById(BUTTON_ID);
  if (!button || (ownerId && button.getAttribute(OWNER_ATTRIBUTE) !== ownerId)) return;
  button.remove();
}

function toggleFloatingWindow(floatingChatUrl: string, ownerId: string): void {
  const existing = document.getElementById(WINDOW_ID);
  if (existing) {
    existing.remove();
    return;
  }
  if (!document.body) return;
  const panel = document.createElement('section');
  panel.id = WINDOW_ID;
  panel.setAttribute(OWNER_ATTRIBUTE, ownerId);
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'DeepSeek++ Chat');
  applyWindowTheme(panel);
  const frameSrc = `${floatingChatUrl}&hostTheme=${getHostTheme()}`;
  panel.innerHTML =
    `<div class="dpp-floating-chat__header" data-dpp-drag-handle>`
    + `<span class="dpp-floating-chat__title">DS++ Chat</span>`
    + `<button class="dpp-floating-chat__close" type="button" data-dpp-floating-chat-close aria-label="Close">×</button>`
    + `</div>`
    + `<iframe class="dpp-floating-chat__frame" title="DS++ Chat" src="${frameSrc}"></iframe>`;
  panel.querySelector('[data-dpp-floating-chat-close]')?.addEventListener('click', () => panel.remove());
  const dragHandle = panel.querySelector('[data-dpp-drag-handle]') as HTMLElement | null;
  dragHandle?.addEventListener('pointerdown', (e) => startDrag(e, panel, ownerId));
  document.body.appendChild(panel);
}

function startDrag(e: PointerEvent, panel: HTMLElement, ownerId: string): void {
  // Interactive controls inside the header own their pointer sequence. Starting
  // a drag here would prevent their click and move pointer capture to the header.
  if (e.button !== 0) return;
  if (isInteractiveDragTarget(e.target)) return;
  e.preventDefault();
  try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* ignore */ }
  const rect = panel.getBoundingClientRect();
  dragState = {
    ownerId,
    isDragging: true,
    startX: e.clientX,
    startY: e.clientY,
    startRight: window.innerWidth - rect.right,
    startBottom: window.innerHeight - rect.bottom,
  };
  panel.classList.add('dpp-floating-chat--dragging');
  document.body.classList.add('dpp-floating-chat-dragging');
  document.addEventListener('pointermove', onDrag);
  document.addEventListener('pointerup', stopDrag);
  document.addEventListener('pointercancel', stopDrag);
}

function isInteractiveDragTarget(target: EventTarget | null): boolean {
  return target instanceof Element
    && target.closest('button, a, input, textarea, select, [role="button"]') !== null;
}

function onDrag(e: PointerEvent): void {
  if (!dragState?.isDragging) return;
  const panel = document.getElementById(WINDOW_ID);
  if (!panel || panel.getAttribute(OWNER_ATTRIBUTE) !== dragState.ownerId) {
    stopActiveDrag(dragState.ownerId);
    return;
  }
  const deltaX = e.clientX - dragState.startX;
  const deltaY = e.clientY - dragState.startY;
  const newRight = Math.max(0, dragState.startRight - deltaX);
  const newBottom = Math.max(0, dragState.startBottom - deltaY);
  panel.style.right = `${Math.min(newRight, window.innerWidth - panel.offsetWidth)}px`;
  panel.style.bottom = `${Math.min(newBottom, window.innerHeight - panel.offsetHeight)}px`;
}

function stopDrag(): void {
  stopActiveDrag();
}

function stopActiveDrag(ownerId?: string): void {
  if (ownerId && dragState?.ownerId !== ownerId) return;
  const panel = document.getElementById(WINDOW_ID);
  if (!ownerId || panel?.getAttribute(OWNER_ATTRIBUTE) === ownerId) {
    panel?.classList.remove('dpp-floating-chat--dragging');
  }
  document.body.classList.remove('dpp-floating-chat-dragging');
  dragState = null;
  document.removeEventListener('pointermove', onDrag);
  document.removeEventListener('pointerup', stopDrag);
  document.removeEventListener('pointercancel', stopDrag);
}

function removeWindow(ownerId?: string): void {
  const panel = document.getElementById(WINDOW_ID);
  if (!panel || (ownerId && panel.getAttribute(OWNER_ATTRIBUTE) !== ownerId)) return;
  panel.remove();
}

function syncWindowTheme(ownerId: string): void {
  const panel = document.getElementById(WINDOW_ID);
  if (!panel || panel.getAttribute(OWNER_ATTRIBUTE) !== ownerId) return;
  applyWindowTheme(panel);
}

function applyWindowTheme(panel: HTMLElement): void {
  const theme = getHostTheme();
  panel.dataset.hostTheme = theme;
  panel.classList.toggle('dpp-floating-chat--dark', theme === 'dark');
}

function getHostTheme(): HostTheme {
  const root = document.documentElement;
  if (root.classList.contains('dpp-theme-dark') || root.dataset.dppTheme === 'dark') return 'dark';
  return 'light';
}

// The button reuses the whale pet sprite sheet (pet/deepseek-whale-pet-states.png,
// a 4x2 grid) and shows the "thinking" frame as its resting pose.
function createWhaleMarkup(spriteUrl: string): string {
  return `<span class="dpp-chat-launcher__whale" style="background-image:url('${spriteUrl}')"></span>`;
}

function createOwnerId(): string {
  return `launcher-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function injectStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  if (!document.head) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
#${BUTTON_ID} {
  position: fixed;
  right: 22px;
  bottom: max(22px, env(safe-area-inset-bottom));
  z-index: 2147483646;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  padding: 0;
  border: 0;
  border-radius: 999px;
  outline: none;
  background: rgba(255,255,255,0.82);
  box-shadow: 0 14px 34px rgba(15,23,42,0.18), inset 0 1px 0 rgba(255,255,255,0.75);
  backdrop-filter: blur(18px) saturate(1.2);
  -webkit-backdrop-filter: blur(18px) saturate(1.2);
  cursor: pointer;
  transition: transform 0.12s ease;
  touch-action: none;
}
#${BUTTON_ID}:hover { transform: scale(1.06); }
#${BUTTON_ID}:active { transform: scale(0.98); }
html.dpp-theme-dark #${BUTTON_ID}, [data-dpp-theme="dark"] #${BUTTON_ID} {
  background: rgba(17,21,29,0.48);
  box-shadow: 0 18px 46px rgba(0,0,0,0.38), inset 0 1px 0 rgba(255,255,255,0.08);
}
#${BUTTON_ID} .dpp-chat-launcher__whale {
  display: block;
  width: 32px;
  height: 32px;
  background-repeat: no-repeat;
  background-size: 400% 200%;
  /* "thinking" frame of the 4x2 sprite sheet */
  background-position: 33.3333% 0%;
  pointer-events: none;
}

#${WINDOW_ID} {
  position: fixed;
  right: 22px;
  bottom: 80px;
  z-index: 2147483645;
  width: min(430px, calc(100vw - 28px));
  height: min(720px, calc(100vh - 100px));
  border: 1px solid rgba(0,0,0,0.08);
  border-radius: 18px;
  overflow: hidden;
  background: rgba(250,250,250,0.86);
  box-shadow: 0 24px 60px rgba(15,23,42,0.18);
  animation: dpp-floating-chat-in 170ms ease;
  display: flex;
  flex-direction: column;
}
#${WINDOW_ID}.dpp-floating-chat--dark {
  border-color: rgba(148,163,184,0.22);
  background: rgba(7,9,13,0.42);
  box-shadow: 0 28px 82px rgba(0,0,0,0.52), inset 0 1px 0 rgba(255,255,255,0.06);
  backdrop-filter: blur(30px) saturate(1.18);
  -webkit-backdrop-filter: blur(30px) saturate(1.18);
}
#${WINDOW_ID} .dpp-floating-chat__frame {
  width: 100%;
  flex: 1;
  min-height: 0;
  border: 0;
  background: transparent;
}
#${WINDOW_ID} .dpp-floating-chat__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  background: rgba(255,255,255,0.95);
  border-bottom: 1px solid rgba(0,0,0,0.06);
  cursor: move;
  user-select: none;
  touch-action: none;
  flex-shrink: 0;
}
#${WINDOW_ID}.dpp-floating-chat--dark .dpp-floating-chat__header {
  background: rgba(17,21,29,0.95);
  border-bottom-color: rgba(148,163,184,0.18);
}
#${WINDOW_ID} .dpp-floating-chat__title {
  font: 700 13px/1.4 'Inter', 'PingFang SC', -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif;
  color: #4d6bfe;
}
#${WINDOW_ID}.dpp-floating-chat--dark .dpp-floating-chat__title { color: #7b93ff; }
#${WINDOW_ID} .dpp-floating-chat__close {
  width: 20px;
  height: 20px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: #9ca3af;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  line-height: 1;
}
#${WINDOW_ID} .dpp-floating-chat__close:hover { background: rgba(0,0,0,0.06); color: #374151; }
#${WINDOW_ID}.dpp-floating-chat--dark .dpp-floating-chat__close { color: #9ca3af; }
#${WINDOW_ID}.dpp-floating-chat--dark .dpp-floating-chat__close:hover { background: rgba(255,255,255,0.08); color: #e5e7eb; }
#${WINDOW_ID}.dpp-floating-chat--dragging { transition: none !important; user-select: none; }
#${WINDOW_ID}.dpp-floating-chat--dragging .dpp-floating-chat__frame { pointer-events: none; }
body.dpp-floating-chat-dragging { cursor: move !important; }
body.dpp-floating-chat-dragging * { cursor: move !important; }

@keyframes dpp-floating-chat-in {
  from { opacity: 0; transform: translateY(8px) scale(0.98); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}
@media (max-width: 640px) {
  #${WINDOW_ID} {
    right: 14px;
    bottom: 74px;
    width: calc(100vw - 28px);
    height: min(680px, calc(100vh - 100px));
  }
}
`;
  document.head.appendChild(style);
}
