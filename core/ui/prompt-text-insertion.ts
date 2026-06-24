export type PromptTextInsertionResult =
  | { ok: true; insertedLength: number }
  | { ok: false; error: 'empty_prompt_text' | 'prompt_input_not_found' };

export function findPromptTextarea(root: ParentNode = document): HTMLTextAreaElement | null {
  const textarea = root.querySelector<HTMLTextAreaElement>('textarea#chat-input')
    ?? root.querySelector<HTMLTextAreaElement>('textarea');
  return textarea?.tagName === 'TEXTAREA' ? textarea : null;
}

export function insertTextIntoPromptTextarea(
  text: string,
  textarea: HTMLTextAreaElement | null = findPromptTextarea(),
): PromptTextInsertionResult {
  if (text.length === 0) return { ok: false, error: 'empty_prompt_text' };
  if (!textarea) return { ok: false, error: 'prompt_input_not_found' };

  const start = textarea.selectionStart ?? textarea.value.length;
  const end = textarea.selectionEnd ?? start;
  const nextValue = `${textarea.value.slice(0, start)}${text}${textarea.value.slice(end)}`;

  setTextareaValue(textarea, nextValue);
  const caret = start + text.length;
  textarea.selectionStart = textarea.selectionEnd = caret;
  textarea.dispatchEvent(createPromptInputEvent(text));
  textarea.dispatchEvent(new Event('change', { bubbles: true }));
  textarea.focus();

  return { ok: true, insertedLength: text.length };
}

function setTextareaValue(textarea: HTMLTextAreaElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
  if (setter) {
    setter.call(textarea, value);
    return;
  }
  textarea.value = value;
}

function createPromptInputEvent(text: string): Event {
  if (typeof InputEvent === 'function') {
    return new InputEvent('input', {
      bubbles: true,
      inputType: 'insertFromPaste',
      data: text,
    });
  }
  return new Event('input', { bubbles: true });
}
