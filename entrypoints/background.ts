import {
  getAllMemories,
  getMemoryById,
  saveMemory,
  updateMemory,
  deleteMemory,
  touchMemories,
  replaceAllMemories,
  archiveStaleMemories,
} from '../core/memory/store';
import { getAllSkills, saveSkill, deleteSkill, replaceAllCustomSkills } from '../core/skill/registry';
import {
  getAllPresets,
  savePreset,
  deletePreset,
  getActivePreset,
  setActivePresetId,
  replaceAllPresets,
} from '../core/preset/store';
import { getModelType, setModelType } from '../core/model/store';
import { getBackgroundConfig, saveBackgroundConfig, clearBackgroundConfig } from '../core/background/store';
import { getSyncConfig, saveSyncConfig } from '../core/sync/config';
import { webdavTest, webdavMkcol, webdavGet, webdavPut } from '../core/sync/webdav-client';
import { mergeMemories, mergeSkills, mergePresets } from '../core/sync/merge';
import type { BackgroundConfig, Memory, ModelType, Skill, SyncConfig, SystemPromptPreset } from '../core/types';

export default defineBackground(() => {
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch(() => {});

  archiveStaleMemories().catch(() => {});

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

    case 'GET_MEMORY_BY_ID': {
      const { id: memId } = message.payload as { id: number };
      return getMemoryById(memId) ?? null;
    }

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

    case 'GET_PRESETS':
      return getAllPresets();

    case 'SAVE_PRESET': {
      await savePreset(message.payload as SystemPromptPreset);
      await broadcastStateUpdate(sender.tab?.id);
      return { ok: true };
    }

    case 'DELETE_PRESET': {
      const { id: presetId } = message.payload as { id: string };
      await deletePreset(presetId);
      await broadcastStateUpdate(sender.tab?.id);
      return { ok: true };
    }

    case 'SET_ACTIVE_PRESET': {
      const { id: activeId } = message.payload as { id: string | null };
      await setActivePresetId(activeId);
      await broadcastStateUpdate(sender.tab?.id);
      return { ok: true };
    }

    case 'GET_ACTIVE_PRESET':
      return getActivePreset();

    case 'GET_CONFIG':
      return { version: '0.1.0' };

    case 'GET_MODEL_TYPE':
      return getModelType();

    case 'SET_MODEL_TYPE': {
      const newModelType = message.payload as ModelType;
      const current = await getModelType();
      if (newModelType === current) return { ok: true };
      await setModelType(newModelType);
      await broadcastStateUpdate(sender.tab?.id);
      return { ok: true };
    }

    case 'GET_BACKGROUND':
      return getBackgroundConfig();

    case 'SAVE_BACKGROUND': {
      const bgConfig = message.payload as BackgroundConfig;
      await saveBackgroundConfig(bgConfig);
      await broadcastBackgroundUpdate(bgConfig);
      return { ok: true };
    }

    case 'CLEAR_BACKGROUND': {
      await clearBackgroundConfig();
      await broadcastBackgroundUpdate(null);
      return { ok: true };
    }

    case 'GET_SYNC_CONFIG':
      return getSyncConfig();

    case 'SAVE_SYNC_CONFIG': {
      await saveSyncConfig(message.payload as SyncConfig);
      return { ok: true };
    }

    case 'WEBDAV_TEST': {
      await webdavTest(message.payload as SyncConfig);
      return { ok: true };
    }

    case 'WEBDAV_SYNC': {
      const config = await getSyncConfig();
      if (!config) throw new Error('未配置 WebDAV');

      await webdavMkcol(config);

      const [localMemories, allSkills, localPresets] = await Promise.all([
        getAllMemories(),
        getAllSkills(),
        getAllPresets(),
      ]);
      const localSkills = allSkills.filter((s) => s.source === 'custom');

      const [remoteMemJson, remoteSkillJson, remotePresetJson] = await Promise.all([
        webdavGet(config, 'memories.json'),
        webdavGet(config, 'skills.json'),
        webdavGet(config, 'presets.json'),
      ]);

      const remoteMemories: Memory[] = remoteMemJson ? JSON.parse(remoteMemJson) : [];
      const remoteSkills: Skill[] = remoteSkillJson ? JSON.parse(remoteSkillJson) : [];
      const remotePresets: SystemPromptPreset[] = remotePresetJson ? JSON.parse(remotePresetJson) : [];

      const mergedMemories = mergeMemories(localMemories, remoteMemories);
      const mergedSkills = mergeSkills(localSkills, remoteSkills);
      const mergedPresets = mergePresets(localPresets, remotePresets);

      await Promise.all([
        replaceAllMemories(mergedMemories),
        replaceAllCustomSkills(mergedSkills),
        replaceAllPresets(mergedPresets),
      ]);

      await Promise.all([
        webdavPut(config, 'memories.json', JSON.stringify(mergedMemories)),
        webdavPut(config, 'skills.json', JSON.stringify(mergedSkills)),
        webdavPut(config, 'presets.json', JSON.stringify(mergedPresets)),
      ]);

      const now = Date.now();
      await saveSyncConfig({ ...config, lastSyncAt: now });
      await broadcastStateUpdate(sender.tab?.id);
      return { ok: true, lastSyncAt: now };
    }

    default:
      return null;
  }
}

async function broadcastToTabs(payload: Record<string, unknown>, excludeTabId?: number) {
  const tabs = await chrome.tabs.query({ url: '*://chat.deepseek.com/*' });
  for (const tab of tabs) {
    if (tab.id && tab.id !== excludeTabId) {
      chrome.tabs.sendMessage(tab.id, payload).catch(() => {});
    }
  }
  if (excludeTabId) {
    chrome.tabs.sendMessage(excludeTabId, payload).catch(() => {});
  }
}

async function broadcastStateUpdate(excludeTabId?: number) {
  const [memories, skills, activePreset, modelType] = await Promise.all([
    getAllMemories(),
    getAllSkills(),
    getActivePreset(),
    getModelType(),
  ]);
  await broadcastToTabs({ type: 'STATE_UPDATED', memories, skills, activePreset, modelType }, excludeTabId);
}

async function broadcastBackgroundUpdate(config: BackgroundConfig | null) {
  await broadcastToTabs({ type: 'BACKGROUND_UPDATED', config });
}
