import {
  definePayloadlessRuntimeCommandHandler,
  type RuntimeCommandHandler,
} from '../../core/messaging/runtime-command-registry';
import type {
  BackgroundConfig,
  DeepSeekTheme,
  ModelType,
  PetConfig,
} from '../../core/types';
import {
  definePersistencePayloadRuntimeCommandHandler,
} from './runtime-handler';

export interface LocalPreferenceRuntimeHandlerDependencies {
  getDeepSeekTheme(): Promise<DeepSeekTheme | null>;
  saveDeepSeekTheme(theme: DeepSeekTheme): Promise<void>;
  broadcastThemeUpdate(theme: DeepSeekTheme, excludeTabId?: number): Promise<void>;
  getModelType(): Promise<ModelType>;
  setModelType(modelType: ModelType): Promise<void>;
  broadcastStateUpdate(excludeTabId?: number): Promise<void>;
  getBackgroundConfig(): Promise<BackgroundConfig | null>;
  saveBackgroundConfig(config: BackgroundConfig): Promise<void>;
  clearBackgroundConfig(): Promise<void>;
  broadcastBackgroundUpdate(config: BackgroundConfig | null): Promise<void>;
  getPetConfig(): Promise<PetConfig>;
  savePetConfig(config: PetConfig): Promise<void>;
  clearPetConfig(): Promise<void>;
  broadcastPetUpdate(config: PetConfig): Promise<void>;
}

export function createLocalPreferenceRuntimeHandlers(
  dependencies: LocalPreferenceRuntimeHandlerDependencies,
): readonly RuntimeCommandHandler[] {
  return Object.freeze([
    definePayloadlessRuntimeCommandHandler('GET_DEEPSEEK_THEME', () => (
      dependencies.getDeepSeekTheme()
    )),
    definePersistencePayloadRuntimeCommandHandler('SET_DEEPSEEK_THEME', async (payload, context) => {
      if (payload.theme !== 'light' && payload.theme !== 'dark') {
        return { ok: false as const, error: 'invalid_theme' as const };
      }
      const current = await dependencies.getDeepSeekTheme();
      if (current === payload.theme) return { ok: true as const };
      await dependencies.saveDeepSeekTheme(payload.theme);
      await dependencies.broadcastThemeUpdate(payload.theme, context.tabId);
      return { ok: true as const };
    }),
    definePayloadlessRuntimeCommandHandler('GET_MODEL_TYPE', () => (
      dependencies.getModelType()
    )),
    definePersistencePayloadRuntimeCommandHandler('SET_MODEL_TYPE', async (modelType, context) => {
      const current = await dependencies.getModelType();
      if (modelType === current) return { ok: true as const };
      await dependencies.setModelType(modelType);
      await dependencies.broadcastStateUpdate(context.tabId);
      return { ok: true as const };
    }),
    definePayloadlessRuntimeCommandHandler('GET_BACKGROUND', () => (
      dependencies.getBackgroundConfig()
    )),
    definePersistencePayloadRuntimeCommandHandler('SAVE_BACKGROUND', async (config) => {
      await dependencies.saveBackgroundConfig(config);
      await dependencies.broadcastBackgroundUpdate(config);
      return { ok: true as const };
    }),
    definePayloadlessRuntimeCommandHandler('CLEAR_BACKGROUND', async () => {
      await dependencies.clearBackgroundConfig();
      await dependencies.broadcastBackgroundUpdate(null);
      return { ok: true as const };
    }),
    definePayloadlessRuntimeCommandHandler('GET_PET', () => (
      dependencies.getPetConfig()
    )),
    definePersistencePayloadRuntimeCommandHandler('SAVE_PET', async (config) => {
      await dependencies.savePetConfig(config);
      await dependencies.broadcastPetUpdate(config);
      return { ok: true as const };
    }),
    definePayloadlessRuntimeCommandHandler('CLEAR_PET', async () => {
      await dependencies.clearPetConfig();
      await dependencies.broadcastPetUpdate(await dependencies.getPetConfig());
      return { ok: true as const };
    }),
  ]);
}
