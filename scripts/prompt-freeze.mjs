#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const EXPECTED_HASHES = {
  systemTemplateChat: '5bca8e90d23381c9605cbfebf7ecb91f28f4010ddbc2a6ccc291fa046fcd6eec',
  systemTemplateThinking: 'fa31e863e5f54f7a4e48cffdbae0e543028de4a565f77504e66edd707c73b5f3',
  memoryToolSchemas: 'a64e0a8874552177eba10089d5acfdc2996d0b703f83b1a57e9d76c733da9a7b',
  promptAugmentationBuild: '2f7ee320df74f397beae7537c16083de0322abecf800e1d56275c2639887ffca',
  promptToolSchemaRenderer: '86df1accccfa1f43a95483625970d54f399d57b0b7c1ea1294b5662e09202d3f',
  promptLocaleResourcesEn: 'bcbdf3a412056174efe876284cadc87b9eab7bbd58960eeec3028394b793c0e5',
  promptLocaleResourcesZhCN: '8bbbf8a458578a56b4f42b787e9770fea2708c7e635d2c6fba7e049096ccf1b3',
  inlineAgentContinuationPrompt: 'c7c6d857cd4c14015329bccd7ce2e551b0f3490593e89c163db713e842cbfc22',
  inlineAgentNudgePrompt: '4717a41143efacf66a2554c8d7d72c08f7192c0b0b93105a869f0638bd7ba4ea',
  inlineAgentPromptHelpers: '709593b0c176e0055018670d017d473bb75fd80696303340b9f902834aa705bf',
};

const sources = {
  constants: readSource('core/constants.ts'),
  augmentation: readSource('core/prompt/augmentation.ts'),
  inlinePrompt: readSource('core/inline-agent/prompt.ts'),
  enResource: readSource('core/i18n/resources/en.ts'),
  zhCNResource: readSource('core/i18n/resources/zh-CN.ts'),
};

const cases = {
  systemTemplateChat: extractRegex(
    'SYSTEM_TEMPLATE_CHAT',
    sources.constants,
    /export const SYSTEM_TEMPLATE_CHAT = `[\s\S]*?`;\n/,
  ),
  systemTemplateThinking: extractRegex(
    'SYSTEM_TEMPLATE_THINKING',
    sources.constants,
    /export const SYSTEM_TEMPLATE_THINKING = `[\s\S]*?`;\n/,
  ),
  memoryToolSchemas: [
    extractRegex('MEMORY_SAVE_SCHEMA', sources.constants, /export const MEMORY_SAVE_SCHEMA = '[\s\S]*?';\n/),
    extractRegex('MEMORY_UPDATE_SCHEMA', sources.constants, /export const MEMORY_UPDATE_SCHEMA = '[\s\S]*?';\n/),
    extractRegex('MEMORY_DELETE_SCHEMA', sources.constants, /export const MEMORY_DELETE_SCHEMA = '[\s\S]*?';\n/),
  ].join('\n'),
  promptAugmentationBuild: extractFunction('buildPromptAugmentation', sources.augmentation),
  promptToolSchemaRenderer: [
    extractFunction('renderToolSchemas', sources.augmentation),
    extractFunction('renderWebSearchGuidance', sources.augmentation),
    extractFunction('renderToolSchema', sources.augmentation),
    extractFunction('renderShellMcpHint', sources.augmentation),
    extractFunction('renderPythonMcpHint', sources.augmentation),
    extractFunction('renderToolFormatReminder', sources.augmentation),
    extractFunction('createExamplePayload', sources.augmentation),
    extractFunction('exampleValue', sources.augmentation),
  ].join('\n\n'),
  promptLocaleResourcesEn: extractRegex(
    'prompt locale resources en',
    sources.enResource,
    /  prompt: \{[\s\S]*?\n  pet: \{/,
  ),
  promptLocaleResourcesZhCN: extractRegex(
    'prompt locale resources zh-CN',
    sources.zhCNResource,
    /  prompt: \{[\s\S]*?\n  pet: \{/,
  ),
  inlineAgentContinuationPrompt: extractFunction('buildContinuationPrompt', sources.inlinePrompt),
  inlineAgentNudgePrompt: extractFunction('buildNudgePrompt', sources.inlinePrompt),
  inlineAgentPromptHelpers: [
    extractFunction('extractTaskCompleteSignal', sources.inlinePrompt),
    extractFunction('shouldNudge', sources.inlinePrompt),
    extractFunction('renderToolResults', sources.inlinePrompt),
    extractFunction('clampText', sources.inlinePrompt),
  ].join('\n\n'),
};

const failures = [];
for (const [name, text] of Object.entries(cases)) {
  const actual = sha256(text);
  const expected = EXPECTED_HASHES[name];
  if (actual !== expected) {
    failures.push(`${name}: expected ${expected}, got ${actual}`);
  }
}

if (failures.length > 0) {
  console.error('Prompt freeze failed: prompt-generating source changed.');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Prompt freeze passed: ${Object.keys(cases).length} cases`);

function readSource(relativePath) {
  return fs.readFileSync(path.join(rootDir, relativePath), 'utf8');
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function extractRegex(name, text, regex) {
  const match = regex.exec(text);
  if (!match) throw new Error(`Prompt freeze case not found: ${name}`);
  return match[0];
}

function extractFunction(name, text) {
  const start = text.indexOf(`function ${name}`);
  if (start < 0) throw new Error(`Prompt freeze function not found: ${name}`);

  const openingBrace = text.indexOf('{', start);
  if (openingBrace < 0) throw new Error(`Prompt freeze function has no body: ${name}`);

  let depth = 0;
  for (let i = openingBrace; i < text.length; i++) {
    const char = text[i];
    if (char === '{') depth++;
    if (char === '}') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }

  throw new Error(`Prompt freeze function is not closed: ${name}`);
}
