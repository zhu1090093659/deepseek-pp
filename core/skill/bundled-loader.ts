import type { Skill } from '../types';

export type BundledSkillGroup = 'officecli' | 'spec-driven-develop';

export interface BundledSkillRegistration {
  name: string;
  group: BundledSkillGroup;
  enabled: boolean;
}

const OFFICECLI_SKILL_NAMES = [
  'officecli',
  'officecli-docx',
  'officecli-xlsx',
  'officecli-pptx',
  'officecli-academic-paper',
  'officecli-word-form',
  'officecli-data-dashboard',
  'officecli-financial-model',
  'officecli-pitch-deck',
  'morph-ppt',
  'morph-ppt-3d',
  'officecli-styles',
] as const;

const SPEC_DRIVEN_DEVELOP_SKILLS = [
  { name: 'spec-driven-develop', enabled: false },
  { name: 'deep-discuss', enabled: true },
  { name: 'review-spd', enabled: false },
] as const;

export const BUNDLED_SKILL_REGISTRATIONS: readonly BundledSkillRegistration[] = Object.freeze([
  ...OFFICECLI_SKILL_NAMES.map((name) => ({
    name,
    group: 'officecli' as const,
    enabled: false,
  })),
  ...SPEC_DRIVEN_DEVELOP_SKILLS.map((registration) => ({
    ...registration,
    group: 'spec-driven-develop' as const,
  })),
]);

type BundledSkillGroupLoader = (names: readonly string[]) => Promise<readonly Skill[]>;

export interface BundledSkillLoaders {
  officecli: BundledSkillGroupLoader;
  'spec-driven-develop': BundledSkillGroupLoader;
}

export function resolveBundledSkillNames(
  enabledOverrides: Readonly<Record<string, boolean>>,
  includeDisabled: boolean,
): string[] {
  return BUNDLED_SKILL_REGISTRATIONS
    .filter((registration) => (
      includeDisabled
      || (enabledOverrides[registration.name] ?? registration.enabled)
    ))
    .map((registration) => registration.name);
}

export function createBundledSkillResourceLoader(
  loaders: BundledSkillLoaders,
  registrations: readonly BundledSkillRegistration[] = BUNDLED_SKILL_REGISTRATIONS,
) {
  const registrationByName = new Map(registrations.map((item) => [item.name, item]));
  const skillPromises = new Map<string, Promise<Skill>>();

  return async (requestedNames: readonly string[]): Promise<Skill[]> => {
    const names = [...new Set(requestedNames)];
    const missingByGroup = new Map<BundledSkillGroup, string[]>();

    for (const name of names) {
      const registration = registrationByName.get(name);
      if (!registration) throw new Error(`Unknown bundled Skill: ${name}`);
      if (skillPromises.has(name)) continue;
      const groupNames = missingByGroup.get(registration.group) ?? [];
      groupNames.push(name);
      missingByGroup.set(registration.group, groupNames);
    }

    for (const [group, missingNames] of missingByGroup) {
      const groupPromise = loaders[group](missingNames).then((skills) => (
        validateLoadedSkills(group, missingNames, skills)
      ));
      for (const name of missingNames) {
        const skillPromise = groupPromise.then((skillByName) => skillByName.get(name)!);
        skillPromises.set(name, skillPromise);
        void skillPromise.catch(() => {
          if (skillPromises.get(name) === skillPromise) skillPromises.delete(name);
        });
      }
    }

    return Promise.all(names.map((name) => skillPromises.get(name)!));
  };
}

function validateLoadedSkills(
  group: BundledSkillGroup,
  requestedNames: readonly string[],
  skills: readonly Skill[],
): ReadonlyMap<string, Skill> {
  const requested = new Set(requestedNames);
  const skillByName = new Map<string, Skill>();
  for (const skill of skills) {
    if (!requested.has(skill.name)) {
      throw new Error(`Bundled Skill loader ${group} returned an unrequested Skill: ${skill.name}`);
    }
    if (skillByName.has(skill.name)) {
      throw new Error(`Bundled Skill loader ${group} returned a duplicate Skill: ${skill.name}`);
    }
    skillByName.set(skill.name, skill);
  }
  for (const name of requestedNames) {
    if (!skillByName.has(name)) {
      throw new Error(`Bundled Skill loader ${group} did not return requested Skill: ${name}`);
    }
  }
  return skillByName;
}

export const loadBundledSkills = createBundledSkillResourceLoader({
  async officecli(names) {
    const { loadThirdPartyOfficeCliSkills } = await import('./officecli-library');
    return loadThirdPartyOfficeCliSkills(names);
  },
  async 'spec-driven-develop'(names) {
    const { loadThirdPartySpecDrivenDevelopSkills } = await import(
      './spec-driven-develop-library'
    );
    return loadThirdPartySpecDrivenDevelopSkills(names);
  },
});
