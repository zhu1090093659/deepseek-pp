import type { ToolCall, ToolDescriptor, ToolExecutionRecord } from '../types';
import type { SupportedLocale } from '../i18n';

export interface InlineAgentStartPayload {
  loopId: string;
  chatSessionId: string;
  parentMessageId: number;
  originalPrompt: string;
  agentTaskPrompt: string;
  toolExecutions: ToolExecutionRecord[];
  promptOptions: InlineAgentPromptOptions;
  toolDescriptors: ToolDescriptor[];
  locale?: SupportedLocale;
  powWasmUrl?: string;
}

export interface InlineAgentPromptOptions {
  modelType: string | null;
  searchEnabled: boolean;
  thinkingEnabled: boolean;
  refFileIds: string[];
}

export type InlineAgentStepStatus = 'streaming' | 'executing_tools' | 'complete' | 'error';
export type InlineAgentLoopStatus = 'idle' | 'running' | 'stopping' | 'complete' | 'error';

export interface InlineAgentStepState {
  index: number;
  status: InlineAgentStepStatus;
  streamedText: string;
  toolCalls: ToolCall[];
  toolExecutions: ToolExecutionRecord[];
  responseMessageId: number | null;
}

export interface InlineAgentLoopState {
  loopId: string;
  chatSessionId: string;
  parentMessageId: number | null;
  status: InlineAgentLoopStatus;
  currentStepIndex: number;
  steps: InlineAgentStepState[];
  totalToolExecutions: number;
  startedAt: number;
}

export interface InlineAgentTraceStepRecord {
  index: number;
  status: InlineAgentStepStatus;
  text: string;
  toolExecutions: ToolExecutionRecord[];
  responseMessageId: number | null;
  collapsed: boolean;
}

export interface InlineAgentTraceRecord {
  id: string;
  loopId: string;
  chatSessionId: string;
  anchorMessageId: number;
  anchorMessageIndex?: number | null;
  anchorContent?: string;
  url: string;
  originalPrompt: string;
  agentTaskPrompt: string;
  status: InlineAgentLoopStatus;
  steps: InlineAgentTraceStepRecord[];
  totalSteps: number;
  totalTools: number;
  finalText: string;
  error?: string;
  createdAt: number;
  updatedAt: number;
}

export interface InlineAgentStreamChunkMsg {
  loopId: string;
  stepIndex: number;
  text: string;
  fullText: string;
}

export interface InlineAgentToolDetectedMsg {
  loopId: string;
  stepIndex: number;
  call: ToolCall;
}

export interface InlineAgentStepCompleteMsg {
  loopId: string;
  stepIndex: number;
  responseMessageId: number | null;
  toolExecutions: ToolExecutionRecord[];
}

export interface InlineAgentLoopCompleteMsg {
  loopId: string;
  totalSteps: number;
  totalTools: number;
  finalText: string;
}

export interface InlineAgentLoopErrorMsg {
  loopId: string;
  stepIndex: number;
  totalTools: number;
  error: string;
}

export const INLINE_AGENT_MAX_STEPS = 12;
export const INLINE_AGENT_MAX_NUDGES = 3;
export const INLINE_AGENT_STEP_TIMEOUT_MS = 90_000;
export const INLINE_AGENT_REQUEST_DELAY_MIN_MS = 1_000;
export const INLINE_AGENT_REQUEST_DELAY_MAX_MS = 3_000;
