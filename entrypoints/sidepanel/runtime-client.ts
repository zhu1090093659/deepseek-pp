import type {
  TypedRuntimeCommandRequest,
  TypedRuntimeCommandResponse,
  TypedRuntimeCommandType,
} from '../../core/messaging/runtime-command-registry';
import {
  getRuntimeErrorMessage,
  isRuntimeFailure,
} from '../../core/messaging/runtime-response';

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

export type AnyTypedRuntimeCommandRequest = {
  [TType in TypedRuntimeCommandType]: TypedRuntimeCommandRequest<TType>;
}[TypedRuntimeCommandType];

type RuntimeResponseFor<TRequest extends AnyTypedRuntimeCommandRequest> =
  TypedRuntimeCommandResponse<TRequest['type']>;

export type SidepanelRuntimeTransport = (
  request: AnyTypedRuntimeCommandRequest,
) => Promise<unknown>;

export interface SidepanelRuntimeRequestOptions<TResult> {
  decode?: (value: unknown) => TResult;
  unavailableMessage?: string;
  acceptFailure?: boolean;
}

export interface SidepanelRuntimeClient {
  request<TRequest extends AnyTypedRuntimeCommandRequest, TResult>(
    request: TRequest,
    options: SidepanelRuntimeRequestOptions<TResult> & { decode: (value: unknown) => TResult },
  ): Promise<TResult>;
  request<TRequest extends AnyTypedRuntimeCommandRequest>(
    request: TRequest,
    options?: Omit<SidepanelRuntimeRequestOptions<RuntimeResponseFor<TRequest>>, 'decode'>,
  ): Promise<RuntimeResponseFor<TRequest>>;
}

export function createSidepanelRuntimeClient(
  transport: SidepanelRuntimeTransport,
): SidepanelRuntimeClient {
  return Object.freeze({
    async request<
      TRequest extends AnyTypedRuntimeCommandRequest,
      TResult = RuntimeResponseFor<TRequest>,
    >(
      request: TRequest,
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
          message: getRuntimeErrorMessage(error),
          cause: error,
        });
      }

      if (response === undefined) {
        throw new SidepanelRuntimeError({
          kind: 'unavailable',
          command: request.type,
          message: options?.unavailableMessage ?? `${request.type} did not return a response.`,
        });
      }
      if (isRuntimeFailure(response) && !options?.acceptFailure) {
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
          message: getRuntimeErrorMessage(error),
          cause: error,
        });
      }
    },
  });
}

export const sidepanelRuntimeClient = createSidepanelRuntimeClient(
  (request) => chrome.runtime.sendMessage(request),
);
