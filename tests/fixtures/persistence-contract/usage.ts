export const USAGE_LEGACY_RECORD = {
  id: 'usage-contract-1',
  recordedAt: 1_700_000_000_000,
  totalTokens: 123,
  additiveUsageField: { preserve: true },
} as const;

export const USAGE_STORAGE_REJECTED_STATES = {
  futureEnvelope: { version: 2, records: [] },
  corruptRow: [{ id: 'broken-usage' }],
  invalidDay: [{ ...USAGE_LEGACY_RECORD, day: '2026-99-99' }],
  duplicateId: [USAGE_LEGACY_RECORD, { ...USAGE_LEGACY_RECORD }],
} as const;
