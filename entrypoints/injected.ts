import { installFetchHook, updateHookState } from '../core/interceptor/fetch-hook';
import { initSkillPopup, updatePopupSkills } from '../core/ui/skill-popup';
import type { Memory, Skill, ToolCall } from '../core/types';

export default defineUnlistedScript(() => {
  installFetchHook();

  let popupInited = false;

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
  });

  window.addEventListener('message', (event) => {
    if (event.data?.source !== 'deepseek-pp-content') return;

    switch (event.data.type) {
      case 'SYNC_STATE': {
        const { memories, skills } = event.data as {
          memories: Memory[];
          skills: Skill[];
        };
        updateHookState({ memories, skills });
        if (!popupInited) {
          popupInited = true;
          initSkillPopup(skills);
        } else {
          updatePopupSkills(skills);
        }
        break;
      }
    }
  });
});
