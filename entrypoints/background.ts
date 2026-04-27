import {
  getAllMemories,
  saveMemory,
  updateMemory,
  deleteMemory,
  touchMemories,
} from '../core/memory/store';
import { getAllSkills, saveSkill, deleteSkill } from '../core/skill/registry';
import type { Memory, Skill } from '../core/types';

export default defineBackground(() => {
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch(() => {});

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    handleMessage(message, sender)
      .then(sendResponse)
      .catch(() => sendResponse(null));
    return true;
  });
});

async function handleMessage(
  message: { type: string; payload?: unknown },
  sender: chrome.runtime.MessageSender,
) {
  switch (message.type) {
    case 'GET_MEMORIES':
      return getAllMemories();

    case 'SAVE_MEMORY': {
      const id = await saveMemory(message.payload as Omit<Memory, 'id' | 'createdAt' | 'updatedAt' | 'accessCount' | 'lastAccessedAt'>);
      await broadcastStateUpdate(sender.tab?.id);
      return { id };
    }

    case 'UPDATE_MEMORY': {
      await updateMemory(message.payload as Memory);
      await broadcastStateUpdate(sender.tab?.id);
      return { ok: true };
    }

    case 'DELETE_MEMORY': {
      const { id } = message.payload as { id: number };
      await deleteMemory(id);
      await broadcastStateUpdate(sender.tab?.id);
      return { ok: true };
    }

    case 'TOUCH_MEMORIES': {
      const { ids } = message.payload as { ids: number[] };
      await touchMemories(ids);
      return { ok: true };
    }

    case 'GET_SKILLS':
      return getAllSkills();

    case 'SAVE_SKILL': {
      await saveSkill(message.payload as Skill);
      await broadcastStateUpdate(sender.tab?.id);
      return { ok: true };
    }

    case 'DELETE_SKILL': {
      const { name } = message.payload as { name: string };
      await deleteSkill(name);
      await broadcastStateUpdate(sender.tab?.id);
      return { ok: true };
    }

    case 'GET_CONFIG':
      return { version: '0.1.0' };

    default:
      return null;
  }
}

async function broadcastStateUpdate(excludeTabId?: number) {
  const [memories, skills] = await Promise.all([getAllMemories(), getAllSkills()]);
  const tabs = await chrome.tabs.query({ url: '*://chat.deepseek.com/*' });

  for (const tab of tabs) {
    if (tab.id && tab.id !== excludeTabId) {
      chrome.tabs.sendMessage(tab.id, {
        type: 'STATE_UPDATED',
        memories,
        skills,
      }).catch(() => {});
    }
  }

  if (excludeTabId) {
    chrome.tabs.sendMessage(excludeTabId, {
      type: 'STATE_UPDATED',
      memories,
      skills,
    }).catch(() => {});
  }
}
