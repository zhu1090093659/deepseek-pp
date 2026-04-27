import type { Skill } from '../types';

let popupEl: HTMLElement | null = null;
let skills: Skill[] = [];
let filtered: Skill[] = [];
let activeIdx = 0;
let textarea: HTMLTextAreaElement | null = null;

export function initSkillPopup(initialSkills: Skill[]) {
  skills = initialSkills;
  injectStyles();
  watchTextarea();
  document.addEventListener('keydown', onKeydown, true);
  document.addEventListener('mousedown', onClickOutside);
}

export function updatePopupSkills(newSkills: Skill[]) {
  skills = newSkills;
}

function watchTextarea() {
  tryAttach();
  new MutationObserver(() => {
    if (!textarea || !document.contains(textarea)) {
      textarea = null;
      tryAttach();
    }
  }).observe(document.body, { childList: true, subtree: true });
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
      : skills.filter(s =>
          s.name.toLowerCase().startsWith(query)
          || s.trigger.slice(1).toLowerCase().startsWith(query)
        );
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

function selectSkill(skill: Skill) {
  if (!textarea || !skill) return;

  const newVal = skill.trigger + ' ';

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
    width: `${Math.min(rect.width, 420)}px`,
  });

  buildItems();
}

function buildItems() {
  if (!popupEl) return;

  popupEl.innerHTML = filtered.map((s, i) => `
    <div class="dpp-skill-item${i === activeIdx ? ' dpp-active' : ''}" data-i="${i}">
      <div class="dpp-skill-head">
        <code class="dpp-skill-trigger">${escapeHtml(s.trigger)}</code>
        <span class="dpp-skill-name">${escapeHtml(s.name)}</span>
      </div>
      <div class="dpp-skill-desc">${escapeHtml(s.description)}</div>
    </div>
  `).join('')
    + '<div class="dpp-skill-hint">↑↓ 导航 · Enter 选择 · Esc 关闭</div>';

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
.dpp-skill-popup {
  position: fixed;
  z-index: 99999;
  background: #1e293b;
  border: 1px solid #334155;
  border-radius: 12px;
  padding: 4px;
  box-shadow: 0 4px 24px rgba(0,0,0,0.5);
  display: none;
  animation: dpp-slide-up .15s ease;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
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
  background: #334155;
}
.dpp-skill-head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.dpp-skill-trigger {
  color: #34d399;
  font-size: 13px;
  font-family: 'SF Mono', Monaco, Consolas, monospace;
  font-weight: 600;
}
.dpp-skill-name {
  color: #e2e8f0;
  font-size: 13px;
}
.dpp-skill-desc {
  color: #94a3b8;
  font-size: 11px;
  margin-top: 2px;
}
.dpp-skill-hint {
  text-align: center;
  color: #475569;
  font-size: 10px;
  padding: 4px 0 2px;
  border-top: 1px solid #334155;
  margin-top: 4px;
}
`;
  document.head.appendChild(style);
}
