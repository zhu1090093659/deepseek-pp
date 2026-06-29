import type { ToolDescriptor, ToolExecutionRecord } from '../types';

/**
 * Prompt section types matching Claude Code's modular architecture.
 * Each section is self-contained, independently testable, and
 * contributes to the prompt cache prefix.
 */
export interface PromptSection {
  /** Unique within-prompt section identifier */
  id: string;
  /** Rendered text content */
  content: string;
  /** Whether this section is part of the stable cache prefix */
  isStable: boolean;
}

/**
 * Agent scenario — determines which tool groups are injected.
 */
export type AgentScenario =
  | 'chat'       // Daily conversation: memory, web, artifact, sandbox
  | 'coding'     // Coding tasks: file, code, git, shell, sandbox + all base
  | 'automation' // Scheduled tasks: web, shell, browser
  | 'browsing';  // Browser control: browser, web

/**
 * Tool group identifier
 */
export type ToolGroupId =
  | 'memory'
  | 'web'
  | 'shell'
  | 'file'
  | 'code'
  | 'git'
  | 'artifact'
  | 'sandbox'
  | 'browser'
  | 'mcp';

/**
 * Tool group definition with scenario mapping
 */
export interface ToolGroup {
  id: ToolGroupId;
  title: string;
  scenarios: AgentScenario[];
  /** If non-empty, only inject when at least one of these MCP hosts is connected */
  requiresHost?: string[];
}

/**
 * Prompt budget — proportional allocation of context window
 */
export interface PromptBudget {
  /** Total available tokens (default 128K for DeepSeek V3) */
  maxTokens: number;
  /** System prompt budget (identity, rules, tool usage) */
  systemTokens: number;
  /** Tool definition budget (schemas, examples) */
  toolTokens: number;
  /** User instruction + project context budget */
  instructionTokens: number;
  /** Tool result budget */
  resultTokens: number;
  /** Conversation history budget */
  historyTokens: number;
  /** Reserved for output */
  reservedTokens: number;
}

/**
 * Compression trigger thresholds (percentage of maxTokens)
 */
export const COMPRESSION_SOFT_THRESHOLD = 0.65;
export const COMPRESSION_HARD_THRESHOLD = 0.80;

/**
 * Token estimation (rough: ~4 chars per token for CJK, ~5 for English)
 */
export function estimateTokens(text: string): number {
  // More accurate than simple /4: CJK chars are ~2 tokens, ASCII ~0.25
  let tokens = 0;
  for (const char of text) {
    const code = char.charCodeAt(0);
    if (code > 0x7f) tokens += 2;
    else tokens += 0.25;
  }
  return Math.max(1, Math.ceil(tokens));
}

/**
 * Default budget for 128K context
 */
export function createDefaultBudget(): PromptBudget {
  return {
    maxTokens: 128_000,
    systemTokens: 2_500,
    toolTokens: 2_000,
    instructionTokens: 1_500,
    resultTokens: 5_000,
    historyTokens: 3_000,
    reservedTokens: 4_000,
  };
}
