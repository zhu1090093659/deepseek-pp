import { createAbortScope, type AbortScope } from './abort';

export type NetworkPolicyErrorCode =
  | 'network_deadline_exceeded'
  | 'network_request_failed'
  | 'network_request_too_large'
  | 'network_response_too_large'
  | 'network_response_unreadable';

export class NetworkPolicyError extends Error {
  readonly retryable: boolean;
  readonly phase: string | null;

  constructor(
    readonly code: NetworkPolicyErrorCode,
    readonly operation: string,
    message: string,
    options?: { retryable?: boolean; phase?: string; cause?: unknown },
  ) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'NetworkPolicyError';
    this.retryable = options?.retryable ?? true;
    this.phase = options?.phase ?? null;
  }
}

export interface NetworkRequestPolicy {
  readonly operation: string;
  readonly phase?: string;
  readonly deadlineAt?: number;
  readonly maxRequestBytes?: number;
  readonly maxResponseBytes: number;
  readonly fetchImpl?: typeof fetch;
  readonly onDispatch?: () => void;
}

interface RequestScope {
  readonly signal?: AbortSignal;
  readonly callerSignal?: AbortSignal;
  readonly timedOut: () => boolean;
  cleanup(): void;
}

export async function fetchWithNetworkPolicy(
  input: RequestInfo | URL,
  init: RequestInit,
  policy: NetworkRequestPolicy,
): Promise<Response> {
  assertRequestWithinPolicy(init.body, policy);
  const scope = createRequestScope(init.signal, policy);
  const fetchImpl = policy.fetchImpl ?? fetch;
  let response: Response;

  try {
    policy.onDispatch?.();
    response = await fetchImpl(input, { ...init, signal: scope.signal });
  } catch (error) {
    scope.cleanup();
    throw classifyNetworkFailure(error, scope, policy, 'request');
  }

  if (scope.signal?.aborted) {
    await cancelResponseBody(response, abortReason(scope, policy));
    scope.cleanup();
    throw abortReason(scope, policy);
  }

  if (!response.body) {
    scope.cleanup();
    return response;
  }

  return wrapResponseBody(response, scope, policy);
}

function assertRequestWithinPolicy(
  body: BodyInit | null | undefined,
  policy: NetworkRequestPolicy,
): void {
  if (typeof body !== 'string' || policy.maxRequestBytes === undefined) return;
  const byteLength = new TextEncoder().encode(body).byteLength;
  if (byteLength <= policy.maxRequestBytes) return;
  throw new NetworkPolicyError(
    'network_request_too_large',
    policy.operation,
    `${policy.operation} request exceeded ${policy.maxRequestBytes} bytes.`,
    { retryable: false, phase: policy.phase },
  );
}

export async function readNetworkResponseText(
  response: Response,
  operation: string,
): Promise<string> {
  try {
    return await response.text();
  } catch (error) {
    if (error instanceof NetworkPolicyError || isAbortError(error)) throw error;
    if (error instanceof Error && !(error instanceof TypeError)) throw error;
    throw new NetworkPolicyError(
      'network_response_unreadable',
      operation,
      `${operation} response body could not be read.`,
      { cause: error },
    );
  }
}

export async function cancelResponseBody(response: Response, reason?: unknown): Promise<void> {
  if (!response.body) return;
  try {
    await response.body.cancel(reason);
  } catch {
    // The body may already be locked or settled; cancellation is best effort cleanup only.
  }
}

function createRequestScope(
  callerSignal: AbortSignal | null | undefined,
  policy: NetworkRequestPolicy,
): RequestScope {
  const { deadlineAt, operation } = policy;
  if (callerSignal?.aborted) throwSignalReason(callerSignal, operation);
  if (deadlineAt === undefined) {
    return {
      signal: callerSignal ?? undefined,
      callerSignal: callerSignal ?? undefined,
      timedOut: () => false,
      cleanup() {},
    };
  }

  const timeoutMs = deadlineAt - Date.now();
  if (timeoutMs <= 0) {
    throw new NetworkPolicyError(
      'network_deadline_exceeded',
      operation,
      `${operation} exceeded its execution deadline.`,
      { retryable: false, phase: policy.phase },
    );
  }

  const abortScope: AbortScope = createAbortScope(callerSignal, timeoutMs);
  return {
    signal: abortScope.signal,
    callerSignal: callerSignal ?? undefined,
    timedOut: abortScope.timedOut,
    cleanup: abortScope.cleanup,
  };
}

function wrapResponseBody(
  response: Response,
  scope: RequestScope,
  policy: NetworkRequestPolicy,
): Response {
  const reader = response.body!.getReader();
  let totalBytes = 0;
  let settled = false;
  let terminalPromise: Promise<void> | null = null;
  let controllerRef: ReadableStreamDefaultController<Uint8Array> | null = null;

  const cleanup = () => {
    scope.signal?.removeEventListener('abort', onAbort);
    scope.cleanup();
  };
  const fail = (error: unknown): Promise<void> => {
    if (terminalPromise) return terminalPromise;
    if (settled) return Promise.resolve();
    settled = true;
    cleanup();
    terminalPromise = reader.cancel(error)
      .catch(() => undefined)
      .then(() => {
        controllerRef?.error(error);
      });
    return terminalPromise;
  };
  const onAbort = () => {
    void fail(abortReason(scope, policy));
  };

  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controllerRef = controller;
      scope.signal?.addEventListener('abort', onAbort, { once: true });
      if (scope.signal?.aborted) onAbort();
    },
    async pull(controller) {
      if (settled) return;
      try {
        const chunk = await reader.read();
        if (settled) return;
        if (scope.signal?.aborted) {
          onAbort();
          return;
        }
        if (chunk.done) {
          settled = true;
          cleanup();
          controller.close();
          return;
        }

        totalBytes += chunk.value.byteLength;
        if (totalBytes > policy.maxResponseBytes) {
          await fail(new NetworkPolicyError(
            'network_response_too_large',
            policy.operation,
            `${policy.operation} response exceeded ${policy.maxResponseBytes} bytes.`,
            { retryable: false, phase: policy.phase },
          ));
          return;
        }
        controller.enqueue(chunk.value);
      } catch (error) {
        await fail(classifyNetworkFailure(error, scope, policy, 'response'));
      }
    },
    async cancel(reason) {
      if (terminalPromise) {
        await terminalPromise;
        return;
      }
      if (settled) return;
      settled = true;
      cleanup();
      await reader.cancel(reason);
    },
  });

  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

function classifyNetworkFailure(
  error: unknown,
  scope: RequestScope,
  policy: NetworkRequestPolicy,
  phase: 'request' | 'response',
): unknown {
  const { operation } = policy;
  if (scope.callerSignal?.aborted) return signalReason(scope.callerSignal, operation);
  if (scope.timedOut()) {
    return new NetworkPolicyError(
      'network_deadline_exceeded',
      operation,
      `${operation} exceeded its execution deadline.`,
      { retryable: false, phase: policy.phase, cause: error },
    );
  }
  if (error instanceof NetworkPolicyError || isAbortError(error)) return error;
  return new NetworkPolicyError(
    phase === 'request' ? 'network_request_failed' : 'network_response_unreadable',
    operation,
    phase === 'request'
      ? `${operation} request failed before a response was received.`
      : `${operation} response body could not be read.`,
    { phase: policy.phase, cause: error },
  );
}

function abortReason(scope: RequestScope, policy: NetworkRequestPolicy): unknown {
  const { operation } = policy;
  if (scope.callerSignal?.aborted) return signalReason(scope.callerSignal, operation);
  if (scope.timedOut()) {
    return new NetworkPolicyError(
      'network_deadline_exceeded',
      operation,
      `${operation} exceeded its execution deadline.`,
      { retryable: false, phase: policy.phase },
    );
  }
  if (scope.signal?.reason instanceof Error) return scope.signal.reason;
  return new DOMException(`${operation} was aborted.`, 'AbortError');
}

function signalReason(signal: AbortSignal, operation: string): unknown {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException(`${operation} was aborted.`, 'AbortError');
}

function throwSignalReason(signal: AbortSignal, operation: string): never {
  throw signalReason(signal, operation);
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}
