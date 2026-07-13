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

export const LEGAL_LEGACY_ARTIFACT_STORAGE = [LEGACY_ARTIFACT_RECORD] as const;

export const ARTIFACT_FILTERING_DATA_LOSS_GAP = {
  name: 'invalid legacy rows are filtered before successful migration removes the original raw key',
  input: [
    LEGACY_ARTIFACT_RECORD,
    { id: 'invalid-artifact', kind: 'file', filename: 'missing-content.md' },
  ],
  currentOutput: [LEGACY_ARTIFACT_RECORD],
  currentBehavior: 'filter-then-delete-original',
  target: 'preserve-unread-rows-for-explicit-recovery-after-T3.3',
} as const;

export const ARTIFACT_CURRENT_GAPS = [
  ARTIFACT_FILTERING_DATA_LOSS_GAP,
  {
    name: 'failed IndexedDB migration falls back to legacy storage and is not retried in the session',
    currentBehavior: 'warn-fallback-memoized-failure',
    target: 'single-authoritative-store-after-T3.3',
  },
  {
    name: 'recovered IndexedDB can hide still-readable legacy data behind dual storage truths',
    currentBehavior: 'indexeddb-first-legacy-second',
    target: 'single-authoritative-store-after-T3.3',
  },
] as const;
