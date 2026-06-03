import type { GitHubSkillSource, Skill } from '../types';
import { BUILTIN_SKILLS } from './builtin';

const STORAGE_KEY = 'deepseek_pp_skills';
const SOURCES_STORAGE_KEY = 'deepseek_pp_skill_sources';

const USER_SKILL_SOURCES = new Set(['custom', 'remote']);

export async function getAllSkills(options: { includeDisabled?: boolean } = {}): Promise<Skill[]> {
  const skills = [...BUILTIN_SKILLS, ...await getUserSkills()];
  if (options.includeDisabled) return skills;
  return skills.filter((skill) => skill.enabled !== false);
}

export async function getSkillLibrary(): Promise<Skill[]> {
  return getAllSkills({ includeDisabled: true });
}

export async function getUserSkills(): Promise<Skill[]> {
  const data = await chrome.storage.local.get(STORAGE_KEY) as Record<string, unknown>;
  const storedSkills = data[STORAGE_KEY];
  return normalizeStoredSkills(storedSkills);
}

export async function saveSkill(skill: Skill, previousName?: string): Promise<void> {
  const custom = (await getUserSkills()).filter((s) => s.source === 'custom');
  const namesToReplace = new Set<string>([skill.name]);
  if (previousName) namesToReplace.add(previousName);

  const previousIndex = previousName ? custom.findIndex((s) => s.name === previousName) : -1;
  const currentIndex = custom.findIndex((s) => s.name === skill.name);
  const insertIndex = previousIndex >= 0 ? previousIndex : currentIndex;
  const next = custom.filter((s) => !namesToReplace.has(s.name));
  const remote = (await getUserSkills()).filter((s) => s.source === 'remote');
  const savedSkill = { ...skill, source: 'custom' as const, enabled: skill.enabled !== false };

  if (insertIndex >= 0) {
    next.splice(Math.min(insertIndex, next.length), 0, savedSkill);
  } else {
    next.push(savedSkill);
  }
  await chrome.storage.local.set({ [STORAGE_KEY]: [...next, ...remote] });
}

export async function deleteSkill(name: string): Promise<void> {
  const userSkills = await getUserSkills();
  const removed = userSkills.find((s) => s.name === name);
  const next = userSkills.filter((s) => s.name !== name);
  await chrome.storage.local.set({ [STORAGE_KEY]: next });

  if (removed?.source === 'remote' && removed.remote) {
    await removeRemoteSkillFromSource(removed.remote.sourceId, removed.remote.path, removed.name);
  }
}

export async function replaceAllCustomSkills(skills: Skill[]): Promise<void> {
  const userSkills = skills
    .filter((s) => USER_SKILL_SOURCES.has(s.source))
    .map((s) => ({
      ...s,
      source: s.source === 'remote' ? 'remote' as const : 'custom' as const,
      enabled: s.enabled !== false,
    }));
  await chrome.storage.local.set({ [STORAGE_KEY]: userSkills });
}

export async function setSkillEnabled(name: string, enabled: boolean): Promise<void> {
  const userSkills = await getUserSkills();
  let found = false;
  const next = userSkills.map((skill) => {
    if (skill.name !== name) return skill;
    found = true;
    return { ...skill, enabled };
  });
  if (!found) throw new Error(`找不到可启停的 Skill: ${name}`);
  await chrome.storage.local.set({ [STORAGE_KEY]: next });
}

export async function getAllSkillSources(): Promise<GitHubSkillSource[]> {
  const data = await chrome.storage.local.get(SOURCES_STORAGE_KEY) as Record<string, unknown>;
  const storedSources = data[SOURCES_STORAGE_KEY];
  if (!Array.isArray(storedSources)) return [];
  return storedSources.filter(isGitHubSkillSource);
}

export async function getSkillSourceById(sourceId: string): Promise<GitHubSkillSource | null> {
  const sources = await getAllSkillSources();
  return sources.find((source) => source.id === sourceId) ?? null;
}

export async function saveGitHubSkillSource(source: GitHubSkillSource): Promise<void> {
  const sources = await getAllSkillSources();
  await chrome.storage.local.set({
    [SOURCES_STORAGE_KEY]: [
      ...sources.filter((item) => item.id !== source.id),
      source,
    ],
  });
}

export async function upsertGitHubSkillSource(
  source: GitHubSkillSource,
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
  const nextSource: GitHubSkillSource = {
    ...source,
    skillPaths: imported.map((skill) => skill.remote?.path).filter((path): path is string => Boolean(path)),
    importedSkillNames: imported.map((skill) => skill.name),
  };
  const nextSources = [
    ...existingSources.filter((item) => item.id !== source.id),
    nextSource,
  ];

  await chrome.storage.local.set({
    [STORAGE_KEY]: nextUserSkills,
    [SOURCES_STORAGE_KEY]: nextSources,
  });

  return { imported, replaced, renamed };
}

export async function deleteGitHubSkillSource(sourceId: string): Promise<void> {
  const [userSkills, sources] = await Promise.all([
    getUserSkills(),
    getAllSkillSources(),
  ]);
  await chrome.storage.local.set({
    [STORAGE_KEY]: userSkills.filter((skill) => skill.remote?.sourceId !== sourceId),
    [SOURCES_STORAGE_KEY]: sources.filter((source) => source.id !== sourceId),
  });
}

export async function replaceAllSkillSources(sources: GitHubSkillSource[]): Promise<void> {
  await chrome.storage.local.set({
    [SOURCES_STORAGE_KEY]: sources.filter(isGitHubSkillSource),
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

function createUniqueSkillName(preferred: string, occupiedNames: Set<string>): string {
  const normalized = normalizeSkillName(preferred);
  if (!occupiedNames.has(normalized)) return normalized;
  for (let suffix = 2; suffix < 1000; suffix += 1) {
    const candidate = `${normalized}-${suffix}`;
    if (!occupiedNames.has(candidate)) return candidate;
  }
  throw new Error(`无法为远程 Skill 生成唯一名称: ${preferred}`);
}

function normalizeSkillName(name: string): string {
  const normalized = name.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  if (!normalized) throw new Error('Skill 名称不能为空');
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
  await chrome.storage.local.set({ [SOURCES_STORAGE_KEY]: nextSources });
}
