import {
  installFetchHook,
  updateHookState,
  type ResponseCompletePayload,
  type ResponseTokenSpeedPayload,
} from '../core/interceptor/fetch-hook';
import { initSkillPopup } from '../core/ui/skill-popup';
import type {
  Memory,
  ModelType,
  Skill,
  SystemPromptPreset,
  ToolCall,
  ToolCallRestoreRecord,
  ToolDescriptor,
  ToolExecutionRecord,
  ToolResult,
} from '../core/types';
import { runInlineAgentLoop } from '../core/inline-agent/loop';
import type { InlineAgentStartPayload } from '../core/inline-agent/types';

const MAIN_WORLD_SOURCE = 'deepseek-pp-main';
const TOOL_BRIDGE_TIMEOUT_MS = 120_000;

let activeAgentAbort: AbortController | null = null;

export default defineContentScript({
  matches: ['*://chat.deepseek.com/*'],
  world: 'MAIN',
  runAt: 'document_start',
  main() {
    installFetchHook();

    updateHookState({
      onToolCall(call: ToolCall) {
        window.postMessage({ source: MAIN_WORLD_SOURCE, type: 'TOOL_CALL', data: call });
      },
      async onToolCallExecuted(call: ToolCall) {
        return executeToolCallViaContent(call);
      },
      onToolCallsRestored(records: ToolCallRestoreRecord[]) {
        window.postMessage({ source: MAIN_WORLD_SOURCE, type: 'RESTORE_TOOL_CALLS', records });
      },
      onResponseComplete(complete: ResponseCompletePayload) {
        window.postMessage({ source: MAIN_WORLD_SOURCE, type: 'RESPONSE_COMPLETE', payload: complete });
      },
      onResponseTokenSpeed(progress: ResponseTokenSpeedPayload) {
        window.postMessage({ source: MAIN_WORLD_SOURCE, type: 'RESPONSE_TOKEN_SPEED', payload: progress });
      },
      onMemoriesUsed(ids: number[]) {
        window.postMessage({ source: MAIN_WORLD_SOURCE, type: 'MEMORIES_USED', ids });
      },
    });

    window.addEventListener('message', (event) => {
      if (event.origin !== window.location.origin) return;
      if (event.data?.source !== 'deepseek-pp-content') return;

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
        case 'START_INLINE_AGENT_LOOP': {
          void handleStartInlineAgentLoop(event.data.payload as InlineAgentStartPayload);
          break;
        }
        case 'STOP_INLINE_AGENT_LOOP': {
          handleStopInlineAgentLoop();
          break;
        }
        case 'TOOL_CALL_RESULT': {
          break;
        }
      }
    });
  },
});

async function handleStartInlineAgentLoop(payload: InlineAgentStartPayload): Promise<void> {
  if (activeAgentAbort) activeAgentAbort.abort();

  const abort = new AbortController();
  activeAgentAbort = abort;

  const post = (type: string, data: unknown) => {
    window.postMessage({ source: MAIN_WORLD_SOURCE, type, data });
  };

  const executeTool = async (call: ToolCall): Promise<ToolExecutionRecord> => {
    const enrichedCall: ToolCall = {
      ...call,
      source: {
        trigger: 'agent_run',
        chatSessionId: payload.chatSessionId,
        runId: payload.loopId,
      },
    };
    const result = await executeToolCallViaContent(enrichedCall);
    return {
      name: call.name,
      result: {
        ok: result.ok,
        summary: result.summary,
        detail: result.detail,
        output: result.output,
        error: result.error,
        truncated: result.truncated,
      },
      provider: call.provider,
      descriptorId: call.descriptorId,
    };
  };

  await runInlineAgentLoop(payload, { post, executeTool, signal: abort.signal });
  if (activeAgentAbort === abort) activeAgentAbort = null;
}

function handleStopInlineAgentLoop(): void {
  if (activeAgentAbort) {
    activeAgentAbort.abort();
    activeAgentAbort = null;
  }
}

function executeToolCallViaContent(call: ToolCall): Promise<ToolResult> {
  return new Promise((resolve) => {
    const id = Math.random().toString(36).slice(2);
    const timeout = setTimeout(() => {
      window.removeEventListener('message', handler);
      resolve({ ok: false, summary: 'Tool execution timed out (bridge timeout)' });
    }, TOOL_BRIDGE_TIMEOUT_MS);
    const handler = (event: MessageEvent) => {
      if (event.data?.source !== 'deepseek-pp-content') return;
      if (event.data.type !== 'TOOL_CALL_RESULT' || event.data.id !== id) return;
      clearTimeout(timeout);
      window.removeEventListener('message', handler);
      resolve(event.data.result as ToolResult);
    };
    window.addEventListener('message', handler);
    window.postMessage({
      source: MAIN_WORLD_SOURCE,
      type: 'EXECUTE_TOOL_CALL',
      data: call,
      id,
    });
  });
}
