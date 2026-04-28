import type { Memory, Skill, SystemPromptPreset } from '../types';

export function mergeMemories(local: Memory[], remote: Memory[]): Omit<Memory, 'id'>[] {
  const map = new Map<string, Memory>();

  for (const mem of local) {
    map.set(mem.syncId, mem);
  }

  for (const mem of remote) {
    const existing = map.get(mem.syncId);
    if (!existing || mem.updatedAt > existing.updatedAt) {
      map.set(mem.syncId, mem);
    }
  }

  return Array.from(map.values()).map(({ id, ...rest }) => rest);
}

export function mergeSkills(local: Skill[], remote: Skill[]): Skill[] {
  const map = new Map<string, Skill>();

  for (const skill of remote) {
    map.set(skill.name, { ...skill, source: 'custom' });
  }
  for (const skill of local) {
    map.set(skill.name, skill);
  }

  return Array.from(map.values());
}

export function mergePresets(
  local: SystemPromptPreset[],
  remote: SystemPromptPreset[],
): SystemPromptPreset[] {
  const map = new Map<string, SystemPromptPreset>();

  for (const preset of local) {
    map.set(preset.id, preset);
  }

  for (const preset of remote) {
    const existing = map.get(preset.id);
    if (!existing || preset.updatedAt > existing.updatedAt) {
      map.set(preset.id, preset);
    }
  }

  return Array.from(map.values());
}
