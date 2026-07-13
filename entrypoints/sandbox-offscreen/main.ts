import {
  isTrustedSandboxMessageEvent,
  normalizeSandboxBoundaryRequest,
  normalizeSandboxExecutionResult,
  parseSandboxEnvelope,
  readSandboxRequestId,
  SANDBOX_FRAME_TARGET_ORIGIN,
  SANDBOX_MESSAGE_TYPES,
  SANDBOX_OPAQUE_EVENT_ORIGIN,
  SANDBOX_OFFSCREEN_PORT,
  type SandboxExecutionResult,
  type SandboxRunRequest,
} from '../../core/sandbox';
import {
  BACKGROUND_RUNTIME_PATHNAMES,
  createExtensionRuntimeMessageContext,
} from '../../core/messaging/runtime-boundary';

const SANDBOX_FRAME_URL = chrome.runtime.getURL('sandbox-runner.html');
const PYODIDE_BASE_URL = chrome.runtime.getURL('pyodide/');
const FRAME_READY_TIMEOUT_MS = 5_000;

let framePromise: Promise<HTMLIFrameElement> | null = null;
const pendingRuns = new Map<string, {
  resolve: (result: SandboxExecutionResult) => void;
  timeout: ReturnType<typeof setTimeout>;
}>();

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== SANDBOX_OFFSCREEN_PORT) return;
  try {
    createExtensionRuntimeMessageContext(port.sender ?? {}, {
      runtimeId: chrome.runtime.id,
      extensionOrigin: chrome.runtime.getURL('/'),
      allowedPathnames: BACKGROUND_RUNTIME_PATHNAMES,
    });
  } catch {
    port.disconnect();
    return;
  }

  port.onMessage.addListener((message: unknown) => {
    const envelope = parseSandboxEnvelope(message, SANDBOX_MESSAGE_TYPES.offscreenRun);
    if (!envelope) {
      const requestId = readSandboxRequestId(message, SANDBOX_MESSAGE_TYPES.offscreenRun);
      if (requestId) {
        port.postMessage({
          type: SANDBOX_MESSAGE_TYPES.offscreenResult,
          requestId,
          result: createFailure('Invalid sandbox request.', 'sandbox_request_invalid'),
        });
      }
      return;
    }

    runSandboxInFrame(envelope.payload)
      .then((result) => port.postMessage({
        type: SANDBOX_MESSAGE_TYPES.offscreenResult,
        requestId: envelope.requestId,
        result,
      }))
      .catch((error) => {
        port.postMessage({
          type: SANDBOX_MESSAGE_TYPES.offscreenResult,
          requestId: envelope.requestId,
          result: createFailure(error instanceof Error ? error.message : String(error)),
        });
      });
  });
});

window.addEventListener('message', (event) => {
  const frame = document.querySelector<HTMLIFrameElement>('iframe[data-dpp-sandbox-frame="true"]');
  if (!frame || !isTrustedSandboxMessageEvent(
    event.source,
    frame.contentWindow,
    event.origin,
    SANDBOX_OPAQUE_EVENT_ORIGIN,
  )) return;

  const envelope = parseSandboxEnvelope(event.data, SANDBOX_MESSAGE_TYPES.frameResult);
  if (!envelope) {
    const requestId = readSandboxRequestId(event.data, SANDBOX_MESSAGE_TYPES.frameResult);
    const pending = requestId ? pendingRuns.get(requestId) : undefined;
    if (!requestId || !pending) return;
    pendingRuns.delete(requestId);
    clearTimeout(pending.timeout);
    pending.resolve(createFailure('Invalid sandbox frame result.', 'sandbox_invalid_result'));
    return;
  }

  const pending = pendingRuns.get(envelope.requestId);
  if (!pending) return;
  pendingRuns.delete(envelope.requestId);
  clearTimeout(pending.timeout);
  pending.resolve(normalizeSandboxExecutionResult(envelope.result));
});

async function runSandboxInFrame(payload: unknown): Promise<SandboxExecutionResult> {
  const request = validateRequest(payload);
  const frame = await ensureSandboxFrame();
  const contentWindow = frame.contentWindow;
  if (!contentWindow) return createFailure('Sandbox frame is unavailable.');

  const requestId = crypto.randomUUID();
  const timeoutMs = Math.max(1_000, request.timeoutMs + 1_000);

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      pendingRuns.delete(requestId);
      resolve(createFailure('Sandbox frame timed out.', 'sandbox_frame_timeout', timeoutMs));
    }, timeoutMs);

    pendingRuns.set(requestId, { resolve, timeout });
    contentWindow.postMessage({
      type: SANDBOX_MESSAGE_TYPES.frameRun,
      requestId,
      payload: {
        ...request,
        pyodideBaseUrl: PYODIDE_BASE_URL,
      },
    }, SANDBOX_FRAME_TARGET_ORIGIN);
  });
}

function ensureSandboxFrame(): Promise<HTMLIFrameElement> {
  if (framePromise) return framePromise;

  framePromise = new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLIFrameElement>('iframe[data-dpp-sandbox-frame="true"]');
    if (existing?.contentWindow) {
      resolve(existing);
      return;
    }

    const frame = document.createElement('iframe');
    frame.dataset.dppSandboxFrame = 'true';
    frame.src = SANDBOX_FRAME_URL;
    frame.style.display = 'none';

    const timeout = setTimeout(() => {
      reject(new Error('Sandbox frame failed to load.'));
      frame.remove();
      framePromise = null;
    }, FRAME_READY_TIMEOUT_MS);

    frame.addEventListener('load', () => {
      clearTimeout(timeout);
      resolve(frame);
    }, { once: true });

    document.body.appendChild(frame);
  });

  return framePromise;
}

function validateRequest(payload: unknown): SandboxRunRequest {
  return normalizeSandboxBoundaryRequest(payload, {
    invalidLanguage: 'Only JavaScript, TypeScript, Python, and HTML use the browser sandbox.',
    invalidCode: 'Sandbox code must be a non-empty string.',
  });
}

function createFailure(message: string, code = 'sandbox_offscreen_error', durationMs = 0): SandboxExecutionResult {
  return {
    ok: false,
    stdout: '',
    stderr: message,
    durationMs,
    truncated: false,
    error: code,
  };
}
