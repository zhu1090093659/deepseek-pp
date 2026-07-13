export const SYNC_FILE_KEYS = {
  memories: 'memories.json',
  skills: 'skills.json',
  skillSources: 'skill-sources.json',
  presets: 'presets.json',
  projectContext: 'project-context.json',
  savedItems: 'saved-items.json',
} as const;

export const REQUIRED_SYNC_FILE_KEYS = [
  SYNC_FILE_KEYS.memories,
  SYNC_FILE_KEYS.skills,
  SYNC_FILE_KEYS.presets,
] as const;

export const OPTIONAL_SYNC_FILE_KEYS = [
  SYNC_FILE_KEYS.skillSources,
  SYNC_FILE_KEYS.projectContext,
  SYNC_FILE_KEYS.savedItems,
] as const;

export type SyncFileKey = typeof SYNC_FILE_KEYS[keyof typeof SYNC_FILE_KEYS];
