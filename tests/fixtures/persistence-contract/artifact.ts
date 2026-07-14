export const LEGACY_ARTIFACT_RECORD = {
  id: 'artifact-contract-1',
  kind: 'file',
  filename: 'contract.md',
  mimeType: 'text/markdown',
  content: '# Persistence contract',
  sizeBytes: 22,
  createdAt: 200,
  view: { previewMode: 'none', language: 'text' },
} as const;

export const ADDITIVE_LEGACY_ARTIFACT_RECORD = {
  ...LEGACY_ARTIFACT_RECORD,
  id: 'artifact-contract-additive',
  kind: 'bundle',
  filename: 'contract.zip',
  mimeType: 'application/zip',
  content: 'UEsD',
  sizeBytes: 4,
  createdAt: 201,
  files: [
    {
      path: 'src/index.ts',
      content: 'export const compatible = true;',
      mimeType: 'text/typescript',
      additiveFileMetadata: { preserve: true },
    },
  ],
  additiveRecordMetadata: {
    preserve: true,
    nested: ['raw', 'shape'],
  },
} as const;

export const LEGAL_LEGACY_ARTIFACT_STORAGE = [
  LEGACY_ARTIFACT_RECORD,
  ADDITIVE_LEGACY_ARTIFACT_RECORD,
] as const;

export const REJECTED_LEGACY_ARTIFACT_STATES = {
  corruptRow: [
    LEGACY_ARTIFACT_RECORD,
    { id: 'invalid-artifact', kind: 'file', filename: 'missing-content.md' },
  ],
  nonArray: {
    schemaVersion: 2,
    artifacts: [LEGACY_ARTIFACT_RECORD],
  },
  duplicateId: [
    LEGACY_ARTIFACT_RECORD,
    {
      ...LEGACY_ARTIFACT_RECORD,
      filename: 'duplicate-id.md',
    },
  ],
} as const;

export const LEGACY_ARTIFACTS_OVER_RETENTION_LIMIT = Array.from(
  { length: 51 },
  (_, index) => ({
    ...LEGACY_ARTIFACT_RECORD,
    id: `artifact-contract-${String(index).padStart(2, '0')}`,
    filename: `contract-${String(index).padStart(2, '0')}.md`,
    content: `# Persistence contract ${index}`,
    sizeBytes: 24 + String(index).length,
    createdAt: 1_000 + index,
  }),
);
