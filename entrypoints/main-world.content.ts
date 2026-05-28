import { installFetchHook, updateHookState, type ResponseCompletePayload } from '../core/interceptor/fetch-hook';
import { initSkillPopup } from '../core/ui/skill-popup';
import type {
  Memory,
  ModelType,
  Skill,
  SystemPromptPreset,
  ToolCall,
  ToolCallRestoreRecord,
  ToolDescriptor,
  ToolResult,
} from '../core/types';
import {
  AUTOMATION_WINDOW_RUN_RESULT,
  MAIN_WORLD_WINDOW_SOURCE,
  createAutomationRunnerFailure,
  isAutomationWindowRunRequestMessage,
} from '../core/automation/messages';
import { runDeepSeekAutomation } from '../core/automation/runner';
import type { AutomationRunnerRequest, AutomationRunnerResult } from '../core/automation/types';

// Weak anti-spoofing nonce: blocks low-cost postMessage forgery but does NOT
// provide cryptographic authentication. The nonce is stored in a DOM attribute
// readable by page scripts. Main security boundary is background service worker.
const DPP_NONCE_ATTR = 'data-dpp-nonce';

function generateNonce(): string {
  const array = new Uint8Array(16);
  crypto.getRandomValues(array);
  return Array.from(array, (b) => b.toString(16).padStart(2, '0')).join('');
}

export default defineContentScript({
  matches: ['*://chat.deepseek.com/*'],
  world: 'MAIN',
  runAt: 'document_start',
  main() {
    const nonce = generateNonce();
    if (document.documentElement) {
      document.documentElement.setAttribute(DPP_NONCE_ATTR, nonce);
    }

    installFetchHook();

    updateHookState({
      onToolCall(call: ToolCall) {
        window.postMessage({
          source: 'deepseek-pp-main',
          nonce,
          type: 'TOOL_CALL',
          data: call,
        });
      },
      async onToolCallExecuted(call: ToolCall) {
        return new Promise((resolve) => {
          const id = Math.random().toString(36).slice(2);
          const handler = (event: MessageEvent) => {
            if (event.data?.source !== 'deepseek-pp-content') return;
            if (event.data.type !== 'TOOL_CALL_RESULT' || event.data.id !== id) return;
            window.removeEventListener('message', handler);
            resolve(event.data.result);
          };
          window.addEventListener('message', handler);
          window.postMessage({
            source: 'deepseek-pp-main',
            nonce,
            type: 'EXECUTE_TOOL_CALL',
            data: call,
            id,
          });
        });
      },
      onToolCallsRestored(records: ToolCallRestoreRecord[]) {
        window.postMessage({
          source: 'deepseek-pp-main',
          nonce,
          type: 'RESTORE_TOOL_CALLS',
          records,
        });
      },
      onResponseComplete(complete: ResponseCompletePayload) {
        window.postMessage({
          source: 'deepseek-pp-main',
          nonce,
          type: 'RESPONSE_COMPLETE',
          payload: complete,
        });
      },
      onMemoriesUsed(ids: number[]) {
        window.postMessage({
          source: 'deepseek-pp-main',
          nonce,
          type: 'MEMORIES_USED',
          ids,
        });
      },
    });

    window.addEventListener('message', (event) => {
      if (event.data?.source !== 'deepseek-pp-content') return;

      if (isAutomationWindowRunRequestMessage(event.data)) {
        void handleAutomationRunRequest(event.data.id, event.data.payload);
        return;
      }

      switch (event.data.type) {
        case 'SYNC_STATE': {
          const { memories, skills, activePreset, modelType, toolDescriptors } = event.data as {
            memories: Memory[];
            skills: Skill[];
            activePreset: SystemPromptPreset | null;
            modelType: ModelType;
            toolDescriptors?: ToolDescriptor[];
          };
          updateHookState({ memories, skills, activePreset, modelType, ...(toolDescriptors ? { toolDescriptors } : {}) });
          initSkillPopup(skills);
          break;
        }
        case 'CONTINUE_WITH_TOOL_RESULTS': {
          void handleManualToolContinuation(event.data.id, event.data.payload);
          break;
        }
      }
    });
  },
});

async function handleAutomationRunRequest(id: string, request: AutomationRunnerRequest) {
  const result = await runAutomationInMainWorld(request).catch((err): AutomationRunnerResult =>
    createAutomationRunnerFailure(
      request,
      'automation_main_world_failed',
      err instanceof Error ? err.message : String(err),
      'runner',
      true,
    ),
  );

  window.postMessage({
    source: MAIN_WORLD_WINDOW_SOURCE,
    nonce,
    type: AUTOMATION_WINDOW_RUN_RESULT,
    id,
    result,
  });
}

async function handleManualToolContinuation(id: string, request: AutomationRunnerRequest) {
  const result = await runDeepSeekAutomation(request).catch((err): AutomationRunnerResult =>
    createAutomationRunnerFailure(
      request,
      'manual_tool_continuation_failed',
      err instanceof Error ? err.message : String(err),
      'runner',
      true,
    ),
  );

  window.postMessage({
    source: MAIN_WORLD_WINDOW_SOURCE,
    nonce,
    type: 'MANUAL_TOOL_CONTINUATION_RESULT',
    id,
    result,
  });
}

async function runAutomationInMainWorld(request: AutomationRunnerRequest): Promise<AutomationRunnerResult> {
  return runDeepSeekAutomation(request, {
    executeToolCall: executeToolCallViaContent,
  });
}

function executeToolCallViaContent(call: ToolCall): Promise<ToolResult> {
  return new Promise((resolve) => {
    const id = Math.random().toString(36).slice(2);
    const handler = (event: MessageEvent) => {
      if (event.data?.source !== 'deepseek-pp-content') return;
      if (event.data.type !== 'TOOL_CALL_RESULT' || event.data.id !== id) return;
      window.removeEventListener('message', handler);
      resolve(event.data.result as ToolResult);
    };
    window.addEventListener('message', handler);
    window.postMessage({
      source: 'deepseek-pp-main',
      nonce,
      type: 'EXECUTE_TOOL_CALL',
      data: call,
      id,
    });
  });
}
