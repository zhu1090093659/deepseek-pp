import type { GitHubSkillSource, LocalSkillSource, Skill, SkillImportSource } from '../types';
import { DEFAULT_LOCALE, type SupportedLocale } from '../i18n';
import { withSyncLocalStateLock } from '../persistence/local-state-lock';
import {
  createChromeStorageSlot,
  createVersionedRepository,
} from '../persistence/versioned-repository';
import { BUILTIN_SKILLS, getLocalizedBuiltinSkills } from './builtin';
import {
  BUNDLED_SKILL_REGISTRATIONS,
  loadBundledSkills,
  resolveBundledSkillNames,
} from './bundled-loader';
import {
  decodeGitHubSkillSource,
  decodeSkillImportSource,
  decodeSkillSourceCollection,
  decodeUserSkill,
  skillSourceCollectionCodec,
  userSkillCollectionCodec,
} from './codec';

export const SKILLS_STORAGE_KEY = 'deepseek_pp_skills';
export const SKILL_SOURCES_STORAGE_KEY = 'deepseek_pp_skill_sources';
const BUNDLED_ENABLED_STORAGE_KEY = 'deepseek_pp_bundled_skill_enabled';
const BUNDLED_SKILL_ORDER_ANCHOR = 'shell';

const TOGGLEABLE_BUNDLED_SKILL_SOURCES = new Set(['third-party', 'official']);

const userSkillRepository = createVersionedRepository({
  label: 'skills',
  createDefault: () => [],
  codec: userSkillCollectionCodec,
  storage: createChromeStorageSlot(SKILLS_STORAGE_KEY),
});

const skillSourceRepository = createVersionedRepository({
  label: 'skillSources',
  createDefault: () => [],
  codec: skillSourceCollectionCodec,
  storage: createChromeStorageSlot(SKILL_SOURCES_STORAGE_KEY),
});

export interface ImportedSkillMutationResult {
  imported: Skill[];
  replaced: number;
  renamed: number;
}

export type SkillCollisionCandidate = Pick<Skill, 'name' | 'source' | 'enabled' | 'remote'>;

export async function getAllSkills(
  options: { includeDisabled?: boolean; locale?: SupportedLocale } = {},
): Promise<Skill[]> {
  const [userSkills, bundledEnabled] = await Promise.all([
    getUserSkills(),
    getBundledSkillEnabledOverrides(),
  ]);
  const bundledSkills = await loadBundledSkills(
    resolveBundledSkillNames(bundledEnabled, options.includeDisabled === true),
  );
  const skills = [
    ...mergeBuiltinAndBundledSkills(
      applyBundledSkillEnabledOverrides(
        getLocalizedBuiltinSkills(options.locale ?? DEFAULT_LOCALE),
        bundledEnabled,
      ),
      applyBundledSkillEnabledOverrides(bundledSkills, bundledEnabled),
    ),
    ...userSkills,
  ];
  if (options.includeDisabled) return skills;
  return skills.filter((skill) => skill.enabled !== false);
}

export async function getSkillLibrary(locale: SupportedLocale = DEFAULT_LOCALE): Promise<Skill[]> {
  return getAllSkills({ includeDisabled: true, locale });
}

export async function getSkillCollisionCandidates(): Promise<SkillCollisionCandidate[]> {
  const userSkills = await getUserSkills();
  return [
    ...BUILTIN_SKILLS.map(({ name, source }) => ({ name, source })),
    ...BUNDLED_SKILL_REGISTRATIONS.map(({ name }) => ({ name, source: 'third-party' as const })),
    ...userSkills.map(({ name, source, enabled, remote }) => ({ name, source, enabled, remote })),
  ];
}

export async function getUserSkills(): Promise<Skill[]> {
  return userSkillRepository.read();
}

function mergeBuiltinAndBundledSkills(
  builtinSkills: readonly Skill[],
  bundledSkills: readonly Skill[],
): Skill[] {
  const anchorIndex = builtinSkills.findIndex(({ name }) => name === BUNDLED_SKILL_ORDER_ANCHOR);
  if (anchorIndex < 0) {
    throw new Error(`Bundled Skill order anchor is missing: ${BUNDLED_SKILL_ORDER_ANCHOR}`);
  }
  const insertionIndex = anchorIndex + 1;
  return [
    ...builtinSkills.slice(0, insertionIndex),
    ...bundledSkills,
    ...builtinSkills.slice(insertionIndex),
  ];
}

export async function getUserSkillsAlreadyLocked(): Promise<Skill[]> {
  return userSkillRepository.readAlreadyLocked();
}

export async function saveSkill(skill: Skill, previousName?: string): Promise<void> {
  await withSyncLocalStateLock(async () => {
    if (previousName !== undefined) requireNonEmptyString(previousName, 'Previous Skill name');
    const incomingSkill = decodeUserSkill({
      ...skill,
      source: 'custom',
      enabled: skill.enabled === undefined ? true : skill.enabled,
    }, 'skill');
    const userSkills = await getUserSkillsAlreadyLocked();
    const custom = userSkills.filter((s) => s.source === 'custom');
    const namesToReplace = new Set<string>([incomingSkill.name]);
    if (previousName) namesToReplace.add(previousName);
    const matchingIndexes = custom
      .map((item, index) => namesToReplace.has(item.name) ? index : -1)
      .filter((index) => index >= 0);
    if (matchingIndexes.length > 1) {
      throw new Error('Skill edit is ambiguous because multiple custom Skills use the same name');
    }
    const insertIndex = matchingIndexes[0] ?? -1;
    const next = custom.filter((s) => !namesToReplace.has(s.name));
    const remote = userSkills.filter((s) => s.source === 'remote');
    const existingSkill = insertIndex >= 0 ? custom[insertIndex] : undefined;
    const savedSkill = decodeUserSkill({
      ...existingSkill,
      ...incomingSkill,
      source: 'custom',
      enabled: incomingSkill.enabled !== false,
    }, 'skill');

    if (insertIndex >= 0) {
      next.splice(Math.min(insertIndex, next.length), 0, savedSkill);
    } else {
      next.push(savedSkill);
    }
    await userSkillRepository.writeAfterReadAlreadyLocked([...next, ...remote]);
  });
}

export async function stageDeleteSkillAlreadyLocked(
  name: string,
): Promise<() => Promise<void>> {
  requireNonEmptyString(name, 'Skill name');
  const [userSkills, sources] = await Promise.all([
    getUserSkillsAlreadyLocked(),
    getAllSkillSourcesAlreadyLocked(),
  ]);
  const removedSkills = userSkills.filter((skill) => skill.name === name);
  const nextSkills = userSkills.filter((skill) => skill.name !== name);
  const nextSources = removedSkills.reduce((current, skill) => (
    skill.source === 'remote' && skill.remote
      ? removeSkillFromSources(current, skill.remote.sourceId, skill.remote.path, skill.name)
      : current
  ), sources);

  return async () => {
    if (nextSkills.length !== userSkills.length) {
      await userSkillRepository.writeAfterReadAlreadyLocked(nextSkills);
    }
    if (nextSources !== sources) {
      await skillSourceRepository.writeAfterReadAlreadyLocked(nextSources);
    }
  };
}

export async function replaceAllCustomSkills(skills: Skill[]): Promise<void> {
  await withSyncLocalStateLock(() => replaceAllCustomSkillsForSyncApply(skills));
}

export async function replaceAllCustomSkillsForSyncApply(skills: Skill[]): Promise<void> {
  const userSkills = userSkillCollectionCodec.decode(skills, 'skills');
  await userSkillRepository.replaceAlreadyLocked(userSkills);
}

export async function setSkillEnabled(name: string, enabled: boolean): Promise<void> {
  await setSkillsEnabled([{ name, enabled }]);
}

export async function setSkillsEnabled(updates: Array<{ name: string; enabled: boolean }>): Promise<void> {
  if (updates.length === 0) return;
  for (const update of updates) {
    requireNonEmptyString(update.name, 'Skill name');
    if (typeof update.enabled !== 'boolean') throw new Error('Skill enabled must be a boolean');
  }

  await withSyncLocalStateLock(() => setSkillsEnabledUnlocked(updates));
}

async function setSkillsEnabledUnlocked(updates: Array<{ name: string; enabled: boolean }>): Promise<void> {
  const updateByName = new Map<string, boolean>();
  for (const update of updates) {
    updateByName.set(update.name, update.enabled);
  }

  const userSkills = await getUserSkillsAlreadyLocked();
  let userSkillsChanged = false;
  const matchedNames = new Set<string>();
  const next = userSkills.map((skill) => {
    if (!updateByName.has(skill.name)) return skill;
    const enabled = updateByName.get(skill.name) ?? true;
    matchedNames.add(skill.name);
    userSkillsChanged = true;
    return { ...skill, enabled };
  });
  for (const name of matchedNames) updateByName.delete(name);

  const bundledUpdates: Record<string, boolean> = {};
  for (const [name, enabled] of updateByName) {
    const bundledSkill = BUNDLED_SKILL_REGISTRATIONS.find((skill) => skill.name === name);
    if (!bundledSkill) throw new Error(`Skill cannot be enabled or disabled because it was not found: ${name}`);
    bundledUpdates[name] = enabled;
  }

  if (Object.keys(bundledUpdates).length === 0) {
    if (!userSkillsChanged) return;
    await userSkillRepository.writeAfterReadAlreadyLocked(next);
    return;
  }

  const bundledEnabled = await getBundledSkillEnabledOverrides();
  const patch: Record<string, unknown> = {
    [BUNDLED_ENABLED_STORAGE_KEY]: {
      ...bundledEnabled,
      ...bundledUpdates,
    },
  };
  if (userSkillsChanged) patch[SKILLS_STORAGE_KEY] = userSkillCollectionCodec.encode(next);
  await chrome.storage.local.set({
    ...patch,
  });
}

export async function getAllSkillSources(): Promise<SkillImportSource[]> {
  return skillSourceRepository.read();
}

export async function getAllSkillSourcesAlreadyLocked(): Promise<SkillImportSource[]> {
  return skillSourceRepository.readAlreadyLocked();
}

export async function getSkillSourceById(sourceId: string): Promise<SkillImportSource | null> {
  requireNonEmptyString(sourceId, 'Skill source id');
  const sources = await getAllSkillSources();
  return findUniqueSourceById(sources, sourceId);
}

export async function getGitHubSkillSourceById(sourceId: string): Promise<GitHubSkillSource | null> {
  const source = await getSkillSourceById(sourceId);
  return source?.provider === 'github' ? source : null;
}

export async function updateGitHubSkillSourceLastCheckedAt(
  sourceId: string,
  lastCheckedAt: number,
): Promise<GitHubSkillSource> {
  requireNonEmptyString(sourceId, 'Skill source id');
  if (!Number.isFinite(lastCheckedAt)) throw new Error('Skill source lastCheckedAt must be finite');
  return withSyncLocalStateLock(async () => {
    const sources = await getAllSkillSourcesAlreadyLocked();
    const source = findUniqueSourceById(sources, sourceId);
    if (!source || source.provider !== 'github') throw new Error('GitHub Skill source was not found');
    const index = sources.indexOf(source);
    const updated = decodeGitHubSkillSource({ ...source, lastCheckedAt }, 'skillSource');
    const next = [...sources];
    next[index] = updated;
    await skillSourceRepository.writeAfterReadAlreadyLocked(next);
    return updated;
  });
}

export async function stageUpsertGitHubSkillSourceAlreadyLocked(
  source: GitHubSkillSource,
  incomingSkills: Skill[],
  expectedSkillPaths?: readonly string[],
): Promise<() => Promise<ImportedSkillMutationResult>> {
  return stageUpsertImportedSkillSourceAlreadyLocked(source, incomingSkills, expectedSkillPaths);
}

export async function stageUpsertLocalSkillSourceAlreadyLocked(
  source: LocalSkillSource,
  incomingSkills: Skill[],
): Promise<() => Promise<ImportedSkillMutationResult>> {
  return stageUpsertImportedSkillSourceAlreadyLocked(source, incomingSkills);
}

async function stageUpsertImportedSkillSourceAlreadyLocked(
  source: SkillImportSource,
  incomingSkills: Skill[],
  expectedSkillPaths?: readonly string[],
): Promise<() => Promise<ImportedSkillMutationResult>> {
  const decodedSource = decodeSkillImportSource(source, 'skillSource');
  const decodedIncoming = incomingSkills.map((skill, index) => (
    decodeUserSkill(skill, `skills[${index}]`)
  ));
  for (const [index, skill] of decodedIncoming.entries()) {
    if (skill.source !== 'remote' || !skill.remote) {
      throw new Error(`skills[${index}] must be a remote Skill`);
    }
    if (skill.remote.sourceId !== decodedSource.id || skill.remote.provider !== decodedSource.provider) {
      throw new Error(`skills[${index}].remote does not match its Skill source`);
    }
  }
  const [existingUserSkills, existingSources] = await Promise.all([
    getUserSkillsAlreadyLocked(),
    getAllSkillSourcesAlreadyLocked(),
  ]);
  const existingSource = findUniqueSourceById(existingSources, decodedSource.id);
  if (expectedSkillPaths) {
    const currentSource = existingSource;
    if (!currentSource || currentSource.provider !== 'github' || !sameStrings(currentSource.skillPaths, expectedSkillPaths)) {
      throw new Error('GitHub Skill source changed while its update was loading; retry the update');
    }
  }

  const sourceSkills = existingUserSkills.filter(
    (skill) => skill.source === 'remote' && skill.remote?.sourceId === decodedSource.id,
  );
  const sourceSkillByPath = new Map(sourceSkills.map((skill) => [skill.remote?.path, skill]));
  const incomingPaths = new Set(decodedIncoming.map((skill) => skill.remote?.path).filter((path): path is string => Boolean(path)));
  const replaced = sourceSkills.filter((skill) => incomingPaths.has(skill.remote?.path ?? '')).length;

  const occupiedNames = new Set([
    ...BUILTIN_SKILLS.map((skill) => skill.name),
    ...BUNDLED_SKILL_REGISTRATIONS.map((skill) => skill.name),
    ...existingUserSkills
      .filter((skill) => skill.remote?.sourceId !== decodedSource.id)
      .map((skill) => skill.name),
  ]);

  let renamed = 0;
  const imported = decodedIncoming.map((skill) => {
    const existing = sourceSkillByPath.get(skill.remote?.path);
    const preferredName = existing?.name ?? skill.name;
    const name = existing ? preferredName : createUniqueSkillName(preferredName, occupiedNames);
    if (!existing && name !== preferredName) renamed += 1;
    occupiedNames.add(name);
    return {
      ...existing,
      ...skill,
      name,
      source: 'remote' as const,
      enabled: existing?.enabled ?? skill.enabled ?? true,
      ...(skill.remote
        ? { remote: { ...existing?.remote, ...skill.remote } }
        : {}),
    };
  });

  const nextUserSkills = [
    ...existingUserSkills.filter((skill) => skill.remote?.sourceId !== decodedSource.id),
    ...imported,
  ];
  const nextSource: SkillImportSource = {
    ...existingSource,
    ...decodedSource,
    skillPaths: imported.map((skill) => skill.remote?.path).filter((path): path is string => Boolean(path)),
    importedSkillNames: imported.map((skill) => skill.name),
  };
  const nextSources = [
    ...existingSources.filter((item) => item.id !== decodedSource.id),
    nextSource,
  ];

  return async () => {
    await userSkillRepository.writeAfterReadAlreadyLocked(nextUserSkills);
    await skillSourceRepository.writeAfterReadAlreadyLocked(nextSources);
    return { imported, replaced, renamed };
  };
}

export async function stageDeleteSkillSourceAlreadyLocked(
  sourceId: string,
): Promise<() => Promise<void>> {
  requireNonEmptyString(sourceId, 'Skill source id');
  const [userSkills, sources] = await Promise.all([
    getUserSkillsAlreadyLocked(),
    getAllSkillSourcesAlreadyLocked(),
  ]);
  const nextSkills = userSkills.filter((skill) => skill.remote?.sourceId !== sourceId);
  const nextSources = sources.filter((source) => source.id !== sourceId);
  return async () => {
    await userSkillRepository.writeAfterReadAlreadyLocked(nextSkills);
    await skillSourceRepository.writeAfterReadAlreadyLocked(nextSources);
  };
}

export async function replaceAllSkillSources(sources: SkillImportSource[]): Promise<void> {
  await withSyncLocalStateLock(() => replaceAllSkillSourcesForSyncApply(sources));
}

export async function replaceAllSkillSourcesForSyncApply(sources: SkillImportSource[]): Promise<void> {
  const decoded = decodeSkillSourceCollection(sources, 'skillSources');
  await skillSourceRepository.replaceAlreadyLocked(decoded);
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

function removeSkillFromSources(
  sources: SkillImportSource[],
  sourceId: string,
  path: string,
  name: string,
): SkillImportSource[] {
  return sources
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
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function requireNonEmptyString(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${label} is required`);
  }
}

function findUniqueSourceById(
  sources: SkillImportSource[],
  sourceId: string,
): SkillImportSource | null {
  const matches = sources.filter((source) => source.id === sourceId);
  if (matches.length > 1) {
    throw new Error(`Skill source mutation is ambiguous because the id is duplicated: ${sourceId}`);
  }
  return matches[0] ?? null;
}
