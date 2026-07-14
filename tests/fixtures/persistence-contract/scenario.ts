export const SCENARIO_STORAGE = [
  {
    id: 'summarize',
    label: 'Historical label ignored for built-in',
    template: 'Custom summary template: {text}',
    builtIn: true,
    enabled: false,
    additiveField: { preserve: true },
  },
  {
    id: 'custom_contract',
    label: 'Contract scenario',
    template: 'Preserve exactly: {text}',
    builtIn: false,
    enabled: true,
    additiveField: { preserve: 'custom' },
  },
] as const;

export const SCENARIO_REJECTED_STATES = {
  future: {
    schemaVersion: 2,
    items: SCENARIO_STORAGE,
  },
  corrupt: {
    scenarios: SCENARIO_STORAGE,
  },
} as const;
