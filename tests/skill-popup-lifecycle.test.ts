import { afterEach, describe, expect, it, vi } from 'vitest';
import { initSkillPopup, stopSkillPopup } from '../core/ui/skill-popup';

describe('Skill popup lifecycle', () => {
  afterEach(() => {
    stopSkillPopup();
    document.body.innerHTML = '';
    document.head.querySelector('#dpp-skill-popup-css')?.remove();
    vi.restoreAllMocks();
  });

  it('installs resources once and removes them idempotently', () => {
    document.body.innerHTML = '<textarea id="chat-input"></textarea>';
    const addListener = vi.spyOn(document, 'addEventListener');
    const removeListener = vi.spyOn(document, 'removeEventListener');
    const disconnect = vi.spyOn(MutationObserver.prototype, 'disconnect');

    initSkillPopup([{ name: 'review', description: 'Review changes' }]);
    initSkillPopup([{ name: 'test', description: 'Run tests' }]);

    expect(addListener.mock.calls.filter(([type]) => type === 'keydown')).toHaveLength(1);
    expect(addListener.mock.calls.filter(([type]) => type === 'mousedown')).toHaveLength(1);
    expect(document.getElementById('dpp-skill-popup-css')).not.toBeNull();

    stopSkillPopup();
    stopSkillPopup();

    expect(removeListener.mock.calls.filter(([type]) => type === 'keydown')).toHaveLength(1);
    expect(removeListener.mock.calls.filter(([type]) => type === 'mousedown')).toHaveLength(1);
    expect(disconnect).toHaveBeenCalledOnce();
    expect(document.querySelector('.dpp-skill-popup')).toBeNull();
    expect(document.getElementById('dpp-skill-popup-css')).toBeNull();
  });

  it('can restart cleanly after teardown', () => {
    document.body.innerHTML = '<textarea id="chat-input"></textarea>';
    const textarea = document.querySelector<HTMLTextAreaElement>('#chat-input')!;

    initSkillPopup([{ name: 'review', description: 'Review changes' }]);
    textarea.value = '/';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    expect(document.querySelector('.dpp-skill-popup')).not.toBeNull();

    stopSkillPopup();
    initSkillPopup([{ name: 'test', description: 'Run tests' }]);
    textarea.value = '/t';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));

    expect(document.querySelector('.dpp-skill-trigger')?.textContent).toBe('/test');
  });
});
