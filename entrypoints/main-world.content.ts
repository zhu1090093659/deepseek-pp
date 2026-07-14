import {
  updateHookState,
  type RequestTerminalPayload,
  type ResponseCompletePayload,
  type ResponseTokenSpeedPayload,
} from '../core/interceptor/fetch-hook';
import { initSkillPopup, stopSkillPopup } from '../core/ui/skill-popup';
import type {
  ToolCall,
  ToolCallRestoreRecord,
} from '../core/types';
import type { ToolCallPayloadChunk } from '../core/interceptor/streaming-tool-call-parser';
import {
  replaceContentDocumentLifecycle,
} from './content/lifecycle';
import {
  createMainWorldBridgeController,
} from './content/controllers/main-world-bridge-controller';
import {
  createMainWorldInterceptorController,
} from './content/controllers/main-world-interceptor-controller';
import {
  createMainWorldNavigationController,
} from './content/controllers/main-world-navigation-controller';

export default defineContentScript({
  matches: ['*://chat.deepseek.com/*'],
  world: 'MAIN',
  runAt: 'document_start',
  async main() {
    const bridge = createMainWorldBridgeController({
      applyState(state) {
        updateHookState({ toolDescriptors: state.toolDescriptors });
        initSkillPopup(state.skillSummaries, state.skillPopupCopy);
      },
      clearState() {
        updateHookState({ toolDescriptors: [] });
        stopSkillPopup();
      },
      reportError(message, error) {
        if (error === undefined) console.error(message);
        else console.error(message, error);
      },
    });
    const navigation = createMainWorldNavigationController({
      onNavigate() {
        bridge.post({ type: 'NAVIGATION_CHANGED' });
      },
    });
    updateHookState({
      onRequestBody(body: string, requestId: string) {
        return bridge.requestAugmentedBody(body, requestId);
      },
      onHeadersCaptured(headers: Record<string, string> | null) {
        bridge.post({ type: 'HEADERS_CAPTURED', headers });
      },
      onToolCallStarted(call: ToolCall) {
        bridge.post({ type: 'TOOL_CALL_STARTED', data: call });
      },
      onToolCall(call: ToolCall) {
        bridge.post({ type: 'TOOL_CALL', data: call });
      },
      onToolCallChunk(chunk: ToolCallPayloadChunk) {
        bridge.post({ type: 'TOOL_CALL_CHUNK', data: chunk });
      },
      onToolCallsRestored(records: ToolCallRestoreRecord[]) {
        bridge.post({ type: 'RESTORE_TOOL_CALLS', records });
      },
      onResponseComplete(complete: ResponseCompletePayload) {
        bridge.post({ type: 'RESPONSE_COMPLETE', payload: complete });
      },
      onRequestTerminal(terminal: RequestTerminalPayload) {
        bridge.post({ type: 'REQUEST_TERMINAL', payload: terminal });
      },
      onResponseTokenSpeed(progress: ResponseTokenSpeedPayload) {
        bridge.post({ type: 'RESPONSE_TOKEN_SPEED', payload: progress });
      },
      onMemoriesUsed(ids: number[]) {
        bridge.post({ type: 'MEMORIES_USED', ids });
      },
    });
    await replaceContentDocumentLifecycle({
      capabilities: [bridge, navigation, createMainWorldInterceptorController()],
      onError(error) {
        console.error('[DeepSeek++] MAIN content lifecycle failed', error);
      },
    });
  },
});
