import type { LocalSkillSource, Skill, SkillImportSource } from '../types';

export type LocalOnlySkill = Skill & {
  source: 'remote';
  remote: NonNullable<Skill['remote']> & { provider: 'local' };
};

export function isLocalOnlySkill(skill: Skill): skill is LocalOnlySkill {
  return skill.source === 'remote' && skill.remote?.provider === 'local';
}

export function isLocalOnlySkillSource(
  source: SkillImportSource,
): source is LocalSkillSource {
  return source.provider === 'local';
}

export function isSyncableSkill(skill: Skill): boolean {
  return !isLocalOnlySkill(skill);
}

export function isSyncableSkillSource(source: SkillImportSource): boolean {
  return !isLocalOnlySkillSource(source);
}
