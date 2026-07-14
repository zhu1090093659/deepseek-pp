export const FLOATING_CHAT_HOST_ORIGINS = Object.freeze([
  'http://*/*',
  'https://*/*',
] as const);

export type FloatingChatRuntimeState =
  | { kind: 'disabled' }
  | { kind: 'missing-permission' }
  | { kind: 'ready' }
  | { kind: 'invalidated' };

export interface FloatingChatRuntimeStateDependencies {
  readEnabled(): Promise<boolean>;
  hasHostPermission(): Promise<boolean>;
  isContextInvalidated(error: unknown): boolean;
}

export async function resolveFloatingChatRuntimeState(
  dependencies: FloatingChatRuntimeStateDependencies,
): Promise<FloatingChatRuntimeState> {
  try {
    if (!await dependencies.readEnabled()) return { kind: 'disabled' };
    return await dependencies.hasHostPermission()
      ? { kind: 'ready' }
      : { kind: 'missing-permission' };
  } catch (error) {
    if (dependencies.isContextInvalidated(error)) return { kind: 'invalidated' };
    throw error;
  }
}
