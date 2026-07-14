export const PENDING_CHAT_TEXT_STORAGE_KEY = 'pendingChatText';

export interface PendingChatTextStore {
  read(): Promise<string | null>;
  write(text: string): Promise<void>;
  clear(): Promise<void>;
  subscribe(
    listener: (text: string | null) => void,
    onError: (error: unknown) => void,
  ): () => void;
}

export function decodePendingChatText(value: unknown, path: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${path} must be a non-empty string.`);
  }
  return value;
}

export const pendingChatTextStore: PendingChatTextStore = Object.freeze({
  async read() {
    const data = await chrome.storage.local.get(PENDING_CHAT_TEXT_STORAGE_KEY) as Record<string, unknown>;
    return decodePendingChatText(
      data[PENDING_CHAT_TEXT_STORAGE_KEY],
      `storage.${PENDING_CHAT_TEXT_STORAGE_KEY}`,
    );
  },
  async write(text: string) {
    const value = decodePendingChatText(text, PENDING_CHAT_TEXT_STORAGE_KEY);
    if (value === null) throw new Error(`${PENDING_CHAT_TEXT_STORAGE_KEY} is required.`);
    await chrome.storage.local.set({ [PENDING_CHAT_TEXT_STORAGE_KEY]: value });
  },
  async clear() {
    await chrome.storage.local.remove(PENDING_CHAT_TEXT_STORAGE_KEY);
  },
  subscribe(
    listener: (text: string | null) => void,
    onError: (error: unknown) => void,
  ) {
    const handleChange = (
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: string,
    ) => {
      if (areaName !== 'local' || !(PENDING_CHAT_TEXT_STORAGE_KEY in changes)) return;
      try {
        listener(decodePendingChatText(
          changes[PENDING_CHAT_TEXT_STORAGE_KEY].newValue,
          `storage change.${PENDING_CHAT_TEXT_STORAGE_KEY}`,
        ));
      } catch (error) {
        onError(error);
      }
    };
    chrome.storage.onChanged.addListener(handleChange);
    return () => chrome.storage.onChanged.removeListener(handleChange);
  },
});
