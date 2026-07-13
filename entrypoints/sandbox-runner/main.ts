import { runWorkerSandbox } from '../../core/sandbox/worker-runner';
import {
  isTrustedSandboxMessageEvent,
  normalizeSandboxBoundaryRequest,
  parseSandboxEnvelope,
  readSandboxRequestId,
  SANDBOX_FRAME_TARGET_ORIGIN,
  SANDBOX_MESSAGE_TYPES,
  SANDBOX_OPAQUE_EVENT_ORIGIN,
  type SandboxExecutionResult,
  type SandboxRunRequest,
} from '../../core/sandbox';

type SandboxRunnerRequest = SandboxRunRequest & {
  pyodideBaseUrl?: string;
};

const HTML_EXECUTION_DELAY_MS = 250;
const HTML_OUTPUT_LIMIT = 12_000;
const runnerUrl = new URL(window.location.href);
const EXTENSION_ORIGIN = `${runnerUrl.protocol}//${runnerUrl.host}`;

window.addEventListener('message', (event) => {
  if (!isTrustedSandboxMessageEvent(event.source, parent, event.origin, EXTENSION_ORIGIN)) return;

  const envelope = parseSandboxEnvelope(event.data, SANDBOX_MESSAGE_TYPES.frameRun);
  if (!envelope) {
    const requestId = readSandboxRequestId(event.data, SANDBOX_MESSAGE_TYPES.frameRun);
    if (requestId) postFrameFailure(requestId, 'Invalid sandbox frame request.');
    return;
  }

  void runApprovedCode(envelope.requestId, envelope.payload);
});

async function runApprovedCode(requestId: string, payload: unknown): Promise<void> {
  try {
    const request = validateRequest(payload);
    const result = request.language === 'html'
      ? await runHtmlSandbox(request)
      : await runWorkerSandbox({
        language: request.language,
        code: request.code,
        userInput: request.input,
        timeoutMs: request.timeoutMs,
        pyodideBaseUrl: request.pyodideBaseUrl,
      });
    parent.postMessage({
      type: SANDBOX_MESSAGE_TYPES.frameResult,
      requestId,
      result,
    }, SANDBOX_FRAME_TARGET_ORIGIN);
  } catch (error) {
    parent.postMessage({
      type: SANDBOX_MESSAGE_TYPES.frameResult,
      requestId,
      result: {
        ok: false,
        stdout: '',
        stderr: error instanceof Error ? error.message : String(error),
        durationMs: 0,
        truncated: false,
        error: 'sandbox_request_invalid',
      },
    }, SANDBOX_FRAME_TARGET_ORIGIN);
  }
}

function postFrameFailure(requestId: string, message: string): void {
  parent.postMessage({
    type: SANDBOX_MESSAGE_TYPES.frameResult,
    requestId,
    result: {
      ok: false,
      stdout: '',
      stderr: message,
      durationMs: 0,
      truncated: false,
      error: 'sandbox_request_invalid',
    },
  }, SANDBOX_FRAME_TARGET_ORIGIN);
}

function validateRequest(payload: unknown): SandboxRunnerRequest {
  return normalizeSandboxBoundaryRequest(payload, {
    invalidLanguage: 'Sandbox runner only supports JavaScript, TypeScript, Python, and HTML.',
    invalidCode: 'Sandbox code must be a non-empty string.',
    includePyodideBaseUrl: true,
    pyodideOrigin: EXTENSION_ORIGIN,
  });
}

function runHtmlSandbox(request: SandboxRunnerRequest): Promise<SandboxExecutionResult> {
  const startedAt = Date.now();
  const frame = document.createElement('iframe');
  frame.sandbox.add('allow-scripts');
  frame.style.display = 'none';
  document.body.appendChild(frame);

  const logs: string[] = [];
  const errors: string[] = [];
  let settled = false;
  const htmlRequestId = crypto.randomUUID();

  return new Promise((resolve) => {
    const finish = (result: Omit<SandboxExecutionResult, 'durationMs'>) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      window.removeEventListener('message', onMessage);
      frame.remove();
      resolve({
        ...result,
        durationMs: Date.now() - startedAt,
      });
    };

    const timeout = setTimeout(() => {
      const stdout = limitText(logs.join('\n'), HTML_OUTPUT_LIMIT);
      const stderr = limitText(errors.concat('HTML sandbox execution timed out.').join('\n'), HTML_OUTPUT_LIMIT);
      finish({
        ok: false,
        stdout: stdout.text,
        stderr: stderr.text,
        truncated: stdout.truncated || stderr.truncated,
        error: 'sandbox_timeout',
      });
    }, request.timeoutMs);

    const onMessage = (event: MessageEvent) => {
      if (!isTrustedSandboxMessageEvent(
        event.source,
        frame.contentWindow,
        event.origin,
        SANDBOX_OPAQUE_EVENT_ORIGIN,
      )) return;
      const requestId = readSandboxRequestId(event.data, SANDBOX_MESSAGE_TYPES.htmlLog)
        ?? readSandboxRequestId(event.data, SANDBOX_MESSAGE_TYPES.htmlError)
        ?? readSandboxRequestId(event.data, SANDBOX_MESSAGE_TYPES.htmlDone);
      if (requestId !== htmlRequestId) return;
      const value = parseSandboxEnvelope(event.data, SANDBOX_MESSAGE_TYPES.htmlLog, htmlRequestId)
        ?? parseSandboxEnvelope(event.data, SANDBOX_MESSAGE_TYPES.htmlError, htmlRequestId)
        ?? parseSandboxEnvelope(event.data, SANDBOX_MESSAGE_TYPES.htmlDone, htmlRequestId);
      if (!value) return;
      if (value.type === SANDBOX_MESSAGE_TYPES.htmlLog) {
        const level = typeof value.level === 'string' ? value.level : 'log';
        const values = Array.isArray(value.values) ? value.values : [];
        logs.push(`[${level}] ${values.map(formatHtmlValue).join(' ')}`);
        return;
      }
      if (value.type === SANDBOX_MESSAGE_TYPES.htmlError) {
        errors.push(typeof value.message === 'string' ? value.message : 'HTML runtime error.');
        return;
      }
      if (value.type === SANDBOX_MESSAGE_TYPES.htmlDone) {
        const stdout = limitText(logs.join('\n'), HTML_OUTPUT_LIMIT);
        const stderr = limitText(errors.join('\n'), HTML_OUTPUT_LIMIT);
        const html = typeof value.html === 'string' ? value.html : '';
        finish({
          ok: errors.length === 0,
          stdout: stdout.text,
          stderr: stderr.text,
          result: typeof value.title === 'string' && value.title ? value.title : 'HTML rendered',
          html,
          previewText: typeof value.text === 'string' ? limitText(value.text, HTML_OUTPUT_LIMIT).text : '',
          truncated: stdout.truncated || stderr.truncated || html.length > HTML_OUTPUT_LIMIT,
          error: errors.length > 0 ? 'sandbox_html_error' : undefined,
        });
      }
    };

    window.addEventListener('message', onMessage);
    frame.srcdoc = createHtmlDocument(request.code, htmlRequestId);
  });
}

function createHtmlDocument(source: string, requestId: string): string {
  const prelude = `<script>
(() => {
  const requestId = ${JSON.stringify(requestId)};
  const send = (payload) => parent.postMessage(Object.assign({ requestId }, payload), ${JSON.stringify(SANDBOX_FRAME_TARGET_ORIGIN)});
  const format = (value) => {
    if (value === undefined) return '';
    if (typeof value === 'string') return value;
    try { return JSON.stringify(value); } catch { return String(value); }
  };
  ['log', 'info', 'warn', 'error'].forEach((level) => {
    const original = console[level];
    console[level] = (...values) => {
      send({ type: ${JSON.stringify(SANDBOX_MESSAGE_TYPES.htmlLog)}, level, values: values.map(format) });
      if (typeof original === 'function') original.apply(console, values);
    };
  });
  addEventListener('error', (event) => {
    send({ type: ${JSON.stringify(SANDBOX_MESSAGE_TYPES.htmlError)}, message: event.message || String(event.error || 'Error') });
  });
  addEventListener('unhandledrejection', (event) => {
    send({ type: ${JSON.stringify(SANDBOX_MESSAGE_TYPES.htmlError)}, message: event.reason && event.reason.stack ? String(event.reason.stack) : String(event.reason) });
  });
  const done = () => setTimeout(() => {
    send({
      type: ${JSON.stringify(SANDBOX_MESSAGE_TYPES.htmlDone)},
      title: document.title || '',
      text: document.body ? document.body.innerText : '',
      html: document.documentElement ? document.documentElement.outerHTML : (document.body ? document.body.outerHTML : ''),
    });
  }, ${HTML_EXECUTION_DELAY_MS});
  if (document.readyState === 'complete') done();
  else addEventListener('load', done, { once: true });
})();
</script>`;
  if (/<head[\s>]/i.test(source)) {
    return source.replace(/<head([^>]*)>/i, `<head$1>${prelude}`);
  }
  if (/<html[\s>]/i.test(source)) {
    return source.replace(/<html([^>]*)>/i, `<html$1><head>${prelude}</head>`);
  }
  return `<!doctype html><html><head>${prelude}</head><body>${source}</body></html>`;
}

function formatHtmlValue(value: unknown): string {
  if (typeof value === 'string') return value;
  try { return JSON.stringify(value); } catch { return String(value); }
}

function limitText(text: string, limit: number): { text: string; truncated: boolean } {
  if (text.length <= limit) return { text, truncated: false };
  return { text: `${text.slice(0, limit)}\n...[truncated]`, truncated: true };
}
