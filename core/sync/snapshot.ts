import type {
  Memory,
  Skill,
  SkillImportSource,
  SystemPromptPreset,
} from '../types';
import type { ProjectContextState } from '../project/types';
import type { SavedItemsState } from '../saved-items/types';
import { SYNC_FILE_KEYS } from './contracts';
import type { SyncGenerationSourceFile } from './generation';

export interface SyncDataSnapshot {
  memories: Omit<Memory, 'id'>[];
  skills: Skill[];
  skillSources: SkillImportSource[];
  presets: SystemPromptPreset[];
  projectContext: ProjectContextState | null;
  savedItems: SavedItemsState | null;
}

export function serializeSyncDataSnapshot(snapshot: SyncDataSnapshot): SyncGenerationSourceFile[] {
  if (!snapshot.projectContext) throw new Error('Project context is required for sync generation upload');
  if (!snapshot.savedItems) throw new Error('Saved items are required for sync generation upload');
  return [
    { key: SYNC_FILE_KEYS.memories, content: JSON.stringify(snapshot.memories) },
    { key: SYNC_FILE_KEYS.skills, content: JSON.stringify(snapshot.skills) },
    { key: SYNC_FILE_KEYS.skillSources, content: JSON.stringify(snapshot.skillSources) },
    { key: SYNC_FILE_KEYS.presets, content: JSON.stringify(snapshot.presets) },
    { key: SYNC_FILE_KEYS.projectContext, content: JSON.stringify(snapshot.projectContext) },
    { key: SYNC_FILE_KEYS.savedItems, content: JSON.stringify(snapshot.savedItems) },
  ];
}
