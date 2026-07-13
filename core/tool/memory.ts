import type { Memory, MemoryType, NewMemory } from '../types';
import { DEFAULT_LOCALE, translate, type SupportedLocale } from '../i18n';
import type {
  JsonValue,
  ToolCall,
  ToolDescriptor,
  ToolProviderIdentity,
  ToolResult,
} from './types';

const MEMORY_TYPES: MemoryType[] = ['user', 'feedback', 'topic', 'reference'];

export const MEMORY_TOOL_PROVIDER: ToolProviderIdentity = {
  kind: 'local',
  id: 'memory',
  displayName: translate(DEFAULT_LOCALE, 'tool.memory.providerName'),
  transport: 'in_process',
};

export const MEMORY_TOOL_NAMES = ['memory_save', 'memory_update', 'memory_delete'] as const;

export type MemoryToolName = typeof MEMORY_TOOL_NAMES[number];

export interface MemoryToolSaveConfirmation {
  id: number;
}

export interface MemoryToolRuntime {
  saveMemory(input: NewMemory): Promise<MemoryToolSaveConfirmation | null>;
  getMemoryById(id: number): Promise<Memory | null>;
  updateMemory(memory: Memory): Promise<void>;
  deleteMemory(id: number): Promise<void>;
}

export function createMemoryToolProviderIdentity(
  locale: SupportedLocale = DEFAULT_LOCALE,
): ToolProviderIdentity {
  return {
    ...MEMORY_TOOL_PROVIDER,
    displayName: translate(locale, 'tool.memory.providerName'),
  };
}

export function createMemoryToolDescriptors(
  locale: SupportedLocale = DEFAULT_LOCALE,
): ToolDescriptor[] {
  const provider = createMemoryToolProviderIdentity(locale);
  return [{
    id: 'local:memory:memory_save',
    provider,
    name: 'memory_save',
    invocationName: 'memory_save',
    title: translate(locale, 'tool.memory.saveTitle'),
    description: translate(locale, 'tool.memory.saveDescription'),
    inputSchema: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          enum: MEMORY_TYPES,
          description: translate(locale, 'tool.memory.typeDescription'),
        },
        name: { type: 'string', description: translate(locale, 'tool.memory.nameDescription') },
        content: { type: 'string', description: translate(locale, 'tool.memory.contentDescription') },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: translate(locale, 'tool.memory.tagsDescription'),
        },
      },
      required: ['type', 'name', 'content', 'tags'],
      additionalProperties: false,
    },
    execution: {
      mode: 'auto',
      enabled: true,
      risk: 'low',
    },
  },
  {
    id: 'local:memory:memory_update',
    provider,
    name: 'memory_update',
    invocationName: 'memory_update',
    title: translate(locale, 'tool.memory.updateTitle'),
    description: translate(locale, 'tool.memory.updateDescription'),
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'integer', description: translate(locale, 'tool.memory.idDescription') },
        type: { type: 'string', enum: MEMORY_TYPES, description: translate(locale, 'tool.memory.typeDescription') },
        name: { type: 'string', description: translate(locale, 'tool.memory.updatedNameDescription') },
        content: { type: 'string', description: translate(locale, 'tool.memory.updatedContentDescription') },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: translate(locale, 'tool.memory.tagsDescription'),
        },
      },
      required: ['id', 'type', 'name', 'content', 'tags'],
      additionalProperties: false,
    },
    execution: {
      mode: 'auto',
      enabled: true,
      risk: 'medium',
    },
  },
  {
    id: 'local:memory:memory_delete',
    provider,
    name: 'memory_delete',
    invocationName: 'memory_delete',
    title: translate(locale, 'tool.memory.deleteTitle'),
    description: translate(locale, 'tool.memory.deleteDescription'),
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'integer', description: translate(locale, 'tool.memory.idDescription') },
      },
      required: ['id'],
      additionalProperties: false,
    },
    execution: {
      mode: 'auto',
      enabled: true,
      risk: 'medium',
    },
  },
  ];
}

export const MEMORY_TOOL_DESCRIPTORS: ToolDescriptor[] = createMemoryToolDescriptors(DEFAULT_LOCALE);

export function isMemoryToolName(name: string): name is MemoryToolName {
  return (MEMORY_TOOL_NAMES as readonly string[]).includes(name);
}

export async function executeMemoryToolCall(
  runtime: MemoryToolRuntime,
  call: ToolCall,
  locale: SupportedLocale = DEFAULT_LOCALE,
): Promise<ToolResult> {
  if (call.name === 'memory_save') {
    return saveMemory(runtime, call, locale);
  }

  if (call.name === 'memory_update') {
    return updateExistingMemory(runtime, call, locale);
  }

  if (call.name === 'memory_delete') {
    return deleteExistingMemory(runtime, call, locale);
  }

  return {
    ok: false,
    name: call.name,
    summary: translate(locale, 'tool.memory.unsupported'),
    error: {
      code: 'memory_tool_unsupported',
      message: `Unsupported memory tool: ${call.name}`,
      retryable: false,
    },
  };
}

async function saveMemory(
  runtime: MemoryToolRuntime,
  call: ToolCall,
  locale: SupportedLocale,
): Promise<ToolResult> {
  const parsed = parseMemorySavePayload(call, locale);
  if (!parsed.ok) return parsed.result;

  const saved = await runtime.saveMemory({
    type: parsed.memory.type,
    name: parsed.memory.name,
    content: parsed.memory.content,
    description: parsed.memory.name,
    tags: parsed.memory.tags,
    pinned: false,
  });

  if (!saved?.id) {
    return failure(
      call,
      'memory_save_failed',
      translate(locale, 'tool.memory.saveFailed'),
      translate(locale, 'tool.memory.saveMissingConfirmation'),
      true,
    );
  }

  return success(call, locale, translate(locale, 'tool.memory.saved'), parsed.memory.name, { id: saved.id });
}

function parseMemorySavePayload(
  call: ToolCall,
  locale: SupportedLocale,
): { ok: true; memory: Pick<NewMemory, 'type' | 'name' | 'content' | 'tags'> } | { ok: false; result: ToolResult } {
  const payload = call.payload;
  const type = memoryTypeValue(payload.type);
  if (!type) {
    return {
      ok: false,
      result: failure(
        call,
        'memory_invalid_payload',
        translate(locale, 'tool.memory.invalidPayload'),
        translate(locale, 'tool.memory.invalidType'),
        false,
      ),
    };
  }

  const name = requiredStringValue(payload.name);
  if (!name) {
    return {
      ok: false,
      result: failure(
        call,
        'memory_invalid_payload',
        translate(locale, 'tool.memory.invalidPayload'),
        translate(locale, 'tool.memory.invalidName'),
        false,
      ),
    };
  }

  const content = requiredStringValue(payload.content);
  if (!content) {
    return {
      ok: false,
      result: failure(
        call,
        'memory_invalid_payload',
        translate(locale, 'tool.memory.invalidPayload'),
        translate(locale, 'tool.memory.invalidContent'),
        false,
      ),
    };
  }

  if (!Array.isArray(payload.tags) || !payload.tags.every((item) => typeof item === 'string')) {
    return {
      ok: false,
      result: failure(
        call,
        'memory_invalid_payload',
        translate(locale, 'tool.memory.invalidPayload'),
        translate(locale, 'tool.memory.invalidTags'),
        false,
      ),
    };
  }

  return {
    ok: true,
    memory: {
      type,
      name,
      content,
      tags: [...payload.tags],
    },
  };
}

async function updateExistingMemory(
  runtime: MemoryToolRuntime,
  call: ToolCall,
  locale: SupportedLocale,
): Promise<ToolResult> {
  const payload = call.payload;
  const id = numberValue(payload.id);
  if (!id) return failure(call, 'memory_invalid_id', translate(locale, 'tool.memory.invalidId'), undefined, false);

  const existing = await runtime.getMemoryById(id);
  if (!existing) {
    return failure(
      call,
      'memory_not_found',
      translate(locale, 'tool.memory.notFound'),
      translate(locale, 'tool.memory.notFoundDetail', { id }),
      false,
    );
  }

  const name = stringValue(payload.name) || existing.name;
  await runtime.updateMemory({
    ...existing,
    type: memoryTypeValue(payload.type) || existing.type,
    name,
    content: stringValue(payload.content) || existing.content,
    description: name || existing.description,
    tags: Array.isArray(payload.tags) ? stringArrayValue(payload.tags) : existing.tags,
  });

  return success(call, locale, translate(locale, 'tool.memory.updated'), name);
}

async function deleteExistingMemory(
  runtime: MemoryToolRuntime,
  call: ToolCall,
  locale: SupportedLocale,
): Promise<ToolResult> {
  const id = numberValue(call.payload.id);
  if (!id) return failure(call, 'memory_invalid_id', translate(locale, 'tool.memory.invalidId'), undefined, false);

  await runtime.deleteMemory(id);
  return success(call, locale, translate(locale, 'tool.memory.deleted'), `#${id}`);
}

function success(
  call: ToolCall,
  locale: SupportedLocale,
  summary: string,
  detail?: string,
  output?: JsonValue,
): ToolResult {
  return {
    ok: true,
    name: call.name,
    callId: call.id,
    descriptorId: call.descriptorId,
    provider: call.provider ?? createMemoryToolProviderIdentity(locale),
    summary,
    detail,
    output,
  };
}

function failure(
  call: ToolCall,
  code: string,
  summary: string,
  detail: string | undefined,
  retryable: boolean,
): ToolResult {
  return {
    ok: false,
    name: call.name,
    callId: call.id,
    descriptorId: call.descriptorId,
    provider: call.provider ?? MEMORY_TOOL_PROVIDER,
    summary,
    detail,
    error: {
      code,
      message: detail ?? summary,
      retryable,
    },
  };
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function requiredStringValue(value: unknown): string {
  return typeof value === 'string' && value.trim().length > 0 ? value : '';
}

function numberValue(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function memoryTypeValue(value: unknown): MemoryType | null {
  return typeof value === 'string' && MEMORY_TYPES.includes(value as MemoryType)
    ? value as MemoryType
    : null;
}

function stringArrayValue(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}
