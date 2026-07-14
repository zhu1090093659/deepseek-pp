export interface SkillPopupItem {
  name: string;
  description: string;
}

export interface SkillPopupCopy {
  hint: string;
}

const DEFAULT_COPY: SkillPopupCopy = {
  hint: '↑↓ Navigate · Enter Select · Esc Close',
};

let popupEl: HTMLElement | null = null;
let skills: SkillPopupItem[] = [];
let filtered: SkillPopupItem[] = [];
let activeIdx = 0;
let textarea: HTMLTextAreaElement | null = null;
let copy: SkillPopupCopy = DEFAULT_COPY;
let textareaObserver: MutationObserver | null = null;

let initialized = false;

export function initSkillPopup(initialSkills: SkillPopupItem[], nextCopy: Partial<SkillPopupCopy> = {}) {
  skills = initialSkills;
  copy = { ...DEFAULT_COPY, ...nextCopy };
  if (isVisible()) buildItems();
  if (initialized) return;
  initialized = true;
  injectStyles();
  watchTextarea();
  document.addEventListener('keydown', onKeydown, true);
  document.addEventListener('mousedown', onClickOutside);
}

export function stopSkillPopup() {
  if (!initialized) return;
  initialized = false;
  textareaObserver?.disconnect();
  textareaObserver = null;
  textarea?.removeEventListener('input', onInput);
  textarea = null;
  document.removeEventListener('keydown', onKeydown, true);
  document.removeEventListener('mousedown', onClickOutside);
  popupEl?.remove();
  popupEl = null;
  document.getElementById('dpp-skill-popup-css')?.remove();
  skills = [];
  filtered = [];
  activeIdx = 0;
  copy = DEFAULT_COPY;
}

function watchTextarea() {
  tryAttach();
  textareaObserver?.disconnect();
  textareaObserver = new MutationObserver(() => {
    if (!textarea || !document.contains(textarea)) {
      textarea?.removeEventListener('input', onInput);
      textarea = null;
      tryAttach();
    }
  });
  textareaObserver.observe(document.body, { childList: true, subtree: true });
}

function tryAttach() {
  if (textarea) return;
  const el = document.querySelector<HTMLTextAreaElement>('textarea#chat-input')
    || document.querySelector<HTMLTextAreaElement>('textarea');
  if (!el) return;
  textarea = el;
  el.addEventListener('input', onInput);
}

function onInput() {
  if (!textarea) return;
  const val = textarea.value;

  if (val.startsWith('/') && !val.slice(1).includes(' ')) {
    const query = val.slice(1).toLowerCase();
    filtered = query === ''
      ? [...skills]
      : skills.filter(s => s.name.toLowerCase().startsWith(query));
    if (filtered.length > 0) {
      activeIdx = 0;
      showPopup();
      return;
    }
  }
  hidePopup();
}

function onKeydown(e: KeyboardEvent) {
  if (!isVisible()) return;

  switch (e.key) {
    case 'ArrowDown':
      e.preventDefault();
      e.stopImmediatePropagation();
      activeIdx = (activeIdx + 1) % filtered.length;
      highlightActive();
      break;
    case 'ArrowUp':
      e.preventDefault();
      e.stopImmediatePropagation();
      activeIdx = (activeIdx - 1 + filtered.length) % filtered.length;
      highlightActive();
      break;
    case 'Tab':
    case 'Enter':
      e.preventDefault();
      e.stopImmediatePropagation();
      selectSkill(filtered[activeIdx]);
      break;
    case 'Escape':
      e.preventDefault();
      e.stopImmediatePropagation();
      hidePopup();
      break;
  }
}

function onClickOutside(e: MouseEvent) {
  if (!isVisible()) return;
  if (popupEl?.contains(e.target as Node)) return;
  if (e.target === textarea) return;
  hidePopup();
}

function selectSkill(skill: SkillPopupItem) {
  if (!textarea || !skill) return;

  const newVal = `/${skill.name} `;

  // Invalidate React's value tracker so it detects the change
  const tracker = (textarea as any)._valueTracker;
  if (tracker) tracker.setValue('');

  const nativeSetter = Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype, 'value',
  )?.set;
  if (nativeSetter) {
    nativeSetter.call(textarea, newVal);
  } else {
    textarea.value = newVal;
  }

  textarea.dispatchEvent(new Event('input', { bubbles: true }));
  textarea.focus();
  textarea.setSelectionRange(newVal.length, newVal.length);
  hidePopup();
}

function showPopup() {
  if (!textarea) return;

  if (!popupEl) {
    popupEl = document.createElement('div');
    popupEl.className = 'dpp-skill-popup';
    document.body.appendChild(popupEl);
  }

  const rect = textarea.getBoundingClientRect();
  Object.assign(popupEl.style, {
    display: 'block',
    left: `${rect.left}px`,
    bottom: `${window.innerHeight - rect.top + 6}px`,
    width: `${Math.min(rect.width * 0.5, 280)}px`,
  });

  buildItems();
}

function buildItems() {
  if (!popupEl) return;

  popupEl.innerHTML = filtered.map((s, i) => `
    <div class="dpp-skill-item${i === activeIdx ? ' dpp-active' : ''}" data-i="${i}">
      <div class="dpp-skill-head">
        <code class="dpp-skill-trigger">/${escapeHtml(s.name)}</code>
      </div>
      <div class="dpp-skill-desc">${escapeHtml(s.description)}</div>
    </div>
  `).join('')
    + `<div class="dpp-skill-hint">${escapeHtml(copy.hint)}</div>`;

  popupEl.querySelectorAll('.dpp-skill-item').forEach(el => {
    const i = parseInt((el as HTMLElement).dataset.i || '0');
    el.addEventListener('mouseenter', () => {
      activeIdx = i;
      highlightActive();
    });
    el.addEventListener('mousedown', (e) => {
      e.preventDefault();
      selectSkill(filtered[i]);
    });
  });
}

function highlightActive() {
  if (!popupEl) return;
  popupEl.querySelectorAll('.dpp-skill-item').forEach((el, i) => {
    el.classList.toggle('dpp-active', i === activeIdx);
    if (i === activeIdx) el.scrollIntoView({ block: 'nearest' });
  });
}

function hidePopup() {
  if (popupEl) popupEl.style.display = 'none';
}

function isVisible() {
  return popupEl !== null && popupEl.style.display !== 'none';
}

function escapeHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function injectStyles() {
  if (document.getElementById('dpp-skill-popup-css')) return;
  const style = document.createElement('style');
  style.id = 'dpp-skill-popup-css';
  style.textContent = `
:root {
  --dpp-skill-popup-bg: var(--dpp-ui-surface, oklch(0.998 0.002 264));
  --dpp-skill-popup-surface: var(--dpp-ui-surface-muted, oklch(0.965 0.005 264));
  --dpp-skill-popup-border: var(--dpp-ui-border, oklch(0.90 0.008 264));
  --dpp-skill-popup-divider: var(--dpp-ui-border-muted, oklch(0.94 0.006 264));
  --dpp-skill-popup-trigger-bg: var(--dpp-ui-accent-soft, oklch(0.96 0.025 264));
  --dpp-skill-popup-trigger: var(--dpp-ui-accent, oklch(0.62 0.19 264));
  --dpp-skill-popup-desc: var(--dpp-ui-text-subtle, oklch(0.70 0.015 264));
  --dpp-skill-popup-hint: var(--dpp-ui-border-hover, oklch(0.84 0.012 264));
  --dpp-skill-popup-shadow: var(--dpp-ui-panel-shadow, -14px 0 40px oklch(0.25 0.04 264 / 0.14));
}
body.dpp-theme-dark {
  --dpp-skill-popup-bg: var(--dpp-ui-surface);
  --dpp-skill-popup-surface: var(--dpp-ui-surface-muted);
  --dpp-skill-popup-border: var(--dpp-ui-border);
  --dpp-skill-popup-divider: var(--dpp-ui-border-muted);
  --dpp-skill-popup-trigger-bg: var(--dpp-ui-accent-soft);
  --dpp-skill-popup-trigger: var(--dpp-ui-accent);
  --dpp-skill-popup-desc: var(--dpp-ui-text-subtle);
  --dpp-skill-popup-hint: var(--dpp-ui-border-hover);
  --dpp-skill-popup-shadow: var(--dpp-ui-panel-shadow);
}
@media (prefers-color-scheme: dark) {
  body:not(.dpp-theme-light) {
    --dpp-skill-popup-bg: var(--dpp-ui-surface);
    --dpp-skill-popup-surface: var(--dpp-ui-surface-muted);
    --dpp-skill-popup-border: var(--dpp-ui-border);
    --dpp-skill-popup-divider: var(--dpp-ui-border-muted);
    --dpp-skill-popup-trigger-bg: var(--dpp-ui-accent-soft);
    --dpp-skill-popup-trigger: var(--dpp-ui-accent);
    --dpp-skill-popup-desc: var(--dpp-ui-text-subtle);
    --dpp-skill-popup-hint: var(--dpp-ui-border-hover);
    --dpp-skill-popup-shadow: var(--dpp-ui-panel-shadow);
  }
}
.dpp-skill-popup {
  position: fixed;
  z-index: 99999;
  background: var(--dpp-skill-popup-bg);
  border: 1px solid var(--dpp-skill-popup-border);
  border-radius: 12px;
  padding: 4px;
  box-shadow: var(--dpp-skill-popup-shadow);
  display: none;
  animation: dpp-slide-up .15s ease;
  font-family: -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Segoe UI', sans-serif;
  backdrop-filter: blur(8px);
  max-height: 220px;
  overflow-y: auto;
  overscroll-behavior: contain;
}
@keyframes dpp-slide-up {
  from { opacity: 0; transform: translateY(4px); }
  to   { opacity: 1; transform: translateY(0); }
}
.dpp-skill-item {
  padding: 8px 12px;
  border-radius: 8px;
  cursor: pointer;
  transition: background .1s;
}
.dpp-skill-item.dpp-active {
  background: var(--dpp-skill-popup-surface);
}
.dpp-skill-head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.dpp-skill-trigger {
  color: var(--dpp-skill-popup-trigger);
  font-size: 13px;
  font-family: 'SF Mono', Monaco, Consolas, monospace;
  font-weight: 600;
  background: var(--dpp-skill-popup-trigger-bg);
  padding: 1px 6px;
  border-radius: 4px;
}
.dpp-skill-desc {
  color: var(--dpp-skill-popup-desc);
  font-size: 11px;
  margin-top: 2px;
}
.dpp-skill-hint {
  text-align: center;
  color: var(--dpp-skill-popup-hint);
  font-size: 10px;
  padding: 4px 0 2px;
  border-top: 1px solid var(--dpp-skill-popup-divider);
  margin-top: 4px;
}
`;
  document.head.appendChild(style);
}
