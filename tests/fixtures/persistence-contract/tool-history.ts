export const TOOL_HISTORY_LEGACY_RECORD = {
  id: 'tool-history-contract-1',
  call: {
    name: 'compatibility_tool',
    payload: { input: true },
    raw: '<compatibility_tool>{"input":true}</compatibility_tool>',
  },
  result: {
    ok: true,
    summary: 'Compatibility tool completed',
  },
  source: 'manual_chat',
  createdAt: 1_700_000_000_000,
  additiveHistoryField: { preserve: true },
} as const;

export const TOOL_HISTORY_STORAGE_REJECTED_STATES = {
  futureEnvelope: { version: 2, records: [] },
  corruptRow: [{ id: 'broken-history' }],
  duplicateId: [
    TOOL_HISTORY_LEGACY_RECORD,
    { ...TOOL_HISTORY_LEGACY_RECORD },
  ],
} as const;
