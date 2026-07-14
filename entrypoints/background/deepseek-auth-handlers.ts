import {
  definePayloadlessRuntimeCommandHandler,
  type RuntimeCommandHandler,
} from '../../core/messaging/runtime-command-registry';
import type { ChatAuthStatus } from '../../core/messaging/deepseek-runtime-contracts';
import { defineDeepSeekPayloadRuntimeCommandHandler } from './runtime-handler';

export interface DeepSeekAuthRuntimeHandlerDependencies {
  hasDeepSeekApiKey(): Promise<boolean>;
  saveDeepSeekApiKey(apiKey: string): Promise<void>;
  clearDeepSeekApiKey(): Promise<void>;
  resetChatSession(): Promise<void>;
  refreshContextMenus(): Promise<void>;
  getChatAuthStatus(preferredTabId?: number): Promise<ChatAuthStatus>;
  broadcastChatAuthStatus(preferredTabId?: number): Promise<void>;
}

export function createDeepSeekAuthRuntimeHandlers(
  dependencies: DeepSeekAuthRuntimeHandlerDependencies,
): readonly RuntimeCommandHandler[] {
  return Object.freeze([
    definePayloadlessRuntimeCommandHandler('GET_DEEPSEEK_API_KEY_STATUS', async () => ({
      ok: true as const,
      configured: await dependencies.hasDeepSeekApiKey(),
    })),
    defineDeepSeekPayloadRuntimeCommandHandler('SAVE_DEEPSEEK_API_KEY', async (payload, context) => {
      await dependencies.saveDeepSeekApiKey(payload.apiKey);
      await dependencies.resetChatSession();
      await dependencies.refreshContextMenus();
      await dependencies.broadcastChatAuthStatus(context.tabId);
      return { ok: true as const, configured: true as const };
    }),
    definePayloadlessRuntimeCommandHandler('CLEAR_DEEPSEEK_API_KEY', async (context) => {
      await dependencies.clearDeepSeekApiKey();
      await dependencies.resetChatSession();
      await dependencies.refreshContextMenus();
      await dependencies.broadcastChatAuthStatus(context.tabId);
      return { ok: true as const, configured: false as const };
    }),
    definePayloadlessRuntimeCommandHandler('GET_AUTH_STATUS', (context) => (
      dependencies.getChatAuthStatus(context.tabId)
    )),
    definePayloadlessRuntimeCommandHandler('AUTH_STATUS_CHANGED', async (context) => {
      await dependencies.broadcastChatAuthStatus(context.tabId);
      return { ok: true as const };
    }),
  ]);
}
