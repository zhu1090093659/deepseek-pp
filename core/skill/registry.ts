import type { GitHubSkillSource, LocalSkillSource, Skill, SkillImportSource } from '../types';
import { DEFAULT_LOCALE, type SupportedLocale } from '../i18n';
import { withSyncLocalStateLock } from '../persistence/local-state-lock';
import { BUILTIN_SKILLS, getLocalizedBuiltinSkills } from './builtin';

export const SKILLS_STORAGE_KEY = 'deepseek_pp_skills';
export const SKILL_SOURCES_STORAGE_KEY = 'deepseek_pp_skill_sources';
const BUNDLED_ENABLED_STORAGE_KEY = 'deepseek_pp_bundled_skill_enabled';

const USER_SKILL_SOURCES = new Set(['custom', 'remote']);
const TOGGLEABLE_BUNDLED_SKILL_SOURCES = new Set(['third-party', 'official']);

export async function getAllSkills(
  options: { includeDisabled?: boolean; locale?: SupportedLocale } = {},
): Promise<Skill[]> {
  const [userSkills, bundledEnabled] = await Promise.all([
    getUserSkills(),
    getBundledSkillEnabledOverrides(),
  ]);
  const skills = [
    ...applyBundledSkillEnabledOverrides(
      getLocalizedBuiltinSkills(options.locale ?? DEFAULT_LOCALE),
      bundledEnabled,
    ),
    ...userSkills,
  ];
  if (options.includeDisabled) return skills;
  return skills.filter((skill) => skill.enabled !== false);
}

export async function getSkillLibrary(locale: SupportedLocale = DEFAULT_LOCALE): Promise<Skill[]> {
  return getAllSkills({ includeDisabled: true, locale });
}

export async function getUserSkills(): Promise<Skill[]> {
  const data = await chrome.storage.local.get(SKILLS_STORAGE_KEY) as Record<string, unknown>;
  const storedSkills = data[SKILLS_STORAGE_KEY];
  return normalizeStoredSkills(storedSkills);
}

export async function saveSkill(skill: Skill, previousName?: string): Promise<void> {
  await withSyncLocalStateLock(async () => {
    const userSkills = await getUserSkills();
    const custom = userSkills.filter((s) => s.source === 'custom');
    const namesToReplace = new Set<string>([skill.name]);
    if (previousName) namesToReplace.add(previousName);

    const previousIndex = previousName ? custom.findIndex((s) => s.name === previousName) : -1;
    const currentIndex = custom.findIndex((s) => s.name === skill.name);
    const insertIndex = previousIndex >= 0 ? previousIndex : currentIndex;
    const next = custom.filter((s) => !namesToReplace.has(s.name));
    const remote = userSkills.filter((s) => s.source === 'remote');
    const savedSkill = { ...skill, source: 'custom' as const, enabled: skill.enabled !== false };

    if (insertIndex >= 0) {
      next.splice(Math.min(insertIndex, next.length), 0, savedSkill);
    } else {
      next.push(savedSkill);
    }
    await chrome.storage.local.set({ [SKILLS_STORAGE_KEY]: [...next, ...remote] });
  });
}

export async function deleteSkill(name: string): Promise<void> {
  await withSyncLocalStateLock(async () => {
    const userSkills = await getUserSkills();
    const removed = userSkills.find((s) => s.name === name);
    const next = userSkills.filter((s) => s.name !== name);
    await chrome.storage.local.set({ [SKILLS_STORAGE_KEY]: next });

    if (removed?.source === 'remote' && removed.remote) {
      await removeRemoteSkillFromSource(removed.remote.sourceId, removed.remote.path, removed.name);
    }
  });
}

export async function replaceAllCustomSkills(skills: Skill[]): Promise<void> {
  await withSyncLocalStateLock(() => replaceAllCustomSkillsForSyncApply(skills));
}

export async function replaceAllCustomSkillsForSyncApply(skills: Skill[]): Promise<void> {
  const userSkills = skills
    .filter((s) => USER_SKILL_SOURCES.has(s.source))
    .map((s) => ({
      ...s,
      source: s.source === 'remote' ? 'remote' as const : 'custom' as const,
      enabled: s.enabled !== false,
    }));
  await chrome.storage.local.set({ [SKILLS_STORAGE_KEY]: userSkills });
}

export async function setSkillEnabled(name: string, enabled: boolean): Promise<void> {
  await setSkillsEnabled([{ name, enabled }]);
}

export async function setSkillsEnabled(updates: Array<{ name: string; enabled: boolean }>): Promise<void> {
  if (updates.length === 0) return;

  await withSyncLocalStateLock(() => setSkillsEnabledUnlocked(updates));
}

async function setSkillsEnabledUnlocked(updates: Array<{ name: string; enabled: boolean }>): Promise<void> {
  const updateByName = new Map<string, boolean>();
  for (const update of updates) {
    updateByName.set(update.name, update.enabled);
  }

  const userSkills = await getUserSkills();
  let userSkillsChanged = false;
  const next = userSkills.map((skill) => {
    if (!updateByName.has(skill.name)) return skill;
    const enabled = updateByName.get(skill.name) ?? true;
    updateByName.delete(skill.name);
    userSkillsChanged = true;
    return { ...skill, enabled };
  });

  const bundledUpdates: Record<string, boolean> = {};
  for (const [name, enabled] of updateByName) {
    const bundledSkill = BUILTIN_SKILLS.find((skill) => (
      skill.name === name &&
      TOGGLEABLE_BUNDLED_SKILL_SOURCES.has(skill.source)
    ));
    if (!bundledSkill) throw new Error(`Skill cannot be enabled or disabled because it was not found: ${name}`);
    bundledUpdates[name] = enabled;
  }

  if (Object.keys(bundledUpdates).length === 0) {
    if (!userSkillsChanged) return;
    await chrome.storage.local.set({ [SKILLS_STORAGE_KEY]: next });
    return;
  }

  const bundledEnabled = await getBundledSkillEnabledOverrides();
  const patch: Record<string, unknown> = {
    [BUNDLED_ENABLED_STORAGE_KEY]: {
      ...bundledEnabled,
      ...bundledUpdates,
    },
  };
  if (userSkillsChanged) patch[SKILLS_STORAGE_KEY] = next;
  await chrome.storage.local.set({
    ...patch,
  });
}

export async function getAllSkillSources(): Promise<SkillImportSource[]> {
  const data = await chrome.storage.local.get(SKILL_SOURCES_STORAGE_KEY) as Record<string, unknown>;
  const storedSources = data[SKILL_SOURCES_STORAGE_KEY];
  if (!Array.isArray(storedSources)) return [];
  return storedSources.filter(isSkillImportSource);
}

export async function getSkillSourceById(sourceId: string): Promise<SkillImportSource | null> {
  const sources = await getAllSkillSources();
  return sources.find((source) => source.id === sourceId) ?? null;
}

export async function getGitHubSkillSourceById(sourceId: string): Promise<GitHubSkillSource | null> {
  const source = await getSkillSourceById(sourceId);
  return source?.provider === 'github' ? source : null;
}

export async function saveGitHubSkillSource(source: GitHubSkillSource): Promise<void> {
  await withSyncLocalStateLock(async () => {
    const sources = await getAllSkillSources();
    await chrome.storage.local.set({
      [SKILL_SOURCES_STORAGE_KEY]: [
        ...sources.filter((item) => item.id !== source.id),
        source,
      ],
    });
  });
}

export async function upsertGitHubSkillSource(
  source: GitHubSkillSource,
  incomingSkills: Skill[],
): Promise<{ imported: Skill[]; replaced: number; renamed: number }> {
  return upsertImportedSkillSource(source, incomingSkills);
}

export async function upsertLocalSkillSource(
  source: LocalSkillSource,
  incomingSkills: Skill[],
): Promise<{ imported: Skill[]; replaced: number; renamed: number }> {
  return upsertImportedSkillSource(source, incomingSkills);
}

async function upsertImportedSkillSource(
  source: SkillImportSource,
  incomingSkills: Skill[],
): Promise<{ imported: Skill[]; replaced: number; renamed: number }> {
  return withSyncLocalStateLock(() => upsertImportedSkillSourceUnlocked(source, incomingSkills));
}

async function upsertImportedSkillSourceUnlocked(
  source: SkillImportSource,
  incomingSkills: Skill[],
): Promise<{ imported: Skill[]; replaced: number; renamed: number }> {
  const [existingUserSkills, existingSources] = await Promise.all([
    getUserSkills(),
    getAllSkillSources(),
  ]);

  const sourceSkills = existingUserSkills.filter(
    (skill) => skill.source === 'remote' && skill.remote?.sourceId === source.id,
  );
  const sourceSkillByPath = new Map(sourceSkills.map((skill) => [skill.remote?.path, skill]));
  const incomingPaths = new Set(incomingSkills.map((skill) => skill.remote?.path).filter((path): path is string => Boolean(path)));
  const replaced = sourceSkills.filter((skill) => incomingPaths.has(skill.remote?.path ?? '')).length;

  const occupiedNames = new Set([
    ...BUILTIN_SKILLS.map((skill) => skill.name),
    ...existingUserSkills
      .filter((skill) => skill.remote?.sourceId !== source.id)
      .map((skill) => skill.name),
  ]);

  let renamed = 0;
  const imported = incomingSkills.map((skill) => {
    const existing = sourceSkillByPath.get(skill.remote?.path);
    const preferredName = existing?.name ?? skill.name;
    const name = existing ? preferredName : createUniqueSkillName(preferredName, occupiedNames);
    if (!existing && name !== preferredName) renamed += 1;
    occupiedNames.add(name);
    return {
      ...skill,
      name,
      source: 'remote' as const,
      enabled: existing?.enabled ?? skill.enabled ?? true,
    };
  });

  const nextUserSkills = [
    ...existingUserSkills.filter((skill) => skill.remote?.sourceId !== source.id),
    ...imported,
  ];
  const nextSource: SkillImportSource = {
    ...source,
    skillPaths: imported.map((skill) => skill.remote?.path).filter((path): path is string => Boolean(path)),
    importedSkillNames: imported.map((skill) => skill.name),
  };
  const nextSources = [
    ...existingSources.filter((item) => item.id !== source.id),
    nextSource,
  ];

  await chrome.storage.local.set({
    [SKILLS_STORAGE_KEY]: nextUserSkills,
    [SKILL_SOURCES_STORAGE_KEY]: nextSources,
  });

  return { imported, replaced, renamed };
}

export async function deleteGitHubSkillSource(sourceId: string): Promise<void> {
  await deleteSkillSource(sourceId);
}

export async function deleteSkillSource(sourceId: string): Promise<void> {
  await withSyncLocalStateLock(async () => {
    const [userSkills, sources] = await Promise.all([
      getUserSkills(),
      getAllSkillSources(),
    ]);
    await chrome.storage.local.set({
      [SKILLS_STORAGE_KEY]: userSkills.filter((skill) => skill.remote?.sourceId !== sourceId),
      [SKILL_SOURCES_STORAGE_KEY]: sources.filter((source) => source.id !== sourceId),
    });
  });
}

export async function replaceAllSkillSources(sources: SkillImportSource[]): Promise<void> {
  await withSyncLocalStateLock(() => replaceAllSkillSourcesForSyncApply(sources));
}

export async function replaceAllSkillSourcesForSyncApply(sources: SkillImportSource[]): Promise<void> {
  await chrome.storage.local.set({
    [SKILL_SOURCES_STORAGE_KEY]: sources.filter(isSkillImportSource),
  });
}

function normalizeStoredSkills(value: unknown): Skill[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((skill): skill is Skill => (
      Boolean(skill) &&
      typeof skill === 'object' &&
      typeof (skill as Skill).name === 'string' &&
      typeof (skill as Skill).instructions === 'string' &&
      USER_SKILL_SOURCES.has((skill as Skill).source)
    ))
    .map((skill) => ({ ...skill, enabled: skill.enabled !== false }));
}

async function getBundledSkillEnabledOverrides(): Promise<Record<string, boolean>> {
  const data = await chrome.storage.local.get(BUNDLED_ENABLED_STORAGE_KEY) as Record<string, unknown>;
  const value = data[BUNDLED_ENABLED_STORAGE_KEY];
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([name, enabled]) => typeof name === 'string' && typeof enabled === 'boolean'),
  ) as Record<string, boolean>;
}

function applyBundledSkillEnabledOverrides(skills: Skill[], bundledEnabled: Record<string, boolean>): Skill[] {
  return skills.map((skill) => {
    if (!TOGGLEABLE_BUNDLED_SKILL_SOURCES.has(skill.source) || bundledEnabled[skill.name] === undefined) {
      return { ...skill };
    }
    return { ...skill, enabled: bundledEnabled[skill.name] };
  });
}

function createUniqueSkillName(preferred: string, occupiedNames: Set<string>): string {
  const normalized = normalizeSkillName(preferred);
  if (!occupiedNames.has(normalized)) return normalized;
  for (let suffix = 2; suffix < 1000; suffix += 1) {
    const candidate = `${normalized}-${suffix}`;
    if (!occupiedNames.has(candidate)) return candidate;
  }
  throw new Error(`Unable to generate a unique name for remote Skill: ${preferred}`);
}

function normalizeSkillName(name: string): string {
  const normalized = name.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  if (!normalized) throw new Error('Skill name cannot be empty');
  return normalized;
}

function isGitHubSkillSource(value: unknown): value is GitHubSkillSource {
  if (!value || typeof value !== 'object') return false;
  const source = value as GitHubSkillSource;
  return source.provider === 'github' &&
    typeof source.id === 'string' &&
    typeof source.owner === 'string' &&
    typeof source.repo === 'string' &&
    Array.isArray(source.skillPaths);
}

function isLocalSkillSource(value: unknown): value is LocalSkillSource {
  if (!value || typeof value !== 'object') return false;
  const source = value as LocalSkillSource;
  return source.provider === 'local' &&
    typeof source.id === 'string' &&
    typeof source.rootPath === 'string' &&
    typeof source.displayName === 'string' &&
    Array.isArray(source.skillPaths);
}

function isSkillImportSource(value: unknown): value is SkillImportSource {
  return isGitHubSkillSource(value) || isLocalSkillSource(value);
}

async function removeRemoteSkillFromSource(sourceId: string, path: string, name: string): Promise<void> {
  const sources = await getAllSkillSources();
  const nextSources = sources
    .map((source) => {
      if (source.id !== sourceId) return source;
      return {
        ...source,
        skillPaths: source.skillPaths.filter((item) => item !== path),
        importedSkillNames: source.importedSkillNames.filter((item) => item !== name),
        updatedAt: Date.now(),
      };
    })
    .filter((source) => source.skillPaths.length > 0);
  await chrome.storage.local.set({ [SKILL_SOURCES_STORAGE_KEY]: nextSources });
}
