import type { Memory, ToolDescriptor } from '../types';
import { DEFAULT_LOCALE, translate, type SupportedLocale } from '../i18n';
import {
  DEFAULT_TOOL_DESCRIPTORS,
  createDefaultToolDescriptors,
  createToolInvocationCatalog,
  getPreferredToolInvocationName,
} from '../tool';
import { estimateTokens, formatMemoriesBlock, getMemoryBudget, selectMemories } from '../memory/selector';
import { markVisibleUserPrompt } from './visibility';
import { buildStablePrefix, PROMPT_CACHE_BOUNDARY } from './cache-boundary';
import { getToolGroup, getGroupIdsForScenario, SCENARIO_GUIDANCE, TOOL_PRIORITY_RULES } from './scenario';
import type { AgentScenario, PromptSection, PromptBudget } from './types';
import { createDefaultBudget, COMPRESSION_SOFT_THRESHOLD } from './types';

export interface PromptAugmentationOptions {
  memories?: readonly Memory[];
  thinkingEnabled?: boolean;
  identityOnly?: boolean;
  presetContent?: string | null;
  projectContext?: string | null;
  toolDescriptors?: readonly ToolDescriptor[];
  locale?: SupportedLocale;
  memoryEnabled?: boolean;
  systemPromptEnabled?: boolean;
  forceResponseLanguage?: SupportedLocale | null;
  /** New: agent scenario for tool filtering */
  scenario?: AgentScenario;
  /** New: estimated total tokens so far (for budget management) */
  estimatedTotalTokens?: number;
  /** New: custom budget (defaults to createDefaultBudget()) */
  budget?: PromptBudget;
  /** New: connected MCP host names (e.g. ['com.deepseek_pp.shell']) */
  connectedHosts?: string[];
}

export interface PromptAugmentationResult {
  augmented: string;
  usedMemoryIds: number[];
  renderedToolCount: number;
  /** New: sections for debugging/telemetry */
  sections: PromptSection[];
  /** New: whether compression was applied */
  compressed: boolean;
}

/**
 * Build the static (cacheable) part of the prompt prefix.
 * Identical across requests with the same scenario.
 */
function buildStaticSystemPrompt(locale: SupportedLocale): string {
  return buildStablePrefix()
    .map(s => s.content)
    .join('\n\n');
}

/**
 * Build the dynamic suffix (per-request, after cache boundary).
 * Includes scenario guidance, tool list, project context, memories.
 */
function buildDynamicSuffix(
  scenario: AgentScenario,
  toolDescriptors: readonly ToolDescriptor[],
  projectContext: string | null,
  memBlock: string,
  memoryEnabled: boolean,
  locale: SupportedLocale,
  connectedHosts: string[],
): string {
  const sections: string[] = [];

  // 1. Scenario context
  sections.push('## Current Scenario');
  sections.push(SCENARIO_GUIDANCE[scenario]);

  // 2. Tool selection priority rules
  const priorityRules = TOOL_PRIORITY_RULES[scenario];
  if (priorityRules.length > 0) {
    sections.push('## Tool Selection Guide');
    sections.push(priorityRules.join('\n'));
  }

  // 3. Filtered tool list (only tools in current scenario's groups)
  // Generate a compact tool list rather than full XML schemas
  const allowedGroups = new Set(getGroupIdsForScenario(scenario));
  const filtered = toolDescriptors.filter(d => {
    const group = getToolGroup(d.name);
    return allowedGroups.has(group);
  });

  if (filtered.length > 0) {
    sections.push('## Available Tools');
    sections.push(`You have ${filtered.length} tools available in this scenario. Use them by name as XML tags:`);

    // Group tools by category for readability
    const grouped = new Map<string, typeof filtered>();
    for (const tool of filtered) {
      const group = getToolGroup(tool.name);
      if (!grouped.has(group)) grouped.set(group, []);
      grouped.get(group)!.push(tool);
    }

    for (const [groupName, tools] of grouped) {
      sections.push(`\n### ${groupName}`);
      for (const tool of tools) {
        // Compact: name + description only, no full schema
        sections.push(`- ${tool.name}: ${tool.description}`);
      }
    }
  }

  // 4. Memories
  if (memoryEnabled && memBlock) {
    sections.push('\n## Memories');
    sections.push(memBlock);
  }

  // 5. Project context
  if (projectContext) {
    sections.push('\n## Project Context');
    sections.push(projectContext);
  }

  // 6. Tool call format reminder (short)
  sections.push('\nCall tools with XML tags: <tool_name>{"key":"value"}</tool_name>');

  return sections.join('\n');
}

/**
 * Render full XML schemas for a subset of tools.
 * Used sparingly — only when new tools are first introduced or on explicit request.
 */
function renderFullToolSchemas(
  descriptors: readonly ToolDescriptor[],
  locale: SupportedLocale,
): string {
  const catalog = createToolInvocationCatalog(descriptors);
  const schemas = descriptors
    .map((descriptor) => renderToolSchema(descriptor, catalog))
    .join('\n\n');
  return schemas;
}

export function renderToolSchemas(descriptors?: readonly ToolDescriptor[], locale?: SupportedLocale): string {
  return renderFullToolSchemas(descriptors ?? createDefaultToolDescriptors(locale ?? DEFAULT_LOCALE), locale ?? DEFAULT_LOCALE);
}

function renderToolSchema(descriptor: ToolDescriptor, catalog: ReturnType<typeof createToolInvocationCatalog>): string {
  const examplePayload = createExamplePayload(descriptor);
  const preferredName = getPreferredToolInvocationName(descriptor, catalog);
  return [
    `### ${preferredName}`,
    `${descriptor.title}: ${descriptor.description}`,
    `<${preferredName}>`,
    JSON.stringify(examplePayload, null, 2),
    `</${preferredName}>`,
  ].filter(Boolean).join('\n');
}

function createExamplePayload(descriptor: ToolDescriptor): Record<string, unknown> {
  const properties = descriptor.inputSchema.properties ?? {};
  const required = descriptor.inputSchema.required ?? Object.keys(properties);
  const payload: Record<string, unknown> = {};
  for (const key of required) {
    payload[key] = exampleValue(properties[key]);
  }
  return payload;
}

function exampleValue(schema: unknown): unknown {
  if (!schema || typeof schema !== 'object') return 'value';
  const value = schema as Record<string, unknown>;
  const type = value.type;
  if (Array.isArray(type)) return exampleValue({ ...value, type: type[0] });
  if (value.enum && Array.isArray(value.enum) && value.enum.length > 0) return value.enum[0];
  switch (type) {
    case 'number': case 'integer': return 0;
    case 'boolean': return false;
    case 'array': return [];
    case 'object': return {};
    case 'string': default: return 'value';
  }
}

export function buildPromptAugmentation(
  originalPrompt: string,
  options?: PromptAugmentationOptions,
): PromptAugmentationResult {
  const {
    memories = [],
    thinkingEnabled = false,
    identityOnly = false,
    presetContent = null,
    projectContext = null,
    locale = DEFAULT_LOCALE,
    memoryEnabled = true,
    systemPromptEnabled = true,
    forceResponseLanguage = null,
    scenario = 'chat',
    estimatedTotalTokens = 0,
    budget = createDefaultBudget(),
    connectedHosts = [],
  } = options ?? {};
  const toolDescriptors = options?.toolDescriptors ?? createDefaultToolDescriptors(locale);

  // Memory selection with budget
  const promptTokens = estimateTokens(originalPrompt);
  const memBudget = getMemoryBudget(promptTokens);
  const selected = memoryEnabled
    ? selectMemories(originalPrompt, [...memories], { budget: memBudget, identityOnly })
    : [];
  const memBlock = memoryEnabled
    ? formatMemoriesBlock(selected, locale)
    : '';

  // Determine if compression is needed
  const thresholdTokens = Math.floor(budget.maxTokens * COMPRESSION_SOFT_THRESHOLD);
  const needsCompression = estimatedTotalTokens > thresholdTokens;
  const compressed = needsCompression;

  // Build static prefix (cacheable)
  const staticPrefix = systemPromptEnabled
    ? buildStaticSystemPrompt(locale)
    : '';

  // Build dynamic suffix (per-request)
  let dynamicSuffix = systemPromptEnabled
    ? buildDynamicSuffix(scenario, toolDescriptors, projectContext, memBlock, memoryEnabled, locale, connectedHosts)
    : '';

  // Full tool schema injection — only include compact list by default,
  // unless this is a first request or scenario just switched
  // (detected by checking if tool section needs full schemas)
  // For now, we skip full schemas to keep prompts small.

  // Force response language
  if (forceResponseLanguage) {
    const language = forceResponseLanguage === 'en' ? 'English' : 'Chinese';
    dynamicSuffix += `\n\n## Language\nRespond in ${language}.`;
  }

  // Assemble the full prompt
  const sections: PromptSection[] = [
    { id: 'preset', content: presetContent || '', isStable: false },
    { id: 'static-prefix', content: staticPrefix, isStable: true },
    { id: 'dynamic-boundary', content: `\n\n${PROMPT_CACHE_BOUNDARY}\n\n`, isStable: true },
    { id: 'dynamic-suffix', content: dynamicSuffix, isStable: false },
  ];

  const systemBeforePrompt = sections
    .filter(s => s.content)
    .map(s => s.content)
    .join('');
  const presetPrefix = presetContent ? `${presetContent}\n\n---\n\n` : '';
  const systemPrefix = systemBeforePrompt ? `${systemBeforePrompt}\n\n` : '';
  const augmented = presetPrefix + systemPrefix + markVisibleUserPrompt(originalPrompt);

  return {
    augmented,
    usedMemoryIds: selected.map((m) => m.id!).filter(Boolean),
    renderedToolCount: systemPromptEnabled ? toolDescriptors.length : 0,
    sections: sections.filter(s => s.content.length > 0),
    compressed,
  };
}
