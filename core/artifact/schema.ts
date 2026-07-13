import type { ArtifactRecord } from './types';

export const ARTIFACT_PERSISTENCE_CONTRACT = {
  databaseName: 'DeepSeekPPArtifacts',
  databaseVersion: 1,
  tableName: 'artifacts',
  tableSchema: 'id, createdAt',
  legacyStorageKey: 'deepseek_pp_artifacts',
  maxRecords: 50,
} as const;

export function isArtifactRecord(value: unknown): value is ArtifactRecord {
  if (!value || typeof value !== 'object') return false;
  const record = value as ArtifactRecord;
  return typeof record.id === 'string' &&
    (record.kind === 'file' || record.kind === 'bundle') &&
    typeof record.filename === 'string' &&
    typeof record.mimeType === 'string' &&
    typeof record.content === 'string' &&
    typeof record.sizeBytes === 'number' &&
    typeof record.createdAt === 'number';
}
