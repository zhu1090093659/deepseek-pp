import { SYSTEM_TEMPLATE_CHAT, SYSTEM_TEMPLATE_THINKING } from '../constants';
import { SHELL_TOOL_NAMES } from '../shell/contracts';
import type { Memory, ToolDescriptor } from '../types';
import {
  DEFAULT_TOOL_DESCRIPTORS,
  createToolInvocationCatalog,
  getPreferredToolInvocationName,
  getToolInvocationNames,
  type ToolInvocationCatalog,
} from '../tool';
import { estimateTokens, formatMemoriesBlock, getMemoryBudget, selectMemories } from '../memory/selector';
import { markVisibleUserPrompt } from './visibility';

export interface PromptAugmentationOptions {
  memories?: readonly Memory[];
  thinkingEnabled?: boolean;
  identityOnly?: boolean;
  presetContent?: string | null;
  toolDescriptors?: readonly ToolDescriptor[];
}

export interface PromptAugmentationResult {
  augmented: string;
  usedMemoryIds: number[];
  renderedToolCount: number;
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
    toolDescriptors = DEFAULT_TOOL_DESCRIPTORS,
  } = options ?? {};

  const promptTokens = estimateTokens(originalPrompt);
  const budget = getMemoryBudget(promptTokens);
  const selected = selectMemories(originalPrompt, [...memories], { budget, identityOnly });
  const memBlock = formatMemoriesBlock(selected);
  const toolsBlock = renderToolSchemas(toolDescriptors);
  const template = thinkingEnabled ? SYSTEM_TEMPLATE_THINKING : SYSTEM_TEMPLATE_CHAT;
  const baseSystem = template
    .replace('{{memories}}', memBlock)
    .replace('{{tools}}', toolsBlock);
  const system = [
    baseSystem,
    renderWebSearchGuidance(toolDescriptors),
  ].filter(Boolean).join('\n\n');
  const presetPrefix = presetContent ? `${presetContent}\n\n---\n\n` : '';
  const toolReminder = renderToolFormatReminder(toolDescriptors);

  return {
    augmented: presetPrefix + system + markVisibleUserPrompt(originalPrompt) + toolReminder,
    usedMemoryIds: selected.map((memory) => memory.id!).filter(Boolean),
    renderedToolCount: toolDescriptors.length,
  };
}

export function renderToolSchemas(descriptors: readonly ToolDescriptor[] = DEFAULT_TOOL_DESCRIPTORS): string {
  const catalog = createToolInvocationCatalog(descriptors);
  const shellHint = renderShellMcpHint(descriptors, catalog);
  const pythonHint = renderPythonMcpHint(descriptors, catalog);
  const schemas = descriptors
    .map((descriptor) => renderToolSchema(descriptor, catalog))
    .join('\n\n');
  return [shellHint, pythonHint, schemas].filter(Boolean).join('\n\n');
}

function renderWebSearchGuidance(descriptors: readonly ToolDescriptor[]): string {
  const hasWebSearch = descriptors.some((descriptor) => descriptor.name === 'web_search');
  if (!hasWebSearch) return '';

  return [
    '## 网络搜索规则',
    '',
    '当对话中出现以下情况时，你应当使用 web_search 工具搜索互联网：',
    '- 用户询问实时信息、新闻、事件、汇率、天气等',
    '- 用户询问你不确定的知识，需要查阅最新资料',
    '- 用户明确要求你搜索或查询某些信息',
    '- 你需要验证事实、数据或引用来源',
    '',
    '### 搜索流程',
    '1. 先输出 web_search 工具调用进行搜索',
    '2. 搜索会自动执行，结果会展示在页面上并回传给你',
    '3. 阅读搜索结果后，基于结果给出回答',
    '',
    '### 示例',
    '',
    '用户：2024年诺贝尔奖得主是谁？',
    '助手回复：',
    '',
    '我帮你搜索一下最新的信息。',
    '',
    '<web_search>',
    '{"query": "2024 诺贝尔奖得主"}',
    '</web_search>',
    '',
    '### 规则',
    '- 搜索时使用中文关键词可获得更好的中文结果',
    '- 如果一次搜索不够，可以继续调用 web_search 搜索不同关键词',
    '- 不要在没有搜索的情况下编造实时信息',
  ].join('\n');
}

function renderPythonMcpHint(
  descriptors: readonly ToolDescriptor[],
  catalog: ToolInvocationCatalog,
): string {
  const pythonExec = descriptors.find((descriptor) => descriptor.name === 'python_exec');
  const pythonStatus = descriptors.find((descriptor) => descriptor.name === 'python_status');
  if (!pythonExec && !pythonStatus) return '';

  const execName = pythonExec ? getPreferredToolInvocationName(pythonExec, catalog) : null;
  const statusName = pythonStatus ? getPreferredToolInvocationName(pythonStatus, catalog) : null;

  return [
    '### Python Quick Validation Capability',
    execName
      ? `Use <${execName}> for short Python snippets that verify an idea, perform complex calculations, or transform small data. Treat it as a scratchpad, not as a general local execution environment.`
      : '',
    statusName
      ? `Use <${statusName}>{}</${statusName}> when you need to know the Python version or whether numpy, pandas, or sympy are available.`
      : '',
    'Assume the Python standard library is available. Only use numpy, pandas, or sympy after python_status reports them as available.',
    'Do not install packages, access sensitive local files, run long jobs, or use network access through Python. Keep code short and return concise text or JSON.',
  ].filter(Boolean).join('\n');
}

function renderToolSchema(descriptor: ToolDescriptor, catalog: ToolInvocationCatalog): string {
  const examplePayload = createExamplePayload(descriptor);
  const preferredName = getPreferredToolInvocationName(descriptor, catalog);
  const acceptedNames = getToolInvocationNames(descriptor, catalog);
  const lines = [
    `### Tool ${preferredName}`,
    `Title: ${descriptor.title}`,
    `Description: ${descriptor.description}`,
    acceptedNames.length > 1 ? `Accepted tag names: ${acceptedNames.join(', ')}` : '',
    `Valid call format for ${preferredName}:`,
    `<${preferredName}>`,
    JSON.stringify(examplePayload, null, 2),
    `</${preferredName}>`,
    `Invalid formats: <invoke name="${preferredName}">...</invoke>, <tool_call>...</tool_call>`,
    `Parameters JSON Schema: ${JSON.stringify(descriptor.inputSchema)}`,
  ];
  return lines.filter(Boolean).join('\n');
}

function renderShellMcpHint(
  descriptors: readonly ToolDescriptor[],
  catalog: ToolInvocationCatalog,
): string {
  const shellExec = descriptors.find((descriptor) => descriptor.name === 'shell_exec');
  if (!shellExec) return '';

  const shellStatus = descriptors.find((descriptor) => descriptor.name === 'shell_status');
  const execName = getPreferredToolInvocationName(shellExec, catalog);
  const statusName = shellStatus ? getPreferredToolInvocationName(shellStatus, catalog) : null;

  return [
    '### Shell MCP Capability',
    'Shell MCP is connected through the extension. You can execute local CLI commands by emitting the executable XML tool tag; do not say you cannot run commands when this tool is listed.',
    `Use <${execName}> with a JSON body such as {"command":"officecli --version","timeout_ms":60000} to run OfficeCLI or other local CLI tools.`,
    statusName
      ? `Use <${statusName}>{}</${statusName}> first when you need host status, shell, PATH, or working-directory context.`
      : '',
    'Match command syntax to shell_status.shell. On Windows the Shell Local host uses PowerShell by default, so list files with commands such as Get-ChildItem -LiteralPath "D:\\\\Documents\\\\Downloads\\\\CN" -File | Select-Object -ExpandProperty FullName, and quote paths once inside the command string. Use cmd.exe /c explicitly only when you need CMD syntax such as dir /b.',
    `Recognized shell tool names: ${SHELL_TOOL_NAMES.join(', ')}`,
  ].filter(Boolean).join('\n');
}

export function renderToolFormatReminder(descriptors: readonly ToolDescriptor[]): string {
  const catalog = createToolInvocationCatalog(descriptors);
  const names = catalog.invocationNames;
  if (names.length === 0) return '';
  return [
    '',
    '',
    '---',
    'Tool call format reminder:',
    `Available tool tag names: ${names.join(', ')}`,
    'These listed tools are executable by the extension. Do not claim you cannot call a listed MCP tool.',
    'To call a tool, use ONLY the direct XML tag whose name is the tool name, with valid JSON as the body.',
    'For MCP tools, prefer the short tag name when it appears in the available names list.',
    'For local file paths, use forward slashes or escaped backslashes so the JSON body remains valid.',
    'Do not use <invoke name="...">, <tool_call>, Markdown code fences, {"tool":"...","arguments":{...}}, or any wrapper format.',
    'Do not put executable tool XML in a thinking/reasoning section; put it in the final assistant answer content.',
  ].join('\n');
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
    case 'number':
    case 'integer':
      return 0;
    case 'boolean':
      return false;
    case 'array':
      return [];
    case 'object':
      return {};
    case 'string':
    default: {
      const desc = typeof value.description === 'string' ? value.description.toLowerCase() : '';
      if (type === 'string' && (desc.includes('file path') || desc.includes('file_path') || desc.includes('filepath'))) {
        if (desc.includes('.pptx')) return './example.pptx';
        if (desc.includes('.docx')) return './example.docx';
        if (desc.includes('.xlsx')) return './example.xlsx';
        return './example.txt';
      }
      return 'value';
    }
  }
}
