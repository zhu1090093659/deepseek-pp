import type {
  RuntimeMessageContext,
  RuntimeMessageEnvelope,
} from './runtime-boundary';
import {
  CLIENT_ONLY_RUNTIME_COMMAND_TYPES,
  LEGACY_RUNTIME_COMMAND_TYPES,
  TYPED_RUNTIME_COMMAND_TYPES,
  getRuntimeCommandOwner,
} from './runtime-command-contracts';
import type { PersistenceRuntimeCommandContracts } from './persistence-runtime-contracts';
import type { ToolRuntimeCommandContracts } from './tool-runtime-contracts';

export {
  CLIENT_ONLY_RUNTIME_COMMAND_TYPES,
  LEGACY_RUNTIME_COMMAND_TYPES,
  RUNTIME_COMMAND_CONTRACTS,
  TYPED_RUNTIME_COMMAND_TYPES,
  getRuntimeCommandOwner,
} from './runtime-command-contracts';
export type { RuntimeCommandOwner } from './runtime-command-contracts';

type MaybePromise<T> = T | Promise<T>;

export const RUNTIME_COMMAND_ERROR_CODES = {
  unknownCommand: 'runtime_command_unknown',
} as const;

export interface TypedRuntimeCommandContracts
  extends PersistenceRuntimeCommandContracts, ToolRuntimeCommandContracts {
  GET_CONFIG: {
    request: { type: 'GET_CONFIG' };
    response: { version: string };
  };
  WHATS_NEW_DISMISSED: {
    request: { type: 'WHATS_NEW_DISMISSED' };
    response: { ok: true };
  };
}

export type TypedRuntimeCommandType = keyof TypedRuntimeCommandContracts;
export type TypedRuntimeCommandRequest<TType extends TypedRuntimeCommandType> =
  TypedRuntimeCommandContracts[TType]['request'];
export type TypedRuntimeCommandResponse<TType extends TypedRuntimeCommandType> =
  TypedRuntimeCommandContracts[TType]['response'];

export interface RuntimeCommandHandler<
  TType extends TypedRuntimeCommandType = TypedRuntimeCommandType,
> {
  readonly type: TType;
  handle(
    message: RuntimeMessageEnvelope,
    context: RuntimeMessageContext,
  ): Promise<TypedRuntimeCommandResponse<TType>>;
}

export interface RuntimeCommandRegistry {
  readonly types: readonly string[];
  dispatch(
    message: RuntimeMessageEnvelope,
    context: RuntimeMessageContext,
  ): Promise<unknown>;
}

export type LegacyRuntimeCommandHandler = (
  message: RuntimeMessageEnvelope,
  context: RuntimeMessageContext,
) => Promise<unknown>;

export function defineRuntimeCommandHandler<
  TType extends TypedRuntimeCommandType,
  TDecoded = TypedRuntimeCommandRequest<TType>,
>(definition: {
  readonly type: TType;
  decode(message: RuntimeMessageEnvelope): TDecoded;
  handle(
    request: TDecoded,
    context: RuntimeMessageContext,
  ): MaybePromise<TypedRuntimeCommandResponse<TType>>;
}): RuntimeCommandHandler<TType> {
  return {
    type: definition.type,
    async handle(message, context) {
      if (message.type !== definition.type) {
        throw new Error(
          `Runtime command handler ${definition.type} received ${message.type}.`,
        );
      }
      const request = definition.decode(message);
      return definition.handle(request, context);
    },
  };
}

export function definePayloadlessRuntimeCommandHandler<
  TType extends TypedRuntimeCommandType,
>(
  type: TType,
  handle: (
    context: RuntimeMessageContext,
  ) => MaybePromise<TypedRuntimeCommandResponse<TType>>,
): RuntimeCommandHandler<TType> {
  return defineRuntimeCommandHandler({
    type,
    decode: () => undefined,
    handle: (_request, context) => handle(context),
  });
}

export function createRuntimeCommandRegistry(options: {
  typedHandlers: readonly RuntimeCommandHandler[];
  handleLegacy: LegacyRuntimeCommandHandler;
}): RuntimeCommandRegistry {
  const handlersByType = new Map<string, RuntimeCommandHandler>();
  for (const handler of options.typedHandlers) {
    if (handlersByType.has(handler.type)) {
      throw new Error(`Duplicate runtime command handler: ${handler.type}`);
    }
    if (getRuntimeCommandOwner(handler.type) !== 'typed-handler') {
      throw new Error(`Runtime command is not owned by the typed registry: ${handler.type}`);
    }
    handlersByType.set(handler.type, handler);
  }
  for (const type of TYPED_RUNTIME_COMMAND_TYPES) {
    if (!handlersByType.has(type)) {
      throw new Error(`Missing typed runtime command handler: ${type}`);
    }
  }
  const types = Object.freeze([
    ...TYPED_RUNTIME_COMMAND_TYPES,
    ...LEGACY_RUNTIME_COMMAND_TYPES,
  ]);

  return Object.freeze({
    types,
    async dispatch(message: RuntimeMessageEnvelope, context: RuntimeMessageContext) {
      const owner = getRuntimeCommandOwner(message.type);
      if (owner === 'legacy-switch') {
        return options.handleLegacy(message, context);
      }
      if (owner === 'typed-handler') {
        return handlersByType.get(message.type)!.handle(message, context);
      }
      return createUnknownRuntimeCommandResponse();
    },
  });
}

export function createUnknownRuntimeCommandResponse(): {
  ok: false;
  error: typeof RUNTIME_COMMAND_ERROR_CODES.unknownCommand;
} {
  return {
    ok: false,
    error: RUNTIME_COMMAND_ERROR_CODES.unknownCommand,
  };
}
