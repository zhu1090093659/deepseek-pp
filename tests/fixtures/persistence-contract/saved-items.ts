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

export const SAVED_ITEMS_VERSIONLESS_STATE = {
  items: SAVED_ITEMS_V1_STATE.items,
  additiveField: { preserve: true },
} as const;

export const SAVED_ITEMS_REJECTED_STATES = {
  future: { schemaVersion: 2, items: [SAVED_ITEM], futureField: 'preserve-me' },
  corrupt: { schemaVersion: 1, items: null },
} as const;
