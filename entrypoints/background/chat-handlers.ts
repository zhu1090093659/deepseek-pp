import {
  definePayloadlessRuntimeCommandHandler,
  type RuntimeCommandHandler,
} from '../../core/messaging/runtime-command-registry';
import type { OfficialApiChatConfig } from '../../core/chat/official-api-config-contract';
import type { ChatRuntimeService } from './chat-runtime-service';
import { defineDeepSeekPayloadRuntimeCommandHandler } from './runtime-handler';

export interface ChatRuntimeHandlerDependencies {
  service: ChatRuntimeService;
  getOfficialApiChatConfig(): Promise<OfficialApiChatConfig>;
  saveOfficialApiChatConfig(config: OfficialApiChatConfig): Promise<OfficialApiChatConfig>;
}

export function createChatRuntimeHandlers(
  dependencies: ChatRuntimeHandlerDependencies,
): readonly RuntimeCommandHandler[] {
  return Object.freeze([
    defineDeepSeekPayloadRuntimeCommandHandler('CHAT_SUBMIT_PROMPT', (payload, context) => (
      dependencies.service.submitPrompt(payload, context.tabId)
    )),
    defineDeepSeekPayloadRuntimeCommandHandler('UPLOAD_DEEPSEEK_IMAGE', (payload, context) => (
      dependencies.service.uploadImage(payload, context.tabId)
    )),
    definePayloadlessRuntimeCommandHandler('CHAT_NEW_SESSION', async () => {
      await dependencies.service.resetSession();
      return { ok: true as const };
    }),
    definePayloadlessRuntimeCommandHandler('GET_OFFICIAL_API_CHAT_CONFIG', () => (
      dependencies.getOfficialApiChatConfig()
    )),
    defineDeepSeekPayloadRuntimeCommandHandler('SAVE_OFFICIAL_API_CHAT_CONFIG', (config) => (
      dependencies.saveOfficialApiChatConfig(config)
    )),
  ]);
}
