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

export const MEMORY_CURRENT_GAPS = [
  {
    name: 'future IndexedDB versions fail during Dexie open without a recoverable raw-data path',
    currentBehavior: 'dexie-open-rejection',
    target: 'preserve-future-database-without-overwrite-after-T3.3',
  },
  {
    name: 'sync rollback restores raw rows but IndexedDB does not rewind its hidden auto-increment generator',
    currentBehavior: 'next-memory-id-may-skip-after-rollback',
    target: 'define-logical-id-allocation-with-schema-migration-after-T3.3',
  },
] as const;
