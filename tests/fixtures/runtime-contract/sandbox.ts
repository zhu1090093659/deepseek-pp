export const SANDBOX_NORMALIZATION_CASES = [
  {
    name: 'javascript default timeout',
    input: { language: 'javascript', code: 'return 42;' },
    output: { language: 'javascript', code: 'return 42;', input: undefined, timeoutMs: 5_000 },
  },
  {
    name: 'typescript lower timeout clamp',
    input: { language: 'typescript', code: 'const answer: number = 42;', input: 'contract', timeoutMs: 500 },
    output: {
      language: 'typescript',
      code: 'const answer: number = 42;',
      input: 'contract',
      timeoutMs: 1_000,
    },
  },
  {
    name: 'python default timeout',
    input: { language: 'python', code: 'print(42)' },
    output: { language: 'python', code: 'print(42)', input: undefined, timeoutMs: 15_000 },
  },
  {
    name: 'html upper timeout clamp',
    input: { language: 'html', code: '<h1>Contract</h1>', timeoutMs: 60_000.9 },
    output: { language: 'html', code: '<h1>Contract</h1>', input: undefined, timeoutMs: 15_000 },
  },
] as const;

export const SANDBOX_REJECTED_REQUESTS: ReadonlyArray<{
  name: string;
  input: unknown;
  error: string;
}> = [
  { name: 'null request', input: null, error: 'sandbox payload must be an object' },
  { name: 'array request', input: [], error: 'sandbox payload must be an object' },
  { name: 'unsupported language', input: { language: 'ruby', code: 'puts 42' }, error: 'language must be javascript, typescript, python, or html' },
  { name: 'missing code', input: { language: 'javascript' }, error: 'code must be a non-empty string' },
  { name: 'empty code', input: { language: 'javascript', code: '   ' }, error: 'code must be a non-empty string' },
  { name: 'over 30000 UTF-8 bytes', input: { language: 'javascript', code: '界'.repeat(10_001) }, error: 'code is too large; max 30000 bytes' },
];

export const SANDBOX_EXECUTION_RESULT = {
  ok: true,
  stdout: '[log] contract',
  stderr: '',
  result: '42',
  html: '<h1>Contract</h1>',
  previewText: 'Contract',
  durationMs: 7,
  truncated: false,
} as const;

export const SANDBOX_ENVELOPE_TYPES = {
  backgroundPort: {
    port: 'sandbox-offscreen',
    request: 'OFFSCREEN_SANDBOX_RUN',
    response: 'OFFSCREEN_SANDBOX_RESULT',
  },
  frame: {
    request: 'DPP_SANDBOX_RUN',
    response: 'DPP_SANDBOX_RESULT',
  },
  html: {
    log: 'DPP_HTML_LOG',
    error: 'DPP_HTML_ERROR',
    done: 'DPP_HTML_DONE',
  },
} as const;

export const SANDBOX_LEGAL_ENVELOPES = [
  {
    type: 'OFFSCREEN_SANDBOX_RUN',
    requestId: 'sandbox-offscreen-1',
    payload: { language: 'javascript', code: 'return 42;', timeoutMs: 5_000 },
  },
  {
    type: 'OFFSCREEN_SANDBOX_RESULT',
    requestId: 'sandbox-offscreen-1',
    result: SANDBOX_EXECUTION_RESULT,
  },
  {
    type: 'DPP_SANDBOX_RUN',
    requestId: 'sandbox-frame-1',
    payload: {
      language: 'python',
      code: 'print(42)',
      timeoutMs: 15_000,
      pyodideBaseUrl: 'chrome-extension://contract/pyodide/',
    },
  },
  {
    type: 'DPP_SANDBOX_RESULT',
    requestId: 'sandbox-frame-1',
    result: SANDBOX_EXECUTION_RESULT,
  },
  {
    type: 'DPP_HTML_LOG',
    requestId: 'sandbox-html-1',
    level: 'log',
    values: ['contract', '42'],
  },
  {
    type: 'DPP_HTML_ERROR',
    requestId: 'sandbox-html-1',
    message: 'contract error',
  },
  {
    type: 'DPP_HTML_DONE',
    requestId: 'sandbox-html-1',
    title: 'Contract',
    text: 'Contract body',
    html: '<html><body>Contract body</body></html>',
  },
] as const;

export const SANDBOX_ERROR_CODES = [
  'sandbox_tool_unsupported',
  'sandbox_runtime_unavailable',
  'sandbox_invalid_request',
  'sandbox_execution_failed',
  'sandbox_offscreen_unavailable',
  'sandbox_offscreen_create_failed',
  'sandbox_offscreen_timeout',
  'sandbox_offscreen_disconnected',
  'sandbox_frame_timeout',
  'sandbox_offscreen_error',
  'sandbox_request_invalid',
  'sandbox_timeout',
  'sandbox_worker_error',
  'sandbox_pyodide_assets_unavailable',
  'sandbox_pyodide_worker_error',
  'sandbox_invalid_result',
  'sandbox_exception',
  'sandbox_python_exception',
  'sandbox_html_error',
] as const;

export const SANDBOX_BOUNDARY_REGRESSION_CASES = [
  {
    name: 'core normalizer ignores unknown request fields',
    input: { language: 'javascript', code: 'return 42;', privilege: 'unexpected' },
    target: 'explicit-strip-at-T2.1-boundary',
  },
  {
    name: 'RUN_ARTIFACT_CODE shares the core 30000-byte limit',
    input: { type: 'RUN_ARTIFACT_CODE', payload: { language: 'javascript', code: 'x'.repeat(30_001), timeoutMs: 5_000 } },
    target: 'shared-sandbox-boundary-at-T2.1',
  },
  {
    name: 'malformed result objects become explicit invalid results',
    input: {},
    target: 'explicit-invalid-result-at-T2.1-boundary',
  },
  {
    name: 'frame bridge uses wildcard target origin with source identity checks',
    input: { targetOrigin: '*', sourceCheck: true },
    target: 'opaque-sandbox-origin-policy-at-T2.1',
  },
  {
    name: 'array-like envelopes with custom type and requestId fields are rejected',
    input: Object.assign([], { type: 'DPP_SANDBOX_RUN', requestId: 'array-contract-1' }),
    target: 'reject-malformed-envelope-at-T2.1-boundary',
  },
  {
    name: 'result envelope cannot omit its nested result field',
    input: { type: 'OFFSCREEN_SANDBOX_RESULT', requestId: 'missing-result-1' },
    target: 'reject-malformed-envelope-at-T2.1-boundary',
  },
] as const;
