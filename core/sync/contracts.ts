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

export const SYNC_GENERATION_FILE_KEYS: readonly SyncFileKey[] = Object.freeze(Object.values(SYNC_FILE_KEYS));

export const SYNC_GENERATION_SCHEMA_VERSION = 1 as const;
export const SYNC_GENERATION_KIND = 'deepseek-pp.sync-generation' as const;
export const SYNC_GENERATION_POINTER_KIND = 'deepseek-pp.sync-generation-pointer' as const;
export const SYNC_CURRENT_POINTER_KEY = 'sync-current.json' as const;

const SYNC_FILE_KEY_SET: ReadonlySet<string> = new Set(Object.values(SYNC_FILE_KEYS));

export function isSyncFileKey(value: unknown): value is SyncFileKey {
  return typeof value === 'string' && SYNC_FILE_KEY_SET.has(value);
}

export function getSyncGenerationFileKey(generationId: string, file: SyncFileKey): string {
  return `sync-generation-${generationId}--${file}`;
}

export function getSyncGenerationManifestKey(generationId: string): string {
  return `sync-generation-${generationId}--manifest.json`;
}
