let pendingText: string | null = null;
let pendingConsumed = false;

export function setPendingText(text: string) {
  pendingText = text;
  pendingConsumed = false;
}

export function consumePendingText(): string | null {
  if (pendingConsumed || pendingText === null) return null;
  pendingConsumed = true;
  const text = pendingText;
  pendingText = null;
  return text;
}
