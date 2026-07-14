import type { SupportedLocale } from '../../core/i18n';
import {
  definePayloadlessRuntimeCommandHandler,
  type RuntimeCommandHandler,
} from '../../core/messaging/runtime-command-registry';
import type {
  GitHubSkillImportRequest,
  GitHubSkillImportResult,
  GitHubSkillPreview,
  GitHubSkillUpdatePreview,
  LocalSkillImportRequest,
  LocalSkillImportResponse,
  LocalSkillPreview,
  SaveSkillPayload,
  Skill,
  SkillImportSource,
} from '../../core/types';
import {
  definePersistencePayloadRuntimeCommandHandler,
} from './runtime-handler';

export interface SkillRuntimeHandlerDependencies {
  getLocale(): SupportedLocale;
  getAllSkills(locale: SupportedLocale): Promise<Skill[]>;
  getSkillLibrary(locale: SupportedLocale): Promise<Skill[]>;
  getAllSkillSources(): Promise<SkillImportSource[]>;
  saveSkill(skill: Skill, previousName?: string): Promise<void>;
  deleteSkill(name: string): Promise<void>;
  setSkillEnabled(name: string, enabled: boolean): Promise<void>;
  setSkillsEnabled(updates: Array<{ name: string; enabled: boolean }>): Promise<void>;
  previewGitHubSkillSource(url: string): Promise<GitHubSkillPreview>;
  importGitHubSkillSource(request: GitHubSkillImportRequest): Promise<GitHubSkillImportResult>;
  previewLocalSkillSource(rootPath: string): Promise<LocalSkillPreview>;
  pickLocalSkillFolder(defaultPath?: string): Promise<string>;
  importLocalSkillSource(request: LocalSkillImportRequest): Promise<LocalSkillImportResponse>;
  checkGitHubSkillSourceUpdates(sourceId: string): Promise<GitHubSkillUpdatePreview>;
  updateGitHubSkillSource(sourceId: string): Promise<GitHubSkillImportResult>;
  deleteGitHubSkillSource(sourceId: string): Promise<void>;
  broadcastStateUpdate(excludeTabId?: number): Promise<void>;
}

export function createSkillRuntimeHandlers(
  dependencies: SkillRuntimeHandlerDependencies,
): readonly RuntimeCommandHandler[] {
  return Object.freeze([
    definePayloadlessRuntimeCommandHandler('GET_SKILLS', () => (
      dependencies.getAllSkills(dependencies.getLocale())
    )),
    definePayloadlessRuntimeCommandHandler('GET_SKILL_LIBRARY', () => (
      dependencies.getSkillLibrary(dependencies.getLocale())
    )),
    definePayloadlessRuntimeCommandHandler('GET_SKILL_SOURCES', () => (
      dependencies.getAllSkillSources()
    )),
    definePayloadlessRuntimeCommandHandler('GET_GITHUB_SKILL_SOURCES', async () => (
      (await dependencies.getAllSkillSources()).filter((source) => source.provider === 'github')
    )),
    definePersistencePayloadRuntimeCommandHandler('SAVE_SKILL', async (payload, context) => {
      const { skill, previousName } = splitSaveSkillPayload(payload);
      await dependencies.saveSkill(skill, previousName);
      await dependencies.broadcastStateUpdate(context.tabId);
      return { ok: true as const };
    }),
    definePersistencePayloadRuntimeCommandHandler('DELETE_SKILL', async (payload, context) => {
      await dependencies.deleteSkill(payload.name);
      await dependencies.broadcastStateUpdate(context.tabId);
      return { ok: true as const };
    }),
    definePersistencePayloadRuntimeCommandHandler('SET_SKILL_ENABLED', async (payload, context) => {
      await dependencies.setSkillEnabled(payload.name, payload.enabled);
      await dependencies.broadcastStateUpdate(context.tabId);
      return { ok: true as const };
    }),
    definePersistencePayloadRuntimeCommandHandler('SET_SKILLS_ENABLED', async (payload, context) => {
      await dependencies.setSkillsEnabled(payload.updates);
      await dependencies.broadcastStateUpdate(context.tabId);
      return { ok: true as const };
    }),
    definePersistencePayloadRuntimeCommandHandler('PREVIEW_GITHUB_SKILL_SOURCE', (payload) => (
      dependencies.previewGitHubSkillSource(payload.url)
    )),
    definePersistencePayloadRuntimeCommandHandler('IMPORT_GITHUB_SKILL_SOURCE', async (request, context) => {
      const result = await dependencies.importGitHubSkillSource(request);
      await dependencies.broadcastStateUpdate(context.tabId);
      return result;
    }),
    definePersistencePayloadRuntimeCommandHandler('PREVIEW_LOCAL_SKILL_SOURCE', (payload) => (
      dependencies.previewLocalSkillSource(payload.rootPath)
    )),
    definePersistencePayloadRuntimeCommandHandler('PICK_LOCAL_SKILL_FOLDER', async (payload) => ({
      path: await dependencies.pickLocalSkillFolder(payload?.defaultPath),
    })),
    definePersistencePayloadRuntimeCommandHandler('IMPORT_LOCAL_SKILL_SOURCE', async (request, context) => {
      const result = await dependencies.importLocalSkillSource(request);
      if (!result.ok) return result;
      await dependencies.broadcastStateUpdate(context.tabId);
      return result;
    }),
    definePersistencePayloadRuntimeCommandHandler('CHECK_GITHUB_SKILL_SOURCE_UPDATES', (payload) => (
      dependencies.checkGitHubSkillSourceUpdates(payload.sourceId)
    )),
    definePersistencePayloadRuntimeCommandHandler('UPDATE_GITHUB_SKILL_SOURCE', async (payload, context) => {
      const result = await dependencies.updateGitHubSkillSource(payload.sourceId);
      await dependencies.broadcastStateUpdate(context.tabId);
      return result;
    }),
    definePersistencePayloadRuntimeCommandHandler('DELETE_GITHUB_SKILL_SOURCE', async (payload, context) => {
      await dependencies.deleteGitHubSkillSource(payload.sourceId);
      await dependencies.broadcastStateUpdate(context.tabId);
      return { ok: true as const };
    }),
  ]);
}

function splitSaveSkillPayload(payload: SaveSkillPayload): {
  skill: Skill;
  previousName?: string;
} {
  if ('skill' in payload) {
    return {
      skill: payload.skill,
      previousName: payload.previousName,
    };
  }
  return { skill: payload };
}
