import {
  definePayloadlessRuntimeCommandHandler,
  type RuntimeCommandHandler,
} from '../../core/messaging/runtime-command-registry';
import type {
  SavedItem,
  SavedItemInput,
  SystemPromptPreset,
} from '../../core/types';
import type { PromptInjectionSettings } from '../../core/prompt/settings';
import type { VoiceCapabilityState, VoiceSettings } from '../../core/voice/settings';
import {
  definePersistencePayloadRuntimeCommandHandler,
} from './runtime-handler';

type AckOrFailure = { ok: true } | { ok: false; error: string };

export interface LibraryRuntimeHandlerDependencies {
  getAllPresets(): Promise<SystemPromptPreset[]>;
  savePreset(preset: SystemPromptPreset): Promise<void>;
  deletePreset(id: string): Promise<void>;
  setActivePresetId(id: string | null): Promise<void>;
  getActivePreset(): Promise<SystemPromptPreset | null>;
  getPromptInjectionSettings(): Promise<PromptInjectionSettings>;
  savePromptInjectionSettings(settings: Partial<PromptInjectionSettings>): Promise<PromptInjectionSettings>;
  getAllSavedItems(): Promise<SavedItem[]>;
  saveSavedItem(input: SavedItemInput): Promise<SavedItem>;
  deleteSavedItem(id: string): Promise<void>;
  insertPromptIntoActiveDeepSeekTab(text: string): Promise<AckOrFailure>;
  getVoiceSettings(): Promise<VoiceSettings>;
  saveVoiceSettings(settings: Partial<VoiceSettings>): Promise<VoiceSettings>;
  detectVoiceCapabilities(): VoiceCapabilityState;
  broadcastStateUpdate(excludeTabId?: number): Promise<void>;
  broadcastSavedItemsUpdate(excludeTabId?: number): Promise<void>;
  broadcastVoiceSettingsUpdate(excludeTabId?: number): Promise<void>;
}

export function createLibraryRuntimeHandlers(
  dependencies: LibraryRuntimeHandlerDependencies,
): readonly RuntimeCommandHandler[] {
  return Object.freeze([
    definePayloadlessRuntimeCommandHandler('GET_PRESETS', () => (
      dependencies.getAllPresets()
    )),
    definePersistencePayloadRuntimeCommandHandler('SAVE_PRESET', async (preset, context) => {
      await dependencies.savePreset(preset);
      await dependencies.broadcastStateUpdate(context.tabId);
      return { ok: true as const };
    }),
    definePersistencePayloadRuntimeCommandHandler('DELETE_PRESET', async (payload, context) => {
      await dependencies.deletePreset(payload.id);
      await dependencies.broadcastStateUpdate(context.tabId);
      return { ok: true as const };
    }),
    definePersistencePayloadRuntimeCommandHandler('SET_ACTIVE_PRESET', async (payload, context) => {
      await dependencies.setActivePresetId(payload.id);
      await dependencies.broadcastStateUpdate(context.tabId);
      return { ok: true as const };
    }),
    definePayloadlessRuntimeCommandHandler('GET_ACTIVE_PRESET', () => (
      dependencies.getActivePreset()
    )),
    definePayloadlessRuntimeCommandHandler('GET_PROMPT_INJECTION_SETTINGS', () => (
      dependencies.getPromptInjectionSettings()
    )),
    definePersistencePayloadRuntimeCommandHandler('SAVE_PROMPT_INJECTION_SETTINGS', async (settings, context) => {
      const saved = await dependencies.savePromptInjectionSettings(settings);
      await dependencies.broadcastStateUpdate(context.tabId);
      return saved;
    }),
    definePayloadlessRuntimeCommandHandler('GET_SAVED_ITEMS', () => (
      dependencies.getAllSavedItems()
    )),
    definePersistencePayloadRuntimeCommandHandler('SAVE_SAVED_ITEM', async (input, context) => {
      const item = await dependencies.saveSavedItem(input);
      await dependencies.broadcastSavedItemsUpdate(context.tabId);
      return item;
    }),
    definePersistencePayloadRuntimeCommandHandler('DELETE_SAVED_ITEM', async (payload, context) => {
      await dependencies.deleteSavedItem(payload.id);
      await dependencies.broadcastSavedItemsUpdate(context.tabId);
      return { ok: true as const };
    }),
    definePersistencePayloadRuntimeCommandHandler('INSERT_SAVED_PROMPT_INTO_CHAT', (payload) => (
      dependencies.insertPromptIntoActiveDeepSeekTab(
        typeof payload?.text === 'string' ? payload.text : '',
      )
    )),
    definePayloadlessRuntimeCommandHandler('GET_VOICE_SETTINGS', () => (
      dependencies.getVoiceSettings()
    )),
    definePersistencePayloadRuntimeCommandHandler('SAVE_VOICE_SETTINGS', async (settings, context) => {
      const saved = await dependencies.saveVoiceSettings(settings);
      await dependencies.broadcastVoiceSettingsUpdate(context.tabId);
      return saved;
    }),
    definePayloadlessRuntimeCommandHandler('GET_VOICE_CAPABILITIES', () => (
      dependencies.detectVoiceCapabilities()
    )),
  ]);
}
