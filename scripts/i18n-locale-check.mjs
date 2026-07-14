#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const failures = [];
const localePaths = {
  en: 'public/_locales/en/messages.json',
  zh_CN: 'public/_locales/zh_CN/messages.json',
};
const requiredKeys = [
  'extension_name',
  'extension_description',
  'extension_action_title',
];

const localeMessages = Object.fromEntries(
  Object.entries(localePaths).map(([locale, path]) => [locale, readJson(path)]),
);

for (const [locale, messages] of Object.entries(localeMessages)) {
  if (!messages) continue;
  for (const key of requiredKeys) {
    const entry = messages[key];
    if (!entry || typeof entry !== 'object') {
      failures.push(`${locale}: missing ${key}`);
      continue;
    }
    if (typeof entry.message !== 'string' || entry.message.trim() === '') {
      failures.push(`${locale}: ${key}.message must be a non-empty string`);
    }
  }
}

const locales = Object.keys(localeMessages).filter((locale) => localeMessages[locale]);
if (locales.length > 1) {
  const [firstLocale, ...rest] = locales;
  const firstKeys = Object.keys(localeMessages[firstLocale]).sort();
  for (const locale of rest) {
    const keys = Object.keys(localeMessages[locale]).sort();
    if (JSON.stringify(keys) !== JSON.stringify(firstKeys)) {
      failures.push(`${locale}: message keys differ from ${firstLocale}`);
    }
  }
}

const wxtConfig = readText('wxt.config.ts');
const background = readText('entrypoints/background.ts');
const content = readText('entrypoints/content.ts');
const releaseAssetsCheck = readText('scripts/release-assets-check.mjs');
for (const key of requiredKeys) {
  assertIncludes(wxtConfig, `__MSG_${key}__`, `wxt.config.ts must reference __MSG_${key}__`);
}
assertIncludes(wxtConfig, "default_locale: 'en'", 'wxt.config.ts must set default_locale to en');
assertIncludes(
  wxtConfig,
  "targetBrowsers: ['chrome', 'edge', 'firefox']",
  'wxt.config.ts must keep Chrome, Edge, and Firefox targets',
);
assertIncludes(
  wxtConfig,
  "const CHROMIUM_BROWSERS = new Set(['chrome', 'edge'])",
  'wxt.config.ts must keep sidePanel scoped to Chromium browsers',
);

assertIncludes(background, 'watchLocalePreference(() =>', 'background must watch locale preference changes');
assertIncludes(background, 'await createContextMenus();', 'background locale changes must recreate context menus');
assertIncludes(background, 'await broadcastStateUpdate();', 'background locale changes must refresh localized runtime state');
assertIncludes(background, 'await broadcastToolDescriptorsUpdate();', 'background locale changes must refresh localized tool descriptors');
assertIncludes(background, 'await chrome.contextMenus.removeAll();', 'context menu recreation must clear stale localized menu titles');
assertIncludes(
  background,
  "title: backgroundT('background.contextMenus.sendToChat')",
  'context menu title must be locale-backed',
);

assertIncludes(content, 'watchLocalePreference(() =>', 'content script must watch locale preference changes');
assertIncludes(content, 'currentContentLocale = resolved.locale', 'content script must refresh resolved locale state');
assertIncludes(
  content,
  'return loadAndSyncRuntimeState(undefined, isCurrent);',
  'content locale changes must reload localized skills and tool descriptors',
);

assertIncludes(
  releaseAssetsCheck,
  "_locales/en/messages.json",
  'release asset check must require English locale assets in packaged zips',
);
assertIncludes(
  releaseAssetsCheck,
  "_locales/zh_CN/messages.json",
  'release asset check must require Chinese locale assets in packaged zips',
);

if (failures.length > 0) {
  console.error('I18n locale check failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('I18n locale check passed');

function readJson(relativePath) {
  try {
    return JSON.parse(readText(relativePath));
  } catch (error) {
    failures.push(`${relativePath}: ${error.message}`);
    return null;
  }
}

function readText(relativePath) {
  return readFileSync(resolve(root, relativePath), 'utf8');
}

function assertIncludes(text, fragment, message) {
  if (!text.includes(fragment)) failures.push(message);
}
