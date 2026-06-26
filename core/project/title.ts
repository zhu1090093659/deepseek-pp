const DEEPSEEK_DEFAULT_TITLE_SUFFIX = '探索未至之境';
const DEEPSEEK_DEFAULT_TITLE = new RegExp(`^DeepSeek\\s*[-|]\\s*${DEEPSEEK_DEFAULT_TITLE_SUFFIX}$`, 'i');

export const PROJECT_UNTITLED_CONVERSATION = 'Untitled conversation';

export function isDefaultDeepSeekConversationTitle(value: string): boolean {
  return DEEPSEEK_DEFAULT_TITLE.test(value.trim());
}

export function isPlaceholderProjectConversationTitle(value: string): boolean {
  const title = value.trim();
  return title === PROJECT_UNTITLED_CONVERSATION || isDefaultDeepSeekConversationTitle(title);
}

export function isUsableProjectConversationTitle(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const title = value.trim();
  return title.length > 0 && !isPlaceholderProjectConversationTitle(title);
}
