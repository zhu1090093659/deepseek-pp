import { describe, expect, it, vi } from 'vitest';
import {
  findPromptTextarea,
  insertTextIntoPromptTextarea,
} from '../core/ui/prompt-text-insertion';

describe('prompt text insertion', () => {
  it('returns an explicit failure when the prompt textarea is missing', () => {
    document.body.innerHTML = '<main></main>';

    expect(insertTextIntoPromptTextarea('Prompt')).toEqual({
      ok: false,
      error: 'prompt_input_not_found',
    });
  });

  it('inserts text at the selection and dispatches input/change events', () => {
    document.body.innerHTML = '<textarea id="chat-input">Hello world</textarea>';
    const textarea = findPromptTextarea();
    expect(textarea).toBeInstanceOf(HTMLTextAreaElement);
    textarea!.selectionStart = 6;
    textarea!.selectionEnd = 11;
    const inputListener = vi.fn();
    const changeListener = vi.fn();
    textarea!.addEventListener('input', inputListener);
    textarea!.addEventListener('change', changeListener);

    const result = insertTextIntoPromptTextarea('DeepSeek', textarea);

    expect(result).toEqual({ ok: true, insertedLength: 8 });
    expect(textarea!.value).toBe('Hello DeepSeek');
    expect(textarea!.selectionStart).toBe(14);
    expect(textarea!.selectionEnd).toBe(14);
    expect(inputListener).toHaveBeenCalledTimes(1);
    expect(changeListener).toHaveBeenCalledTimes(1);
  });
});
