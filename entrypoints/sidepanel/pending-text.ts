let pendingText: string | null = null;
let pendingConsumed = false;
let onNewText: ((text: string) => void) | null = null;

export function setPendingText(text: string) {
  pendingText = text;
  pendingConsumed = false;
  onNewText?.(text);
}

export function consumePendingText(): string | null {
  if (pendingConsumed || pendingText === null) return null;
  pendingConsumed = true;
  const text = pendingText;
  pendingText = null;
  return text;
}

export function onPendingText(cb: (text: string) => void) {
  onNewText = cb;
  return () => {
    onNewText = null;
  };
}
