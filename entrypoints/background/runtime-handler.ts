import type {
  RuntimeMessageContext,
} from '../../core/messaging/runtime-boundary';
import {
  decodePersistenceRuntimePayload,
  type PersistencePayloadCommandType,
  type PersistenceRuntimePayload,
} from '../../core/messaging/persistence-runtime-request-codec';
import {
  defineRuntimeCommandHandler,
  type RuntimeCommandHandler,
  type TypedRuntimeCommandResponse,
  type TypedRuntimeCommandType,
} from '../../core/messaging/runtime-command-registry';

type MaybePromise<T> = T | Promise<T>;

type PersistenceTypedCommandType = PersistencePayloadCommandType & TypedRuntimeCommandType;

export function definePersistencePayloadRuntimeCommandHandler<
  TType extends PersistenceTypedCommandType,
>(
  type: TType,
  handle: (
    payload: PersistenceRuntimePayload<TType>,
    context: RuntimeMessageContext,
  ) => MaybePromise<TypedRuntimeCommandResponse<TType>>,
): RuntimeCommandHandler<TType> {
  return defineRuntimeCommandHandler<TType, PersistenceRuntimePayload<TType>>({
    type,
    decode(message) {
      const payload = Object.hasOwn(message, 'payload') ? message.payload : undefined;
      return decodePersistenceRuntimePayload(type, payload);
    },
    handle,
  });
}
