export const SCENARIO_STORAGE = [
  {
    id: 'summarize',
    label: 'Historical label ignored for built-in',
    template: 'Custom summary template: {text}',
    builtIn: true,
    enabled: false,
  },
  {
    id: 'custom_contract',
    label: 'Contract scenario',
    template: 'Preserve exactly: {text}',
    builtIn: false,
    enabled: true,
  },
] as const;

export const SCENARIO_CURRENT_GAP = {
  name: 'storage read failures silently return built-ins and a later save can overwrite unread data',
  currentBehavior: 'default-builtins-on-any-read-error',
  target: 'surface-read-failure-without-overwrite-after-T3.3',
} as const;
