import { MEMORY_TOOL_DESCRIPTORS } from './memory';
import { WEB_SEARCH_TOOL_DESCRIPTORS } from './web-search';
import type { ToolCall, ToolDescriptor, ToolError, ToolPayload } from './types';

export const DEFAULT_TOOL_DESCRIPTORS: readonly ToolDescriptor[] = [
  ...MEMORY_TOOL_DESCRIPTORS,
  ...WEB_SEARCH_TOOL_DESCRIPTORS,
];

export interface ToolInvocationCatalog {
  descriptors: readonly ToolDescriptor[];
  invocationNames: string[];
  descriptorByInvocationName: Map<string, ToolDescriptor>;
  descriptorByName: Map<string, ToolDescriptor>;
  invocationNamesByDescriptorId: Map<string, string[]>;
}

export interface ToolParsingInput {
  descriptors?: readonly ToolDescriptor[];
}

const catalogCache = new WeakMap<readonly ToolDescriptor[], ToolInvocationCatalog>();
const xmlRegexSourceCache = new WeakMap<ToolInvocationCatalog, string>();

export function createToolInvocationCatalog(
  descriptors: readonly ToolDescriptor[] = DEFAULT_TOOL_DESCRIPTORS,
): ToolInvocationCatalog {
  const cached = catalogCache.get(descriptors);
  if (cached) return cached;

  const descriptorByInvocationName = new Map<string, ToolDescriptor>();
  const descriptorByName = new Map<string, ToolDescriptor>();
  const invocationNamesByDescriptorId = new Map<string, string[]>();
  const toolNameCounts = new Map<string, number>();

  for (const descriptor of descriptors) {
    const name = descriptor.name.trim();
    if (!isValidToolTagName(name)) continue;
    toolNameCounts.set(name, (toolNameCounts.get(name) ?? 0) + 1);
  }

  for (const descriptor of descriptors) {
    const invocationName = descriptor.invocationName.trim();
    const acceptedNames: string[] = [];
    if (isValidToolTagName(invocationName)) {
      addInvocationName(descriptorByInvocationName, acceptedNames, invocationName, descriptor);
    }

    const name = descriptor.name.trim();
    if (name && !descriptorByName.has(name)) {
      descriptorByName.set(name, descriptor);
    }

    if (
      name &&
      name !== invocationName &&
      isValidToolTagName(name) &&
      toolNameCounts.get(name) === 1
    ) {
      addInvocationName(descriptorByInvocationName, acceptedNames, name, descriptor);
    }

    invocationNamesByDescriptorId.set(descriptor.id, acceptedNames);
  }

  const catalog: ToolInvocationCatalog = {
    descriptors,
    invocationNames: [...descriptorByInvocationName.keys()],
    descriptorByInvocationName,
    descriptorByName,
    invocationNamesByDescriptorId,
  };
  catalogCache.set(descriptors, catalog);
  return catalog;
}

export function createXmlToolCallRegex(catalog: ToolInvocationCatalog): RegExp {
  if (catalog.invocationNames.length === 0) return /$a/g;
  let source = xmlRegexSourceCache.get(catalog);
  if (!source) {
    const names = catalog.invocationNames.map(escapeRegExp).join('|');
    source = `<(${names})>\\s*([\\s\\S]*?)\\s*<\\/\\1>`;
    xmlRegexSourceCache.set(catalog, source);
  }
  return new RegExp(source, 'g');
}

export function createToolCallFromInvocation(
  invocationName: string,
  payload: ToolPayload,
  raw: string,
  catalog: ToolInvocationCatalog,
  options?: { parseError?: ToolError },
): ToolCall {
  const descriptor =
    catalog.descriptorByInvocationName.get(invocationName) ||
    catalog.descriptorByName.get(invocationName);

  return {
    name: descriptor?.name ?? invocationName,
    invocationName: descriptor?.invocationName ?? invocationName,
    payload,
    raw,
    descriptorId: descriptor?.id,
    provider: descriptor?.provider,
    parseError: options?.parseError,
  };
}

export function getToolInvocationNames(
  descriptor: ToolDescriptor,
  catalog: ToolInvocationCatalog = createToolInvocationCatalog([descriptor]),
): string[] {
  const names = catalog.invocationNamesByDescriptorId.get(descriptor.id);
  if (names?.length) return names;
  return descriptor.invocationName ? [descriptor.invocationName] : [];
}

export function getPreferredToolInvocationName(
  descriptor: ToolDescriptor,
  catalog: ToolInvocationCatalog = createToolInvocationCatalog([descriptor]),
): string {
  const names = getToolInvocationNames(descriptor, catalog);
  const directName = descriptor.name.trim();
  if (directName && names.includes(directName)) return directName;
  return names[0] ?? descriptor.invocationName;
}

export function getToolInvocationLabel(
  name: string,
  catalog: ToolInvocationCatalog = createToolInvocationCatalog(),
): string {
  const descriptor =
    catalog.descriptorByInvocationName.get(name) ||
    catalog.descriptorByName.get(name);
  return descriptor?.title || name;
}

export function getToolOpenTag(invocationName: string): string {
  return `<${invocationName}>`;
}

export function getToolCloseTag(invocationName: string): string {
  return `</${invocationName}>`;
}

export function hasXmlToolMarker(text: string, catalog: ToolInvocationCatalog): boolean {
  for (const name of catalog.invocationNames) {
    if (text.includes(getToolOpenTag(name)) || text.includes(getToolCloseTag(name))) {
      return true;
    }
  }
  return false;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function addInvocationName(
  descriptorByInvocationName: Map<string, ToolDescriptor>,
  acceptedNames: string[],
  invocationName: string,
  descriptor: ToolDescriptor,
) {
  acceptedNames.push(invocationName);
  if (descriptorByInvocationName.has(invocationName)) return;
  descriptorByInvocationName.set(invocationName, descriptor);
}

function isValidToolTagName(value: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_.:-]*$/.test(value);
}
