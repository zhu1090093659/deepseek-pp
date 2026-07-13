export const DEEPSEEK_WEB_ORIGIN = 'https://chat.deepseek.com';

export const DEEPSEEK_WEB_ROUTES = {
  completion: '/api/v0/chat/completion',
  regenerate: '/api/v0/chat/regenerate',
  history: '/api/v0/chat/history_messages',
  powChallenge: '/api/v0/chat/create_pow_challenge',
  createSession: '/api/v0/chat_session/create',
  fetchSessions: '/api/v0/chat_session/fetch_page',
  uploadFile: '/api/v0/file/upload_file',
  fetchFiles: '/api/v0/file/fetch_files',
} as const;

export const DEEPSEEK_CHAT_STREAM_ROUTE_PATHS = [
  DEEPSEEK_WEB_ROUTES.completion,
  DEEPSEEK_WEB_ROUTES.regenerate,
] as const;

export const DEEPSEEK_API_URL = `${DEEPSEEK_WEB_ORIGIN}${DEEPSEEK_WEB_ROUTES.completion}`;
export const DEEPSEEK_OFFICIAL_API_URL = 'https://api.deepseek.com/chat/completions';
export const DEEPSEEK_FILE_UPLOAD_PATH = DEEPSEEK_WEB_ROUTES.uploadFile;
export const DEEPSEEK_FILE_FETCH_PATH = DEEPSEEK_WEB_ROUTES.fetchFiles;
export const DEEPSEEK_BYPASS_HOOK_HEADER = 'X-DPP-Bypass-Hook';
export const DEEPSEEK_BODY_BUDGETS = {
  activeRequest: 4 * 1024 * 1024,
  activeJson: 4 * 1024 * 1024,
  activeCompletion: 4 * 1024 * 1024,
  officialApi: 4 * 1024 * 1024,
  // A per-session export can be much larger than one streaming turn, while still needing a hard memory bound.
  conversationExport: 32 * 1024 * 1024,
} as const;

export function matchesReleasedDeepSeekRoute(url: string, path: string): boolean {
  return url.includes(path);
}

export function isDeepSeekChatStreamUrl(url: string): boolean {
  return DEEPSEEK_CHAT_STREAM_ROUTE_PATHS.some((path) => matchesReleasedDeepSeekRoute(url, path));
}

export function isDeepSeekHistoryUrl(url: string): boolean {
  return matchesReleasedDeepSeekRoute(url, DEEPSEEK_WEB_ROUTES.history);
}
