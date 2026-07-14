/**
 * Global floating-chat launcher.
 *
 * Injects a draggable chat ball on every page that opens an iframe to the
 * sidepanel chat surface. Gated by the `deepseek_pp_floating_chat_enabled`
 * storage key (default ON). Lives on its own content script so the DeepSeek-only
 * content script does not run on unrelated sites.
 */
import { startChatLauncherPageLifecycle } from './content/adapters/chat-launcher-page-lifecycle';

export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_idle',
  async main() {
    // The whale pet + DeepSeek-specific UI already run on the DeepSeek host.
    // Skip the global ball there to avoid double-injection and visual overlap.
    if (location.hostname === 'chat.deepseek.com' || location.hostname.endsWith('.deepseek.com')) {
      return;
    }
    startChatLauncherPageLifecycle();
  },
});
