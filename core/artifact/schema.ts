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
  try {
    decodeArtifactRecord(value);
    return true;
  } catch {
    return false;
  }
}

export function decodeArtifactRecord(
  value: unknown,
  path = 'artifact',
): ArtifactRecord {
  const record = objectValue(value, path);
  nonEmptyString(record.id, `${path}.id`);
  if (record.kind !== 'file' && record.kind !== 'bundle') {
    throw new Error(`${path}.kind must be file or bundle`);
  }
  nonEmptyString(record.filename, `${path}.filename`);
  nonEmptyString(record.mimeType, `${path}.mimeType`);
  stringValue(record.content, `${path}.content`);
  nonNegativeFiniteNumber(record.sizeBytes, `${path}.sizeBytes`);
  nonNegativeFiniteNumber(record.createdAt, `${path}.createdAt`);

  if (record.files !== undefined) decodeArtifactFiles(record.files, `${path}.files`);
  if (record.view !== undefined) decodeArtifactView(record.view, `${path}.view`);
  return record as unknown as ArtifactRecord;
}

export function decodeArtifactRecords(
  value: unknown,
  path = 'artifacts',
): ArtifactRecord[] {
  if (!Array.isArray(value)) throw new Error(`${path} must be an array`);
  const records = value.map((record, index) => (
    decodeArtifactRecord(record, `${path}[${index}]`)
  ));
  const ids = new Set<string>();
  for (const record of records) {
    if (ids.has(record.id)) throw new Error(`${path} contains duplicate id: ${record.id}`);
    ids.add(record.id);
  }
  return records;
}

function decodeArtifactFiles(value: unknown, path: string): void {
  if (!Array.isArray(value)) throw new Error(`${path} must be an array`);
  value.forEach((item, index) => {
    const file = objectValue(item, `${path}[${index}]`);
    nonEmptyString(file.path, `${path}[${index}].path`);
    stringValue(file.content, `${path}[${index}].content`);
    if (file.mimeType !== undefined) {
      nonEmptyString(file.mimeType, `${path}[${index}].mimeType`);
    }
  });
}

function decodeArtifactView(value: unknown, path: string): void {
  const view = objectValue(value, path);
  if (view.previewMode !== 'none' && view.previewMode !== 'html' && view.previewMode !== 'code') {
    throw new Error(`${path}.previewMode must be none, html, or code`);
  }
  if (
    view.language !== 'html'
    && view.language !== 'javascript'
    && view.language !== 'typescript'
    && view.language !== 'python'
    && view.language !== 'text'
  ) {
    throw new Error(`${path}.language is not supported`);
  }
}

function objectValue(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${path} must be an object`);
  }
  return value as Record<string, unknown>;
}

function nonEmptyString(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${path} must be a non-empty string`);
  }
  return value;
}

function stringValue(value: unknown, path: string): string {
  if (typeof value !== 'string') throw new Error(`${path} must be a string`);
  return value;
}

function nonNegativeFiniteNumber(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`${path} must be a non-negative finite number`);
  }
  return value;
}
