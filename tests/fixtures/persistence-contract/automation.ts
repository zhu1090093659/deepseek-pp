const PROMPT_OPTIONS = {
  modelType: null,
  searchEnabled: false,
  thinkingEnabled: false,
  refFileIds: [],
} as const;

export const AUTOMATION_STORAGE_V1_LEGACY = {
  version: 1,
  additiveRootField: { preserve: true },
  automations: [{
    id: 'automation-contract-1',
    name: 'Compatibility automation',
    prompt: 'Run the compatibility check.',
    status: 'active',
    schedule: {
      kind: 'manual',
      expression: null,
      timezone: 'UTC',
      enabled: false,
      minimumIntervalMinutes: 0,
    },
    promptOptions: PROMPT_OPTIONS,
    createdAt: 1_000,
    updatedAt: 1_000,
    lastRunAt: null,
    nextRunAt: null,
    lastError: null,
    version: 1,
    additiveAutomationField: { preserve: true },
  }],
  runs: [{
    id: 'automation-run-contract-1',
    automationId: 'automation-contract-1',
    trigger: 'manual',
    status: 'running',
    scheduledFor: null,
    attempt: 1,
    request: {
      runId: 'automation-run-contract-1',
      automationId: 'automation-contract-1',
      prompt: 'Run the compatibility check.',
      trigger: 'manual',
      chatSessionId: null,
      parentMessageId: '42',
      promptOptions: PROMPT_OPTIONS,
      requestedAt: 1_100,
    },
    result: null,
    error: null,
    createdAt: 1_100,
    startedAt: 1_100,
    completedAt: null,
    updatedAt: 1_100,
    additiveRunField: { preserve: true },
  }],
} as const;

export const AUTOMATION_STORAGE_V1_ORPHAN_RUN = {
  version: 1,
  automations: [],
  runs: AUTOMATION_STORAGE_V1_LEGACY.runs,
} as const;

export const AUTOMATION_STORAGE_REJECTED_STATES = {
  futureRoot: { version: 2, automations: [], runs: [] },
  futureAutomation: {
    ...AUTOMATION_STORAGE_V1_LEGACY,
    automations: [{ ...AUTOMATION_STORAGE_V1_LEGACY.automations[0], version: 2 }],
  },
  duplicateAutomation: {
    version: 1,
    automations: [
      AUTOMATION_STORAGE_V1_LEGACY.automations[0],
      AUTOMATION_STORAGE_V1_LEGACY.automations[0],
    ],
    runs: [],
  },
  corruptRun: {
    version: 1,
    automations: AUTOMATION_STORAGE_V1_LEGACY.automations,
    runs: [{ id: 'broken-run' }],
  },
} as const;
