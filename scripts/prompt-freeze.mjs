#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const EXPECTED_HASHES = {
  systemTemplateChat: '09de5bae008daf2ced47db22afe2e3f763286bb98eda5d771c2657aadd467a7a',
  systemTemplateThinking: 'bf9eae66a53517c0882eec871d5e1e6cfb304e01d7ab4ec3f45d4e615162b746',
  memoryToolSchemas: 'a64e0a8874552177eba10089d5acfdc2996d0b703f83b1a57e9d76c733da9a7b',
  promptAugmentationBuild: '4c3ff57dc5380076fdf9977fef1fb693ee76096c7ea2c228def98cb0d6365972',
  promptToolSchemaRenderer: '931fe785044dd97514d89c8aaa9596e8ec3b81c5f9b7ff61f11af1599bc53fd6',
  promptStablePrefix: '6060d3daee1df23d5c38bdbb36dfa331aa89f5c68db0260fd6372b0611797986',
  promptScenarioConfig: '7f0d0ec4d39f2ff3b257047d4f9edf8e304b462a34c6cf9823fc0c4c9dfbc818',
  promptLocaleResourcesEn: '232c1eb57854f413b589e7c785e9c927f56f35711ee3e0ccf6eb42770d4f310d',
  promptLocaleResourcesZhCN: 'e5c223dc2a1d06b51d08e5a78b00dea21161aec1314ea1347f6e4e068b87c794',
  inlineAgentContinuationPrompt: '614e0f3526250a84724edfb6f878da1266105ba94bcdac93a185b55080c61972',
  inlineAgentNudgePrompt: 'acdf7ae230399f186eb6072e82d28544c25443ac794675a07d67a8df1154bc28',
  inlineAgentPromptHelpers: 'dd31ff0128c341f42703affaf8add96fb8425b839a1ae8342b393e7827d5538a',
};

const sources = {
  constants: readSource('core/constants.ts'),
  augmentation: readSource('core/prompt/augmentation.ts'),
  stablePrefix: readSource('core/prompt/cache-boundary.ts'),
  scenario: readSource('core/prompt/scenario.ts'),
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
    extractFunction('renderFullToolSchemas', sources.augmentation),
    extractFunction('renderToolSchema', sources.augmentation),
    extractFunction('createExamplePayload', sources.augmentation),
    extractFunction('exampleValue', sources.augmentation),
  ].join('\n\n'),
  promptStablePrefix: extractFunction('buildStablePrefix', sources.stablePrefix),
  promptScenarioConfig: [
    extractConstArray('TOOL_GROUPS', sources.scenario),
    extractConstObject('SCENARIO_GUIDANCE', sources.scenario),
    extractConstObject('TOOL_PRIORITY_RULES', sources.scenario),
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
  let start = text.indexOf(`export function ${name}`);
  if (start < 0) start = text.indexOf(`function ${name}`);
  if (start < 0) start = text.indexOf(`export const ${name} = (`);
  if (start < 0) start = text.indexOf(`const ${name} = (`);
  if (start < 0) throw new Error(`Function not found: ${name}`);

  const bodyStart = text.indexOf('{', start);
  if (bodyStart < 0) throw new Error(`Function has no body: ${name}`);

  let depth = 0;
  for (let i = bodyStart; i < text.length; i++) {
    if (text[i] === '{') depth++;
    if (text[i] === '}') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  throw new Error(`Function is not closed: ${name}`);
}

function extractConstArray(name, text) {
  const start = text.indexOf(`export const ${name}`);
  if (start < 0) throw new Error(`Array not found: ${name}`);

  const valueStart = text.indexOf('[', start);
  if (valueStart < 0) throw new Error(`Array has no opening bracket: ${name}`);

  let depth = 0;
  for (let i = valueStart; i < text.length; i++) {
    if (text[i] === '[') depth++;
    if (text[i] === ']') {
      depth--;
      if (depth === 0) {
        const remainder = text.slice(i + 1, i + 20);
        const asConst = remainder.match(/^\s*as\s+const\s*;/);
        if (asConst) return text.slice(start, i + 1 + asConst[0].length);
        return text.slice(start, i + 1);
      }
    }
  }
  throw new Error(`Array is not closed: ${name}`);
}

function extractConstObject(name, text) {
  const start = text.indexOf(`export const ${name}`);
  if (start < 0) throw new Error(`Object not found: ${name}`);

  const valueStart = text.indexOf('{', start);
  if (valueStart < 0) throw new Error(`Object has no opening brace: ${name}`);

  let depth = 0;
  for (let i = valueStart; i < text.length; i++) {
    if (text[i] === '{') depth++;
    if (text[i] === '}') {
      depth--;
      if (depth === 0) {
        const remainder = text.slice(i + 1, i + 20);
        const asConst = remainder.match(/^\s*as\s+const\s*;/);
        if (asConst) return text.slice(start, i + 1 + asConst[0].length);
        return text.slice(start, i + 1);
      }
    }
  }
  throw new Error(`Object is not closed: ${name}`);
}
