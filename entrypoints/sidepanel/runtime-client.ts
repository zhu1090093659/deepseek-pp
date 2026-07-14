import type {
  TypedRuntimeCommandRequest,
  TypedRuntimeCommandResponse,
  TypedRuntimeCommandType,
} from '../../core/messaging/runtime-command-registry';

export type SidepanelRuntimeErrorKind =
  | 'transport'
  | 'unavailable'
  | 'command'
  | 'protocol';

export class SidepanelRuntimeError extends Error {
  readonly kind: SidepanelRuntimeErrorKind;
  readonly command: TypedRuntimeCommandType;

  constructor(options: {
    kind: SidepanelRuntimeErrorKind;
    command: TypedRuntimeCommandType;
    message: string;
    cause?: unknown;
  }) {
    super(options.message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'SidepanelRuntimeError';
    this.kind = options.kind;
    this.command = options.command;
  }
}

export type SidepanelRuntimeTransport = <TType extends TypedRuntimeCommandType>(
  request: TypedRuntimeCommandRequest<TType>,
) => Promise<unknown>;

export interface SidepanelRuntimeRequestOptions<TResult> {
  decode?: (value: unknown) => TResult;
  unavailableMessage?: string;
}

export interface SidepanelRuntimeClient {
  request<TType extends TypedRuntimeCommandType>(
    request: TypedRuntimeCommandRequest<TType>,
  ): Promise<TypedRuntimeCommandResponse<TType>>;
  request<TType extends TypedRuntimeCommandType, TResult>(
    request: TypedRuntimeCommandRequest<TType>,
    options: SidepanelRuntimeRequestOptions<TResult> & { decode: (value: unknown) => TResult },
  ): Promise<TResult>;
}

export function createSidepanelRuntimeClient(
  transport: SidepanelRuntimeTransport,
): SidepanelRuntimeClient {
  return Object.freeze({
    async request<TType extends TypedRuntimeCommandType, TResult = TypedRuntimeCommandResponse<TType>>(
      request: TypedRuntimeCommandRequest<TType>,
      options?: SidepanelRuntimeRequestOptions<TResult>,
    ): Promise<TResult> {
      let response: unknown;
      try {
        response = await transport(request);
      } catch (error) {
        if (error instanceof SidepanelRuntimeError) throw error;
        throw new SidepanelRuntimeError({
          kind: 'transport',
          command: request.type,
          message: getErrorMessage(error),
          cause: error,
        });
      }

      if (response === undefined || response === null) {
        throw new SidepanelRuntimeError({
          kind: 'unavailable',
          command: request.type,
          message: options?.unavailableMessage ?? `${request.type} did not return a response.`,
        });
      }
      if (isRuntimeFailure(response)) {
        throw new SidepanelRuntimeError({
          kind: 'command',
          command: request.type,
          message: typeof response.error === 'string'
            ? response.error
            : options?.unavailableMessage ?? `${request.type} failed.`,
        });
      }

      if (!options?.decode) return response as TResult;
      try {
        return options.decode(response);
      } catch (error) {
        throw new SidepanelRuntimeError({
          kind: 'protocol',
          command: request.type,
          message: getErrorMessage(error),
          cause: error,
        });
      }
    },
  });
}

export const sidepanelRuntimeClient = createSidepanelRuntimeClient(
  (request) => chrome.runtime.sendMessage(request),
);

function isRuntimeFailure(value: unknown): value is { ok: false; error?: unknown } {
  return Boolean(
    value
    && typeof value === 'object'
    && !Array.isArray(value)
    && (value as { ok?: unknown }).ok === false,
  );
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
