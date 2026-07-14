import { isSupportedLocale } from '../i18n';
import {
  decodeImportedMemory,
  decodePersistedMemoryRecord,
} from '../memory/codec';
import { decodePreset } from '../preset/codec';
import { decodeSkill } from '../skill/codec';
import type { PersistenceRuntimeCommandContracts } from './persistence-runtime-contracts';
import { isPlainRuntimeRecord } from './runtime-boundary';

type PersistenceRuntimeCommandType = keyof PersistenceRuntimeCommandContracts;

export type PersistencePayloadCommandType = {
  [TType in PersistenceRuntimeCommandType]:
    'payload' extends keyof PersistenceRuntimeCommandContracts[TType]['request']
      ? TType
      : never;
}[PersistenceRuntimeCommandType];

export type PersistenceRuntimePayload<TType extends PersistencePayloadCommandType> =
  PersistenceRuntimeCommandContracts[TType]['request'] extends { payload: infer TPayload }
    ? TPayload
    : PersistenceRuntimeCommandContracts[TType]['request'] extends { payload?: infer TPayload }
      ? TPayload | undefined
      : never;

type PersistenceRuntimePayloadDecoderMap = {
  [TType in PersistencePayloadCommandType]: (
    value: unknown,
  ) => PersistenceRuntimePayload<TType>;
};

export const PERSISTENCE_RUNTIME_PAYLOAD_DECODERS: PersistenceRuntimePayloadDecoderMap = {
  GET_MEMORY_BY_ID(value) {
    const payload = recordValue(value, 'GET_MEMORY_BY_ID.payload');
    positiveSafeInteger(payload.id, 'GET_MEMORY_BY_ID.payload.id');
    return typedPayload<'GET_MEMORY_BY_ID'>(payload);
  },
  SAVE_MEMORY(value) {
    return decodeImportedMemory(
      recordValue(value, 'SAVE_MEMORY.payload'),
      'SAVE_MEMORY.payload',
    );
  },
  IMPORT_MEMORY_DRAFTS(value) {
    const payload = recordValue(value, 'IMPORT_MEMORY_DRAFTS.payload');
    // Keep the released invalid_memories domain response for a non-array value.
    // Valid arrays are decoded atomically by the authoritative Memory codec before I/O.
    if (Array.isArray(payload.memories)) {
      payload.memories.forEach((memory, index) => {
        recordValue(memory, `IMPORT_MEMORY_DRAFTS.payload.memories[${index}]`);
      });
    }
    return typedPayload<'IMPORT_MEMORY_DRAFTS'>(payload);
  },
  UPDATE_MEMORY(value) {
    return decodePersistedMemoryRecord(
      recordValue(value, 'UPDATE_MEMORY.payload'),
      'UPDATE_MEMORY.payload',
    );
  },
  DELETE_MEMORY(value) {
    const payload = recordValue(value, 'DELETE_MEMORY.payload');
    positiveSafeInteger(payload.id, 'DELETE_MEMORY.payload.id');
    return typedPayload<'DELETE_MEMORY'>(payload);
  },
  TOUCH_MEMORIES(value) {
    const payload = recordValue(value, 'TOUCH_MEMORIES.payload');
    safeIntegerArray(payload.ids, 'TOUCH_MEMORIES.payload.ids');
    return typedPayload<'TOUCH_MEMORIES'>(payload);
  },
  SAVE_SKILL(value) {
    const payload = recordValue(value, 'SAVE_SKILL.payload');
    if (Object.hasOwn(payload, 'skill')) {
      const skill = decodeSkill(payload.skill, 'SAVE_SKILL.payload.skill');
      optionalNonEmptyString(payload.previousName, 'SAVE_SKILL.payload.previousName');
      return typedPayload<'SAVE_SKILL'>({ ...payload, skill });
    }
    return decodeSkill(payload, 'SAVE_SKILL.payload');
  },
  DELETE_SKILL(value) {
    return decodeNamedRecord<'DELETE_SKILL'>(value, 'DELETE_SKILL.payload', 'name');
  },
  SET_SKILL_ENABLED(value) {
    const payload = recordValue(value, 'SET_SKILL_ENABLED.payload');
    nonEmptyString(payload.name, 'SET_SKILL_ENABLED.payload.name');
    booleanValue(payload.enabled, 'SET_SKILL_ENABLED.payload.enabled');
    return typedPayload<'SET_SKILL_ENABLED'>(payload);
  },
  SET_SKILLS_ENABLED(value) {
    const payload = recordValue(value, 'SET_SKILLS_ENABLED.payload');
    const updates = arrayValue(payload.updates, 'SET_SKILLS_ENABLED.payload.updates');
    updates.forEach((update, index) => {
      const item = recordValue(update, `SET_SKILLS_ENABLED.payload.updates[${index}]`);
      nonEmptyString(item.name, `SET_SKILLS_ENABLED.payload.updates[${index}].name`);
      booleanValue(item.enabled, `SET_SKILLS_ENABLED.payload.updates[${index}].enabled`);
    });
    return typedPayload<'SET_SKILLS_ENABLED'>(payload);
  },
  PREVIEW_GITHUB_SKILL_SOURCE(value) {
    const payload = recordValue(value, 'PREVIEW_GITHUB_SKILL_SOURCE.payload');
    nonEmptyString(payload.url, 'PREVIEW_GITHUB_SKILL_SOURCE.payload.url');
    return typedPayload<'PREVIEW_GITHUB_SKILL_SOURCE'>(payload);
  },
  IMPORT_GITHUB_SKILL_SOURCE(value) {
    const payload = recordValue(value, 'IMPORT_GITHUB_SKILL_SOURCE.payload');
    nonEmptyString(payload.url, 'IMPORT_GITHUB_SKILL_SOURCE.payload.url');
    nonEmptyStringArray(
      payload.selectedPaths,
      'IMPORT_GITHUB_SKILL_SOURCE.payload.selectedPaths',
    );
    return typedPayload<'IMPORT_GITHUB_SKILL_SOURCE'>(payload);
  },
  PREVIEW_LOCAL_SKILL_SOURCE(value) {
    const payload = recordValue(value, 'PREVIEW_LOCAL_SKILL_SOURCE.payload');
    nonEmptyString(payload.rootPath, 'PREVIEW_LOCAL_SKILL_SOURCE.payload.rootPath');
    return typedPayload<'PREVIEW_LOCAL_SKILL_SOURCE'>(payload);
  },
  PICK_LOCAL_SKILL_FOLDER(value) {
    if (value === undefined) return undefined;
    const payload = recordValue(value, 'PICK_LOCAL_SKILL_FOLDER.payload');
    optionalString(payload.defaultPath, 'PICK_LOCAL_SKILL_FOLDER.payload.defaultPath');
    return typedPayload<'PICK_LOCAL_SKILL_FOLDER'>(payload);
  },
  IMPORT_LOCAL_SKILL_SOURCE(value) {
    const payload = recordValue(value, 'IMPORT_LOCAL_SKILL_SOURCE.payload');
    nonEmptyString(payload.rootPath, 'IMPORT_LOCAL_SKILL_SOURCE.payload.rootPath');
    nonEmptyStringArray(
      payload.selectedPaths,
      'IMPORT_LOCAL_SKILL_SOURCE.payload.selectedPaths',
    );
    if (payload.selectedImportNames !== undefined) {
      stringRecord(
        payload.selectedImportNames,
        'IMPORT_LOCAL_SKILL_SOURCE.payload.selectedImportNames',
      );
    }
    return typedPayload<'IMPORT_LOCAL_SKILL_SOURCE'>(payload);
  },
  CHECK_GITHUB_SKILL_SOURCE_UPDATES(value) {
    return decodeNamedRecord<'CHECK_GITHUB_SKILL_SOURCE_UPDATES'>(
      value,
      'CHECK_GITHUB_SKILL_SOURCE_UPDATES.payload',
      'sourceId',
    );
  },
  UPDATE_GITHUB_SKILL_SOURCE(value) {
    return decodeNamedRecord<'UPDATE_GITHUB_SKILL_SOURCE'>(
      value,
      'UPDATE_GITHUB_SKILL_SOURCE.payload',
      'sourceId',
    );
  },
  DELETE_GITHUB_SKILL_SOURCE(value) {
    return decodeNamedRecord<'DELETE_GITHUB_SKILL_SOURCE'>(
      value,
      'DELETE_GITHUB_SKILL_SOURCE.payload',
      'sourceId',
    );
  },
  SAVE_PRESET(value) {
    return decodePreset(recordValue(value, 'SAVE_PRESET.payload'), 'SAVE_PRESET.payload');
  },
  DELETE_PRESET(value) {
    return decodeNamedRecord<'DELETE_PRESET'>(value, 'DELETE_PRESET.payload', 'id');
  },
  SET_ACTIVE_PRESET(value) {
    const payload = recordValue(value, 'SET_ACTIVE_PRESET.payload');
    nullableNonEmptyString(payload.id, 'SET_ACTIVE_PRESET.payload.id');
    return typedPayload<'SET_ACTIVE_PRESET'>(payload);
  },
  SAVE_PROMPT_INJECTION_SETTINGS(value) {
    const payload = recordValue(value, 'SAVE_PROMPT_INJECTION_SETTINGS.payload');
    optionalBoolean(
      payload.memoryEnabled,
      'SAVE_PROMPT_INJECTION_SETTINGS.payload.memoryEnabled',
    );
    optionalBoolean(
      payload.systemPromptEnabled,
      'SAVE_PROMPT_INJECTION_SETTINGS.payload.systemPromptEnabled',
    );
    if (payload.presetCadence !== undefined) {
      enumValue(
        payload.presetCadence,
        ['default', 'first_message', 'every_message', 'off'],
        'SAVE_PROMPT_INJECTION_SETTINGS.payload.presetCadence',
      );
    }
    if (
      payload.forceResponseLanguage !== undefined
      && payload.forceResponseLanguage !== 'auto'
      && !isSupportedLocale(payload.forceResponseLanguage)
    ) {
      throw new Error(
        'SAVE_PROMPT_INJECTION_SETTINGS.payload.forceResponseLanguage is not supported',
      );
    }
    return typedPayload<'SAVE_PROMPT_INJECTION_SETTINGS'>(payload);
  },
  SAVE_SAVED_ITEM(value) {
    const payload = recordValue(value, 'SAVE_SAVED_ITEM.payload');
    optionalNonEmptyString(payload.id, 'SAVE_SAVED_ITEM.payload.id');
    optionalNonEmptyString(payload.syncId, 'SAVE_SAVED_ITEM.payload.syncId');
    enumValue(payload.kind, ['snippet', 'bookmark'], 'SAVE_SAVED_ITEM.payload.kind');
    nonEmptyString(payload.title, 'SAVE_SAVED_ITEM.payload.title');
    nonEmptyString(payload.content, 'SAVE_SAVED_ITEM.payload.content');
    optionalString(payload.sourceUrl, 'SAVE_SAVED_ITEM.payload.sourceUrl');
    stringArray(payload.tags, 'SAVE_SAVED_ITEM.payload.tags');
    optionalFiniteNumber(payload.createdAt, 'SAVE_SAVED_ITEM.payload.createdAt');
    optionalFiniteNumber(payload.updatedAt, 'SAVE_SAVED_ITEM.payload.updatedAt');
    return typedPayload<'SAVE_SAVED_ITEM'>(payload);
  },
  DELETE_SAVED_ITEM(value) {
    return decodeNamedRecord<'DELETE_SAVED_ITEM'>(value, 'DELETE_SAVED_ITEM.payload', 'id');
  },
  INSERT_SAVED_PROMPT_INTO_CHAT(value) {
    if (value === undefined) return { text: '' };
    const payload = recordValue(value, 'INSERT_SAVED_PROMPT_INTO_CHAT.payload');
    return typedPayload<'INSERT_SAVED_PROMPT_INTO_CHAT'>({
      ...payload,
      text: typeof payload.text === 'string' ? payload.text : '',
    });
  },
  SAVE_VOICE_SETTINGS(value) {
    const payload = recordValue(value, 'SAVE_VOICE_SETTINGS.payload');
    optionalBoolean(payload.inputEnabled, 'SAVE_VOICE_SETTINGS.payload.inputEnabled');
    optionalBoolean(payload.readAloudEnabled, 'SAVE_VOICE_SETTINGS.payload.readAloudEnabled');
    optionalFiniteNumber(payload.rate, 'SAVE_VOICE_SETTINGS.payload.rate');
    optionalFiniteNumber(payload.pitch, 'SAVE_VOICE_SETTINGS.payload.pitch');
    return typedPayload<'SAVE_VOICE_SETTINGS'>(payload);
  },
  CREATE_PROJECT_CONTEXT(value) {
    const payload = recordValue(value, 'CREATE_PROJECT_CONTEXT.payload');
    nonEmptyString(payload.name, 'CREATE_PROJECT_CONTEXT.payload.name');
    optionalString(payload.description, 'CREATE_PROJECT_CONTEXT.payload.description');
    optionalString(payload.instructions, 'CREATE_PROJECT_CONTEXT.payload.instructions');
    return typedPayload<'CREATE_PROJECT_CONTEXT'>(payload);
  },
  UPDATE_PROJECT_CONTEXT(value) {
    const payload = recordValue(value, 'UPDATE_PROJECT_CONTEXT.payload');
    nonEmptyString(payload.projectId, 'UPDATE_PROJECT_CONTEXT.payload.projectId');
    const patch = recordValue(payload.patch, 'UPDATE_PROJECT_CONTEXT.payload.patch');
    optionalString(patch.name, 'UPDATE_PROJECT_CONTEXT.payload.patch.name');
    optionalString(patch.description, 'UPDATE_PROJECT_CONTEXT.payload.patch.description');
    optionalString(patch.instructions, 'UPDATE_PROJECT_CONTEXT.payload.patch.instructions');
    return typedPayload<'UPDATE_PROJECT_CONTEXT'>({ ...payload, patch });
  },
  DELETE_PROJECT_CONTEXT(value) {
    return decodeNamedRecord<'DELETE_PROJECT_CONTEXT'>(
      value,
      'DELETE_PROJECT_CONTEXT.payload',
      'projectId',
    );
  },
  ADD_CONVERSATION_TO_PROJECT(value) {
    const payload = recordValue(value, 'ADD_CONVERSATION_TO_PROJECT.payload');
    nonEmptyString(payload.projectId, 'ADD_CONVERSATION_TO_PROJECT.payload.projectId');
    const conversation = decodeProjectConversationInput(
      payload.conversation,
      'ADD_CONVERSATION_TO_PROJECT.payload.conversation',
    );
    return typedPayload<'ADD_CONVERSATION_TO_PROJECT'>({ ...payload, conversation });
  },
  REMOVE_CONVERSATION_FROM_PROJECT(value) {
    return decodeNamedRecord<'REMOVE_CONVERSATION_FROM_PROJECT'>(
      value,
      'REMOVE_CONVERSATION_FROM_PROJECT.payload',
      'conversationId',
    );
  },
  SET_PENDING_PROJECT_CONTEXT(value) {
    const payload = recordValue(value, 'SET_PENDING_PROJECT_CONTEXT.payload');
    nullableNonEmptyString(payload.projectId, 'SET_PENDING_PROJECT_CONTEXT.payload.projectId');
    return typedPayload<'SET_PENDING_PROJECT_CONTEXT'>(payload);
  },
  GET_PROJECT_CONTEXT_FOR_CONVERSATION(value) {
    const payload = recordValue(value, 'GET_PROJECT_CONTEXT_FOR_CONVERSATION.payload');
    const conversation = decodeProjectConversationInput(
      payload.conversation,
      'GET_PROJECT_CONTEXT_FOR_CONVERSATION.payload.conversation',
    );
    optionalBoolean(
      payload.bindPendingProject,
      'GET_PROJECT_CONTEXT_FOR_CONVERSATION.payload.bindPendingProject',
    );
    return typedPayload<'GET_PROJECT_CONTEXT_FOR_CONVERSATION'>({ ...payload, conversation });
  },
  GET_ARTIFACT(value) {
    return decodeNamedRecord<'GET_ARTIFACT'>(value, 'GET_ARTIFACT.payload', 'id');
  },
  SET_DEEPSEEK_THEME(value) {
    const payload = recordValue(value, 'SET_DEEPSEEK_THEME.payload');
    // Preserve the released {ok:false,error:'invalid_theme'} handler response.
    // The handler checks this field before any read or write.
    return typedPayload<'SET_DEEPSEEK_THEME'>(payload);
  },
  SET_MODEL_TYPE(value) {
    if (value === null || value === 'expert' || value === 'vision') return value;
    throw new Error('SET_MODEL_TYPE.payload must be expert, vision, or null');
  },
  SAVE_BACKGROUND(value) {
    const payload = recordValue(value, 'SAVE_BACKGROUND.payload');
    booleanValue(payload.enabled, 'SAVE_BACKGROUND.payload.enabled');
    enumValue(payload.type, ['upload', 'url'], 'SAVE_BACKGROUND.payload.type');
    optionalString(payload.url, 'SAVE_BACKGROUND.payload.url');
    optionalString(payload.imageData, 'SAVE_BACKGROUND.payload.imageData');
    finiteNumber(payload.opacity, 'SAVE_BACKGROUND.payload.opacity');
    return typedPayload<'SAVE_BACKGROUND'>(payload);
  },
  SAVE_PET(value) {
    const payload = recordValue(value, 'SAVE_PET.payload');
    booleanValue(payload.enabled, 'SAVE_PET.payload.enabled');
    enumValue(
      payload.position,
      ['bottom-right', 'bottom-left', 'custom'],
      'SAVE_PET.payload.position',
    );
    if (payload.customPosition !== undefined) {
      const position = recordValue(payload.customPosition, 'SAVE_PET.payload.customPosition');
      finiteNumber(position.x, 'SAVE_PET.payload.customPosition.x');
      finiteNumber(position.y, 'SAVE_PET.payload.customPosition.y');
    }
    finiteNumber(payload.size, 'SAVE_PET.payload.size');
    finiteNumber(payload.opacity, 'SAVE_PET.payload.opacity');
    booleanValue(payload.motion, 'SAVE_PET.payload.motion');
    return typedPayload<'SAVE_PET'>(payload);
  },
};

export function decodePersistenceRuntimePayload<
  TType extends PersistencePayloadCommandType,
>(
  type: TType,
  value: unknown,
): PersistenceRuntimePayload<TType> {
  return PERSISTENCE_RUNTIME_PAYLOAD_DECODERS[type](value);
}

function decodeNamedRecord<TType extends PersistencePayloadCommandType>(
  value: unknown,
  path: string,
  field: string,
): PersistenceRuntimePayload<TType> {
  const payload = recordValue(value, path);
  nonEmptyString(payload[field], `${path}.${field}`);
  return typedPayload<TType>(payload);
}

function decodeProjectConversationInput(value: unknown, path: string): Record<string, unknown> {
  const conversation = recordValue(value, path);
  nonEmptyString(conversation.conversationId, `${path}.conversationId`);
  optionalString(conversation.title, `${path}.title`);
  optionalString(conversation.url, `${path}.url`);
  return conversation;
}

function typedPayload<TType extends PersistencePayloadCommandType>(
  value: unknown,
): PersistenceRuntimePayload<TType> {
  return value as PersistenceRuntimePayload<TType>;
}

function recordValue(value: unknown, path: string): Record<string, unknown> {
  if (!isPlainRuntimeRecord(value)) throw new Error(`${path} must be a plain object`);
  return value;
}

function arrayValue(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${path} must be an array`);
  return value;
}

function nonEmptyString(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${path} must be a non-empty string`);
  }
  return value;
}

function optionalNonEmptyString(value: unknown, path: string): void {
  if (value !== undefined) nonEmptyString(value, path);
}

function nullableNonEmptyString(value: unknown, path: string): void {
  if (value !== null) nonEmptyString(value, path);
}

function optionalString(value: unknown, path: string): void {
  if (value !== undefined && typeof value !== 'string') {
    throw new Error(`${path} must be a string`);
  }
}

function booleanValue(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${path} must be a boolean`);
  return value;
}

function optionalBoolean(value: unknown, path: string): void {
  if (value !== undefined) booleanValue(value, path);
}

function finiteNumber(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${path} must be a finite number`);
  }
  return value;
}

function optionalFiniteNumber(value: unknown, path: string): void {
  if (value !== undefined) finiteNumber(value, path);
}

function positiveSafeInteger(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw new Error(`${path} must be a positive safe integer`);
  }
  return value as number;
}

function safeIntegerArray(value: unknown, path: string): number[] {
  return arrayValue(value, path).map((item, index) => (
    positiveSafeInteger(item, `${path}[${index}]`)
  ));
}

function stringArray(value: unknown, path: string): string[] {
  return arrayValue(value, path).map((item, index) => {
    if (typeof item !== 'string') throw new Error(`${path}[${index}] must be a string`);
    return item;
  });
}

function nonEmptyStringArray(value: unknown, path: string): string[] {
  return arrayValue(value, path).map((item, index) => (
    nonEmptyString(item, `${path}[${index}]`)
  ));
}

function stringRecord(value: unknown, path: string): Record<string, string> {
  const record = recordValue(value, path);
  for (const [key, item] of Object.entries(record)) {
    nonEmptyString(key, `${path} key`);
    nonEmptyString(item, `${path}.${key}`);
  }
  return record as Record<string, string>;
}

function enumValue<TValue extends string>(
  value: unknown,
  allowed: readonly TValue[],
  path: string,
): TValue {
  if (typeof value !== 'string' || !allowed.includes(value as TValue)) {
    throw new Error(`${path} is not supported`);
  }
  return value as TValue;
}
