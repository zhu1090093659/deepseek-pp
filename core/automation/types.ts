import type { Memory, ToolDescriptor, ToolExecutionRecord } from '../types';
import type { SupportedLocale } from '../i18n';

export type AutomationId = string;
export type AutomationRunId = string;

export type AutomationStatus = 'active' | 'paused' | 'archived';

export type AutomationRunStatus =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'timeout'
  | 'cancelled'
  | 'skipped';

export type AutomationTrigger = 'manual' | 'schedule' | 'retry';

export type AutomationScheduleKind = 'manual' | 'cron' | 'rrule';

export type AutomationFailurePhase =
  | 'schedule'
  | 'storage'
  | 'tab'
  | 'bridge'
  | 'auth'
  | 'session'
  | 'runner'
  | 'pow'
  | 'completion'
  | 'history'
  | 'unknown';

export interface AutomationSchedule {
  kind: AutomationScheduleKind;
  expression: string | null;
  timezone: string;
  enabled: boolean;
  minimumIntervalMinutes: number;
}

export interface AutomationPromptOptions {
  modelType: string | null;
  searchEnabled: boolean;
  thinkingEnabled: boolean;
  refFileIds: string[];
}

export interface AutomationDeepSeekSession {
  chatSessionId: string | null;
  parentMessageId: number | null;
  sessionUrl: string | null;
  lastHistorySyncedAt: number | null;
}

export interface AutomationErrorState {
  code: string;
  message: string;
  phase: AutomationFailurePhase;
  retryable: boolean;
  at: number;
  details?: Record<string, unknown>;
}

export interface Automation {
  id: AutomationId;
  name: string;
  prompt: string;
  status: AutomationStatus;
  schedule: AutomationSchedule;
  promptOptions: AutomationPromptOptions;
  deepseek: AutomationDeepSeekSession;
  createdAt: number;
  updatedAt: number;
  lastRunAt: number | null;
  nextRunAt: number | null;
  lastError: AutomationErrorState | null;
  version: number;
}

export type AutomationCreateInput = Pick<Automation, 'name' | 'prompt' | 'schedule' | 'promptOptions'>;

export type AutomationUpdateInput = Partial<
  Pick<Automation, 'name' | 'prompt' | 'status' | 'schedule' | 'promptOptions' | 'nextRunAt'>
>;

export type AutomationRuntimeUpdate = Partial<
  Pick<Automation, 'deepseek' | 'lastRunAt' | 'nextRunAt' | 'lastError' | 'status'>
>;

export interface AutomationRunnerRequest {
  runId: AutomationRunId;
  automationId: AutomationId;
  deadlineAt: number;
  prompt: string;
  trigger: AutomationTrigger;
  chatSessionId: string | null;
  parentMessageId: number | null;
  promptOptions: AutomationPromptOptions;
  locale?: SupportedLocale;
  promptContext?: AutomationPromptContext;
  requestedAt: number;
}

export interface AutomationPromptContext {
  memories?: Memory[];
  presetContent?: string | null;
  projectContext?: string | null;
  toolDescriptors?: ToolDescriptor[];
}

export interface AutomationHistorySnapshot {
  chatSessionId: string;
  parentMessageId: number | null;
  assistantMessageId: number | null;
  messageCount: number;
  verifiedAt: number;
}

export interface AutomationRunnerSuccess {
  ok: true;
  chatSessionId: string;
  sessionUrl: string | null;
  parentMessageId: number;
  assistantMessageId: number | null;
  assistantText: string;
  toolExecutions?: ToolExecutionRecord[];
  history: AutomationHistorySnapshot | null;
  completedAt: number;
}

export interface AutomationRunnerFailure {
  ok: false;
  chatSessionId: string | null;
  parentMessageId: number | null;
  error: AutomationErrorState;
  completedAt: number;
}

export type AutomationRunnerResult = AutomationRunnerSuccess | AutomationRunnerFailure;

export interface AutomationRun {
  id: AutomationRunId;
  automationId: AutomationId;
  trigger: AutomationTrigger;
  status: AutomationRunStatus;
  scheduledFor: number | null;
  attempt: number;
  request: AutomationRunnerRequest | null;
  result: AutomationRunnerResult | null;
  error: AutomationErrorState | null;
  createdAt: number;
  startedAt: number | null;
  completedAt: number | null;
  updatedAt: number;
}

export type AutomationRunUpdateInput = Partial<
  Pick<
    AutomationRun,
    'trigger' | 'status' | 'scheduledFor' | 'attempt' | 'request' | 'result' | 'error' | 'startedAt' | 'completedAt'
  >
>;

export interface AutomationRunListOptions {
  automationId: AutomationId;
  limit?: number;
}
