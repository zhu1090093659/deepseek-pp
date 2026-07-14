export const MEMORY_V1_RECORD = {
  id: 7,
  type: 'topic',
  name: 'Memory schema contract',
  content: 'Preserve this historical memory.',
  description: 'Historical v1 record',
  tags: ['compatibility'],
  pinned: false,
  createdAt: 100,
  updatedAt: 110,
  accessCount: 2,
  lastAccessedAt: 120,
} as const;

export const MEMORY_V2_RECORD = {
  ...MEMORY_V1_RECORD,
  syncId: '00000000-0000-4000-8000-000000000007',
} as const;

export const MEMORY_V3_RECORD = {
  ...MEMORY_V2_RECORD,
  scope: 'global',
} as const;

export const MEMORY_V3_PROJECT_RECORD = {
  ...MEMORY_V2_RECORD,
  id: 8,
  syncId: '00000000-0000-4000-8000-000000000008',
  scope: 'project',
  projectId: 'project-v2',
} as const;

export const MEMORY_V1_ADDITIVE_RECORD = {
  ...MEMORY_V1_RECORD,
  futureRecordField: { source: 'v1', preserve: true },
} as const;

export const MEMORY_V2_ADDITIVE_RECORD = {
  ...MEMORY_V2_RECORD,
  futureRecordField: { source: 'v2', preserve: true },
} as const;

export const MEMORY_V3_PROJECT_ADDITIVE_RECORD = {
  ...MEMORY_V3_PROJECT_RECORD,
  futureRecordField: { source: 'v3', preserve: true },
} as const;

export const MEMORY_IMPORT_PREVIEW_RECORD = {
  type: 'reference',
  name: 'Preview-style memory',
  content: 'A preview result has no persisted identity or timestamps yet.',
  description: '',
  tags: ['preview'],
  pinned: false,
} as const;

export const MEMORY_HISTORICAL_EXPORT_RECORD = {
  ...MEMORY_V3_RECORD,
  id: 41,
  syncId: '00000000-0000-4000-8000-000000000041',
  name: 'Historical exported memory',
  description: '',
  createdAt: 410,
  updatedAt: 420,
  accessCount: 4,
  lastAccessedAt: 430,
} as const;

export const MEMORY_CORRUPT_RAW_RECORD = {
  ...MEMORY_V3_RECORD,
  id: 91,
  syncId: '00000000-0000-4000-8000-000000000091',
  scope: 'future-scope',
  recoveryOnlyField: { preserve: true },
} as const;

export const MEMORY_BOUNDED_GAPS = [
  {
    name: 'sync rollback restores raw rows but IndexedDB does not rewind its hidden auto-increment generator',
    currentBehavior: 'next-memory-id-may-skip-after-rollback',
    disposition: 'bounded-out-of-scope-no-second-allocator',
    target: 'preserve-released-auto-increment-and-allow-id-gaps',
  },
] as const;
