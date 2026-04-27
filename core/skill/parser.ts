import { SKILL_TRIGGER_REGEX } from '../constants';
import type { SkillInvocation } from '../types';

export function parseSkillCommand(input: string): SkillInvocation | null {
  const match = input.match(SKILL_TRIGGER_REGEX);
  if (!match) return null;
  return {
    skillName: match[1],
    args: match[2]?.trim() ?? '',
    rawInput: input,
  };
}
