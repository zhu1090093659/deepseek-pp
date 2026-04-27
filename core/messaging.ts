import type { Memory, MessageAction, Skill, ToolCall } from './types';

export function sendToBackground(action: MessageAction): Promise<unknown> {
  return chrome.runtime.sendMessage(action);
}

export function sendToContentScript(tabId: number, data: unknown): Promise<unknown> {
  return chrome.tabs.sendMessage(tabId, data);
}

export function onMessage(
  handler: (message: MessageAction, sender: chrome.runtime.MessageSender) => Promise<unknown> | unknown,
) {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const result = handler(message, sender);
    if (result instanceof Promise) {
      result.then(sendResponse).catch(() => sendResponse(null));
      return true;
    }
    sendResponse(result);
    return false;
  });
}
