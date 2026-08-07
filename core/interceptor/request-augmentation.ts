import { basename } from 'node:path';
import { DEFAULT_LOCALE, translate, type SupportedLocale } from '../i18n';
import { buildPromptAugmentation } from '../prompt';
import {
  DEFAULT_PROMPT_INJECTION_SETTINGS,
  normalizePromptInjectionSettings,
  shouldInjectPresetForTurn,
  type PromptInjectionSettings,
} from '../prompt/settings';
import { parseSkillCommand } from '../skill/parser';
import { isLocalIndexInstructions, buildLocalExecutionBoundary } from '../skill/local-importer';
import { selectImplicitSkill, type LocalSkillIndex } from '../skill/local-skill-scorer';
import { absolutizeSkillReferences, joinUnderRoot } from '../skill/local-path-rewriter';
import { DEFAULT_SKILL_AUTO_ACTIVATION_SETTINGS, type SkillAutoActivationSettings } from '../skill/auto-activation-settings';
import { projectToolDescriptorsForNativeSearch } from '../tool';
import type { Memory, ModelType, Skill, SystemPromptPreset, ToolDescriptor } from '../types';
import { filterMemoriesByProjectScope } from '../memory/scope';
import {
  normalizeDeepSeekMessageId,
  type DeepSeekAugmentableWebRoute,
} from '../deepseek/request-codec';

export interface RequestAugmentationState {
  memories: Memory[];
  // Extended source/description/remote: dispatched by source at runtime, and a local indexed skill can
  // obtain its skillDir via remote.localDirectory. source/description/remote are optional to stay backward
  // compatible with prior callers (including tests) that only supply name/instructions/memoryEnabled;
  // the real caller (content.ts) always passes the full Skill object.
  skills: Array<
    Pick<Skill, 'name' | 'instructions' | 'memoryEnabled'> &
    Partial<Pick<Skill, 'source' | 'description' | 'remote'>>
  >;
  activePreset: SystemPromptPreset | null;
  projectContext?: string | null;
  projectId?: string | null;
  modelType: ModelType;
  toolDescriptors: readonly ToolDescriptor[];
  messageCount: number;
  locale?: SupportedLocale;
  promptSettings?: Partial<PromptInjectionSettings>;
  // Auto-activation (implicit scoring) toggle; defaults to DEFAULT (first-message on, every-message off).
  skillAutoActivation?: SkillAutoActivationSettings;
}

export interface RequestBodyAugmentationResult {
  body: string;
  agentTaskPrompt: string;
  usedMemoryIds: number[];
  messageCount: number;
  // The skillDir of any local indexed skill activated for this request; undefined otherwise.
  // This is the "session-initial cwd hint": captured by the caller (content.ts) and used during response
  // parsing as the initial cwd suggestion for shell_exec / shell_session_begin; not a hard persistent
  // binding (Review #4 Route A).
  activeLocalSkillDir?: string;
}

export interface DeepSeekRequestBody extends Record<string, unknown> {
  prompt: string;
}

export interface DeepSeekRegenerateRequestBody extends Record<string, unknown> {
  chat_session_id: string;
  child_message_id: number;
}

export type DecodedDeepSeekAugmentationRequest =
  | {
    route: 'completion' | 'editMessage';
    body: DeepSeekRequestBody;
  }
  | {
    route: 'regenerate';
    body: DeepSeekRegenerateRequestBody;
  };

interface ResolvedSkills {
  combinedPrompt: string;
  memoryEnabled: boolean;
  // The activated skill's name (used for the anti-impatience / disk-read instruction copy in the system context).
  skillName: string;
}

export function augmentRequestBody(
  bodyStr: string,
  state: RequestAugmentationState,
): RequestBodyAugmentationResult | null {
  const body = decodeAugmentableDeepSeekRequestBody(bodyStr);
  if (!body) return null;
  return augmentDecodedRequestBody(body, state);
}

export function decodeAugmentableDeepSeekRequestBody(
  bodyStr: string,
): DeepSeekRequestBody | null {
  try {
    return decodeDeepSeekRequestBody(bodyStr);
  } catch {
    return null;
  }
}

export function decodeAugmentableDeepSeekRequest(
  route: DeepSeekAugmentableWebRoute,
  bodyStr: string,
): DecodedDeepSeekAugmentationRequest | null {
  try {
    return decodeDeepSeekAugmentationRequest(route, bodyStr);
  } catch {
    return null;
  }
}

export function decodeDeepSeekAugmentationRequest(
  route: DeepSeekAugmentableWebRoute,
  bodyStr: string,
): DecodedDeepSeekAugmentationRequest {
  if (route === 'regenerate') {
    return { route, body: decodeDeepSeekRegenerateRequestBody(bodyStr) };
  }
  return { route, body: decodeDeepSeekRequestBody(bodyStr) };
}

export function decodeDeepSeekRequestBody(bodyStr: string): DeepSeekRequestBody {
  const body = decodeDeepSeekRequestRecord(bodyStr);
  if (typeof body.prompt !== 'string' || body.prompt.length === 0) {
    throw new Error('DeepSeek request prompt must be a non-empty string.');
  }
  return body as DeepSeekRequestBody;
}

export function decodeDeepSeekRegenerateRequestBody(
  bodyStr: string,
): DeepSeekRegenerateRequestBody {
  const body = decodeDeepSeekRequestRecord(bodyStr);
  const chatSessionId = typeof body.chat_session_id === 'string'
    ? body.chat_session_id.trim()
    : '';
  if (!chatSessionId) {
    throw new Error('DeepSeek regenerate chat_session_id must be a non-empty string.');
  }
  const childMessageId = normalizeDeepSeekMessageId(body.child_message_id);
  if (childMessageId === null) {
    throw new Error('DeepSeek regenerate child_message_id must be a valid message id.');
  }
  return {
    ...body,
    chat_session_id: chatSessionId,
    child_message_id: childMessageId,
  } as DeepSeekRegenerateRequestBody;
}

function decodeDeepSeekRequestRecord(bodyStr: string): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(bodyStr);
  } catch {
    throw new Error('DeepSeek request body must be valid JSON.');
  }

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('DeepSeek request body must be a plain object.');
  }
  return value as Record<string, unknown>;
}

export function augmentDecodedRequestBody(
  decodedBody: Readonly<DeepSeekRequestBody>,
  state: RequestAugmentationState,
): RequestBodyAugmentationResult {
  const body: DeepSeekRequestBody = { ...decodedBody };

  const originalPrompt = body.prompt;
  const locale = state.locale ?? DEFAULT_LOCALE;

  const thinkingEnabled = body.thinking_enabled === true;
  const isFirstMessage = body.parent_message_id === null || body.parent_message_id === undefined;
  const messageCount = isFirstMessage ? 1 : state.messageCount + 1;
  const promptSettings = normalizePromptInjectionSettings(state.promptSettings ?? DEFAULT_PROMPT_INJECTION_SETTINGS);
  const shouldInjectPreset = shouldInjectPresetForTurn({
    hasActivePreset: Boolean(state.activePreset),
    isFirstMessage,
    messageCount,
    cadence: promptSettings.presetCadence,
  });
  const presetContent = shouldInjectPreset ? state.activePreset!.content : null;
  const forceResponseLanguage = promptSettings.forceResponseLanguage === 'auto'
    ? null
    : promptSettings.forceResponseLanguage;

  if (state.modelType) {
    body.model_type = state.modelType;
  }

  const modelFacingToolDescriptors = projectToolDescriptorsForNativeSearch(
    state.toolDescriptors,
    body.search_enabled === true,
  );

  const invocation = parseSkillCommand(originalPrompt);
  let resolved: ResolvedSkills | null = null;
  let activeLocalSkillDir: string | undefined;
  let activeLocalSkillDefFile: string | undefined;

  if (invocation) {
    const primarySkill = state.skills.find((s) => s.name === invocation.skillName);
    if (primarySkill && isLocalIndexSkill(primarySkill)) {
      activeLocalSkillDir = primarySkill.remote?.localDirectory || undefined;
      activeLocalSkillDefFile = definitionFileOf(primarySkill.remote);
    }
    resolved = resolveSkills(state.skills, invocation.skillName, invocation.args, locale);
  } else {
    // Implicit branch: with no trigger token, score local indexed skills against user input and activate
    // the highest-scoring one above threshold.
    // Gated by the "auto-activation" toggle:
    //   everyMessage ⇒ allowed on every message; else firstMessage ⇒ only first message; both off ⇒ no activation.
    const auto = state.skillAutoActivation ?? DEFAULT_SKILL_AUTO_ACTIVATION_SETTINGS;
    const implicitAllowed = auto.everyMessage || (auto.firstMessage && isFirstMessage);
    if (implicitAllowed) {
      const picked = selectImplicitLocalSkill(state.skills, originalPrompt);
      if (picked) {
        activeLocalSkillDir = picked.remote?.localDirectory || undefined;
        activeLocalSkillDefFile = definitionFileOf(picked.remote);
        resolved = {
          combinedPrompt: composeLocalSkillPrompt(picked),
          memoryEnabled: picked.memoryEnabled,
          skillName: picked.name,
        };
      }
    }
  }

  if (resolved) {
    const scopedMemories = filterMemoriesByProjectScope(state.memories, state.projectId);
    const isLocalIndexActivated = activeLocalSkillDir !== undefined;

    let augmented: string;
    let usedMemoryIds: number[];
    if (isLocalIndexActivated) {
      // Local indexed skill (explicit / implicit hit): inject "activation instruction + index" into the
      // system context (like the ## Tools section of systemChat). The real user query stays as visible
      // user input so the model does not treat it as passive chit-chat and ignore the disk-read instruction
      // (fixes Bug ② framing inversion).
      const { augmented: a, usedMemoryIds: m } = buildPromptAugmentation(originalPrompt, {
        memories: scopedMemories,
        thinkingEnabled,
        identityOnly: !resolved.memoryEnabled,
        skillSystemContext: buildLocalSkillSystemContext(resolved, activeLocalSkillDir, activeLocalSkillDefFile, locale),
        presetContent,
        projectContext: state.projectContext,
        toolDescriptors: modelFacingToolDescriptors,
        locale,
        memoryEnabled: promptSettings.memoryEnabled,
        systemPromptEnabled: promptSettings.systemPromptEnabled,
        forceResponseLanguage,
      });
      augmented = a;
      usedMemoryIds = m;
    } else {
      // Non-local indexed skill (builtin/github/bundled): keep prior behavior, index injected as visible user input.
      const { augmented: a, usedMemoryIds: m } = buildPromptAugmentation(resolved.combinedPrompt, {
        memories: scopedMemories,
        thinkingEnabled,
        identityOnly: !resolved.memoryEnabled,
        visibleUserPrompt: originalPrompt,
        presetContent,
        projectContext: state.projectContext,
        toolDescriptors: modelFacingToolDescriptors,
        locale,
        memoryEnabled: promptSettings.memoryEnabled,
        systemPromptEnabled: promptSettings.systemPromptEnabled,
        forceResponseLanguage,
      });
      augmented = a;
      usedMemoryIds = m;
    }

    body.prompt = augmented;
    return {
      body: JSON.stringify(body),
      agentTaskPrompt: resolved.combinedPrompt,
      usedMemoryIds,
      messageCount,
      activeLocalSkillDir,
    };
  }

  const { augmented, usedMemoryIds } = buildPromptAugmentation(originalPrompt, {
    memories: filterMemoriesByProjectScope(state.memories, state.projectId),
    thinkingEnabled,
    presetContent,
    projectContext: state.projectContext,
    toolDescriptors: modelFacingToolDescriptors,
    locale,
    memoryEnabled: promptSettings.memoryEnabled,
    systemPromptEnabled: promptSettings.systemPromptEnabled,
    forceResponseLanguage,
  });
  body.prompt = augmented;

  return {
    body: JSON.stringify(body),
    agentTaskPrompt: originalPrompt,
    usedMemoryIds,
    messageCount,
    activeLocalSkillDir,
  };
}

type AugmentationSkill = RequestAugmentationState['skills'][number];

function isLocalIndexSkill(skill: AugmentationSkill): boolean {
  // A real local skill lands as source: 'remote' + remote.provider: 'local' (see core/skill/local-importer.ts),
  // so use remote.provider as the discriminator (consistent with UI SkillCard / SkillPage);
  // cannot use source === 'local' — the SkillSource union has no 'local' member, which would both trigger a
  // TS type error and make real local skills never match.
  return skill.remote?.provider === 'local' && isLocalIndexInstructions(skill.instructions);
}

// Derive the actual definition file name from a local skill's remote.path.
// Directory-type skills store `SKILL.md` (e.g. `sub/SKILL.md` -> `SKILL.md`); single-file-type skills
// store the real `.md` file name (e.g. `Skill-review.md`). The basename is what the activation directive
// must point the Agent at, so it reads the correct definition file on disk.
function definitionFileOf(remote: AugmentationSkill['remote']): string | undefined {
  const p = remote?.path;
  if (!p) return undefined;
  const normalized = p.replace(/\\/g, '/');
  const idx = normalized.lastIndexOf('/');
  return idx === -1 ? normalized : normalized.slice(idx + 1);
}

// Build the local indexed skill's activation prompt: index instructions + D4 boundary (dynamically
// generated from skillDir) + D1 defensive rewrite. The real disk read is done by the Agent at activation
// via local_file_read (the extension runs in a browser sandbox with no local synchronous file channel).
//
// Declaration narrowing (Review #3 Route A): the D1 rewrite here applies ONLY to the injected index-instruction
// text (see the local-path-rewriter.ts file header); it does NOT cover the local skill's real definition file body and
// its reference file contents. Real-body relative references rely on the Agent following the D4 soft hint's
// "double-base rule" to resolve themselves. Hence this function does not constitute "full real-file relative-
// reference coverage", but a declaration-consistent "index-instruction-layer defensive normalization + Agent-
// layer soft-hint fallback".
function composeLocalSkillPrompt(skill: AugmentationSkill): string {
  const skillDir = skill.remote?.localDirectory ?? '';
  let prompt = skill.instructions;
  if (skillDir) {
    const knownAbs = new Set<string>();
    const files = [
      ...(skill.remote?.includedFiles ?? []),
      ...(skill.remote?.scriptFiles ?? []),
      ...(skill.remote?.omittedFiles ?? []),
    ];
    for (const file of files) {
      const abs = joinUnderRoot(skillDir, file.path);
      if (abs) knownAbs.add(abs);
    }
    prompt = absolutizeSkillReferences(prompt, {
      skillDir,
      thisFileDir: skillDir,
      fileExists: (abs) => knownAbs.has(abs),
    });
    if (!prompt.includes('## Local Execution Boundary')) {
      prompt = `${prompt}\n\n---\n\n${buildLocalExecutionBoundary(skillDir, basename(skill.remote?.path ?? 'SKILL.md'))}`;
    }
  }
  return prompt;
}

// Build the local indexed skill's system context: activation instruction (anti-impatience, force-read
// the definition file first) + index body. Injected as a system instruction (not visible user input), so
// the model obeys its "read disk before executing" constraint (fixes Bug ② framing inversion). The
// definition file is derived from remote.path basename, so it resolves to `SKILL.md` for directory-type
// skills and to the real `.md` file name for single-file-type skills.
function buildLocalSkillSystemContext(
  resolved: ResolvedSkills,
  skillDir: string | undefined,
  definitionFile: string | undefined,
  locale: SupportedLocale,
): string {
  // Directory-type skills use `SKILL.md`; single-file-type skills use the actual `.md` file name. Derive
  // it from remote.path basename and fall back to `SKILL.md` for legacy records lacking path info.
  const defFile = definitionFile && definitionFile.length > 0 ? definitionFile : 'SKILL.md';
  const skillMdPath = skillDir ? `${skillDir}/${defFile}` : defFile;
  const directive = translate(locale, 'prompt.localSkillActivationDirective', {
    skillName: resolved.skillName,
    skillMdPath,
  });
  return `${directive}\n\n${resolved.combinedPrompt}`;
}

// Implicit branch: score local indexed skills against user input and return the matched skill object (or null).
function selectImplicitLocalSkill(skills: AugmentationSkill[], query: string): AugmentationSkill | null {
  const localSkillsForProbe = skills.filter(isLocalIndexSkill);
  const candidates: LocalSkillIndex[] = localSkillsForProbe
    .map((s) => ({
      name: s.name,
      description: s.description ?? '',
      skillDir: s.remote?.localDirectory ?? '',
      instructions: s.instructions ?? '',
    }));
  const picked = selectImplicitSkill(query, candidates);
  if (!picked) return null;
  return skills.find(
    (s) => s.name === picked.name && (s.remote?.localDirectory ?? '') === picked.skillDir,
  ) ?? null;
}

function resolveSkills(
  skills: RequestAugmentationState['skills'],
  skillName: string,
  args: string,
  locale: SupportedLocale,
): ResolvedSkills | null {
  const primarySkill = skills.find((s) => s.name === skillName);
  if (!primarySkill) return null;

  const primaryPrompt = composeResolvedInstructions(primarySkill);

  const secondInvocation = parseSkillCommand('/' + args);
  if (secondInvocation) {
    const secondSkill = skills.find((s) => s.name === secondInvocation.skillName);
    if (secondSkill) {
      const userArgs = secondInvocation.args;
      const combinedInstructions = primaryPrompt + '\n\n---\n\n' + composeResolvedInstructions(secondSkill);
      return {
        combinedPrompt: userArgs
          ? wrapUserInput(combinedInstructions, userArgs, locale)
          : combinedInstructions,
        memoryEnabled: primarySkill.memoryEnabled || secondSkill.memoryEnabled,
        skillName: primarySkill.name,
      };
    }
  }

  return {
    combinedPrompt: args
      ? wrapUserInput(primaryPrompt, args, locale)
      : primaryPrompt,
    memoryEnabled: primarySkill.memoryEnabled,
    skillName: primarySkill.name,
  };
}

// Local indexed skills return "index instruction + D4 boundary + D1 defensive rewrite"; other sources keep
// their original frozen instructions (builtin/bundled/github unchanged).
function composeResolvedInstructions(skill: AugmentationSkill): string {
  if (isLocalIndexSkill(skill)) return composeLocalSkillPrompt(skill);
  return skill.instructions;
}

function wrapUserInput(
  instructions: string,
  userInput: string,
  locale: SupportedLocale,
): string {
  return translate(locale, 'prompt.skillUserInputWrapper', { instructions, userInput });
}
