import type { Skill } from '../types';
import { BUILTIN_SKILLS } from './builtin';

const STORAGE_KEY = 'deepseek_pp_skills';

export async function getAllSkills(): Promise<Skill[]> {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  const custom: Skill[] = stored[STORAGE_KEY] ?? [];
  return [...BUILTIN_SKILLS, ...custom];
}

export async function saveSkill(skill: Skill): Promise<void> {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  const custom: Skill[] = stored[STORAGE_KEY] ?? [];
  const idx = custom.findIndex((s) => s.name === skill.name);
  if (idx >= 0) {
    custom[idx] = skill;
  } else {
    custom.push(skill);
  }
  await chrome.storage.local.set({ [STORAGE_KEY]: custom });
}

export async function deleteSkill(name: string): Promise<void> {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  const custom: Skill[] = (stored[STORAGE_KEY] ?? []).filter(
    (s: Skill) => s.name !== name,
  );
  await chrome.storage.local.set({ [STORAGE_KEY]: custom });
}
