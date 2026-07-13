export const SAVED_ITEM = {
  id: 'saved-contract-1',
  syncId: 'sync-saved-contract-1',
  kind: 'snippet',
  title: 'Reusable contract prompt',
  content: 'Preserve this saved item.',
  sourceUrl: 'https://example.test/contracts',
  tags: ['contract', 'prompt'],
  createdAt: 500,
  updatedAt: 510,
} as const;

export const LEGACY_SAVED_ITEMS_ARRAY = [SAVED_ITEM] as const;

export const SAVED_ITEMS_V1_STATE = {
  schemaVersion: 1,
  items: [SAVED_ITEM],
} as const;

export const SAVED_ITEMS_FUTURE_VERSION_GAP = {
  name: 'local decoder silently downgrades an explicit future saved-items version',
  input: { schemaVersion: 2, items: [SAVED_ITEM], futureField: 'preserve-me' },
  currentOutput: SAVED_ITEMS_V1_STATE,
  target: 'reject-without-overwrite-after-T3.3',
} as const;
