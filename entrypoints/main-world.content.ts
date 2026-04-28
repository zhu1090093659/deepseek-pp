import { installFetchHook, updateHookState } from '../core/interceptor/fetch-hook';
import { initSkillPopup } from '../core/ui/skill-popup';
import type { Memory, ModelType, Skill, SystemPromptPreset, ToolCall } from '../core/types';

export default defineContentScript({
  matches: ['*://chat.deepseek.com/*'],
  world: 'MAIN',
  runAt: 'document_start',
  main() {
    installFetchHook();

    updateHookState({
      onToolCall(call: ToolCall) {
        window.postMessage({
          source: 'deepseek-pp-main',
          type: 'TOOL_CALL',
          data: call,
        });
      },
      onResponseComplete(fullText: string) {
        window.postMessage({
          source: 'deepseek-pp-main',
          type: 'RESPONSE_COMPLETE',
          text: fullText,
        });
      },
      onMemoriesUsed(ids: number[]) {
        window.postMessage({
          source: 'deepseek-pp-main',
          type: 'MEMORIES_USED',
          ids,
        });
      },
    });

    window.addEventListener('message', (event) => {
      if (event.data?.source !== 'deepseek-pp-content') return;

      switch (event.data.type) {
        case 'SYNC_STATE': {
          const { memories, skills, activePreset, modelType } = event.data as {
            memories: Memory[];
            skills: Skill[];
            activePreset: SystemPromptPreset | null;
            modelType: ModelType;
          };
          updateHookState({ memories, skills, activePreset, modelType });
          initSkillPopup(skills);
          break;
        }
      }
    });
  },
});
