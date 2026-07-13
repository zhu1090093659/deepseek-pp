export const DEEPSEEK_ROUTE_CONTRACT = {
  origin: 'https://chat.deepseek.com',
  officialApi: 'https://api.deepseek.com/chat/completions',
  bypassHeader: 'X-DPP-Bypass-Hook',
  routes: {
    completion: '/api/v0/chat/completion',
    regenerate: '/api/v0/chat/regenerate',
    history: '/api/v0/chat/history_messages',
    powChallenge: '/api/v0/chat/create_pow_challenge',
    createSession: '/api/v0/chat_session/create',
    fetchSessions: '/api/v0/chat_session/fetch_page',
    uploadFile: '/api/v0/file/upload_file',
    fetchFiles: '/api/v0/file/fetch_files',
  },
} as const;

export const LEGAL_DEEPSEEK_ROUTE_FIXTURES = [
  { route: 'completion', method: 'POST', url: 'https://chat.deepseek.com/api/v0/chat/completion' },
  { route: 'regenerate', method: 'POST', url: 'https://chat.deepseek.com/api/v0/chat/regenerate' },
  { route: 'history', method: 'GET', url: 'https://chat.deepseek.com/api/v0/chat/history_messages?chat_session_id=one' },
  {
    route: 'completion',
    method: 'POST',
    url: '/api/v0/chat/completion',
    baseUrl: 'https://chat.deepseek.com/a/chat/s/session-contract',
  },
] as const;

export const DEEPSEEK_ACTIVE_ROUTE_METHOD_FIXTURES = [
  { name: 'completion', path: '/api/v0/chat/completion', method: 'POST' },
  { name: 'regenerate', path: '/api/v0/chat/regenerate', method: 'POST' },
  { name: 'history', path: '/api/v0/chat/history_messages', method: 'GET' },
  { name: 'powChallenge', path: '/api/v0/chat/create_pow_challenge', method: 'POST' },
  { name: 'createSession', path: '/api/v0/chat_session/create', method: 'POST' },
  { name: 'fetchSessions', path: '/api/v0/chat_session/fetch_page', method: 'GET' },
  { name: 'uploadFile', path: '/api/v0/file/upload_file', method: 'POST' },
  { name: 'fetchFiles', path: '/api/v0/file/fetch_files', method: 'GET' },
] as const;

export const REJECTED_DEEPSEEK_ROUTE_FIXTURES = [
  {
    name: 'different origin with a released path',
    url: 'https://example.test/proxy/api/v0/chat/completion',
    method: 'POST',
  },
  {
    name: 'released path embedded in a query parameter',
    url: 'https://example.test/?next=/api/v0/chat/regenerate',
    method: 'POST',
  },
  {
    name: 'released path with a suffix',
    url: 'https://chat.deepseek.com/api/v0/chat/history_messages/suffix',
    method: 'GET',
  },
  {
    name: 'completion with the wrong method',
    url: 'https://chat.deepseek.com/api/v0/chat/completion',
    method: 'GET',
  },
  {
    name: 'history with the wrong method',
    url: 'https://chat.deepseek.com/api/v0/chat/history_messages',
    method: 'POST',
  },
  {
    name: 'relative route on a non-DeepSeek page',
    url: '/api/v0/chat/completion',
    method: 'POST',
    baseUrl: 'https://example.test/page',
  },
] as const;

export const DEEPSEEK_REQUEST_BODY_FIXTURE = {
  chat_session_id: 'session-contract',
  parent_message_id: 19,
  model_class: 'deepseek_chat',
  prompt: 'Preserve the released request body.',
  ref_file_ids: ['file-contract'],
  thinking_enabled: true,
  search_enabled: false,
  action: 'continue',
  preempt: false,
  future_sibling: { preserve: true },
} as const;

export const DEEPSEEK_ACTIVE_COMPLETION_BODY_FIXTURE = {
  chat_session_id: 'session-contract',
  parent_message_id: 19,
  model_type: 'expert',
  prompt: 'Preserve the active request body.',
  ref_file_ids: ['file-contract'],
  thinking_enabled: true,
  search_enabled: false,
  action: null,
  preempt: false,
} as const;

export const LEGAL_DEEPSEEK_SSE_FIXTURES = [
  {
    name: 'bare text append',
    wire: 'data: {"v":"bare"}\n\n',
    parsed: { v: 'bare' },
    text: 'bare',
    finished: false,
  },
  {
    name: 'response content append',
    wire: 'data: {"p":"response/content","o":"APPEND","v":"patch"}\n\n',
    parsed: { p: 'response/content', o: 'APPEND', v: 'patch' },
    text: 'patch',
    finished: false,
  },
  {
    name: 'response fragment append',
    wire: 'data: {"p":"response/fragments","o":"APPEND","v":[{"content":"fragment"}]}\n\n',
    parsed: { p: 'response/fragments', o: 'APPEND', v: [{ content: 'fragment' }] },
    text: 'fragment',
    finished: false,
  },
  {
    name: 'direct finished patch',
    wire: 'data: {"p":"response/status","v":"FINISHED"}\n\n',
    parsed: { p: 'response/status', v: 'FINISHED' },
    text: null,
    finished: true,
  },
  {
    name: 'batch text and quasi finished patch',
    wire: 'data: {"p":"response","o":"BATCH","v":[{"p":"response/content","o":"APPEND","v":"batch"},{"p":"quasi_status","v":"FINISHED"}]}\n\n',
    parsed: {
      p: 'response',
      o: 'BATCH',
      v: [
        { p: 'response/content', o: 'APPEND', v: 'batch' },
        { p: 'quasi_status', v: 'FINISHED' },
      ],
    },
    text: 'batch',
    finished: true,
  },
] as const;

export const DEEPSEEK_SSE_CURRENT_GAPS = [
  {
    name: 'malformed event JSON is silently represented as null',
    wire: 'data: {bad json}\n\n',
    currentBehavior: 'parse-null-without-diagnostic',
    target: 'observable-protocol-error-after-T5.1',
  },
] as const;

export const CRLF_DEEPSEEK_SSE_FIXTURE = {
  wire: 'event: ready\r\ndata: {"model_type":"vision"}\r\n\r\ndata: {"v":"text"}\r\n\r\n',
  events: [
    { type: 'ready', parsed: { model_type: 'vision' } },
    { type: 'message', parsed: { v: 'text' } },
  ],
} as const;

export const UNKNOWN_DEEPSEEK_SSE_EVENT =
  'event: future\ndata: {"p":"future/patch","o":"APPEND","v":{"preserve":true}}\n\n';
