#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const failures = [];
const packageJson = readJson('package.json');

const targets = [
  {
    browser: 'chrome',
    manifestPath: 'dist/chrome-mv3/manifest.json',
    permissions: ['storage', 'alarms', 'nativeMessaging', 'contextMenus', 'offscreen', 'debugger', 'tabs', 'sidePanel'],
  },
  {
    browser: 'edge',
    manifestPath: 'dist/edge-mv3/manifest.json',
    permissions: ['storage', 'alarms', 'nativeMessaging', 'contextMenus', 'offscreen', 'debugger', 'tabs', 'sidePanel'],
  },
  {
    browser: 'firefox',
    manifestPath: 'dist/firefox-mv3/manifest.json',
    permissions: ['storage', 'alarms', 'nativeMessaging', 'contextMenus'],
  },
];

const expectedHostPermissions = [
  '*://chat.deepseek.com/*',
  'https://api.deepseek.com/*',
  '*://cn.bing.com/*',
  '*://www.bing.com/*',
];
const expectedOptionalHostPermissions = ['http://*/*', 'https://*/*'];
const expectedLocalizedManifest = {
  default_locale: 'en',
  name: '__MSG_extension_name__',
  description: '__MSG_extension_description__',
  actionTitle: '__MSG_extension_action_title__',
};

for (const target of targets) {
  const manifest = readJson(target.manifestPath, `Run npm run build:all before npm run verify:manifest-policy.`);
  if (!manifest) continue;

  assertEqual(manifest.version, packageJson.version, `${target.browser}: manifest version must match package.json`);
  assertEqual(manifest.default_locale, expectedLocalizedManifest.default_locale, `${target.browser}: default_locale`);
  assertEqual(manifest.name, expectedLocalizedManifest.name, `${target.browser}: localized name`);
  assertEqual(manifest.description, expectedLocalizedManifest.description, `${target.browser}: localized description`);
  assertSetEqual(manifest.permissions, target.permissions, `${target.browser}: permissions`);
  assertSetEqual(manifest.host_permissions, expectedHostPermissions, `${target.browser}: host_permissions`);
  assertSetEqual(
    manifest.optional_host_permissions,
    expectedOptionalHostPermissions,
    `${target.browser}: optional_host_permissions`,
  );

  if (target.permissions.includes('sidePanel')) {
    assert(Boolean(manifest.side_panel?.default_path), `${target.browser}: side_panel.default_path is required`);
    assertEqual(manifest.action?.default_title, expectedLocalizedManifest.actionTitle, `${target.browser}: action.default_title`);
  } else {
    assert(!manifest.side_panel, `${target.browser}: side_panel must be omitted`);
  }

  const webResources = manifest.web_accessible_resources?.flatMap((entry) => entry.resources ?? []) ?? [];
  assert(webResources.includes('pet/*.png'), `${target.browser}: pet assets must be web accessible`);
  assert(webResources.includes('deepseek/*.wasm'), `${target.browser}: DeepSeek wasm must be web accessible`);
  assert(manifest.sandbox?.pages?.includes('sandbox-runner.html'), `${target.browser}: sandbox runner page must be declared`);
  assertIncludes(
    manifest.content_security_policy?.sandbox ?? '',
    "'unsafe-inline'",
    `${target.browser}: sandbox CSP must allow inline scripts for srcdoc HTML execution`,
  );
  assert(
    !(manifest.content_security_policy?.extension_pages ?? '').includes("'unsafe-inline'"),
    `${target.browser}: extension_pages CSP must not allow inline scripts`,
  );
  assertFileExists(target.manifestPath.replace('manifest.json', 'pyodide/pyodide.mjs'), `${target.browser}: Pyodide module asset must be bundled`);
  assertFileExists(target.manifestPath.replace('manifest.json', 'pyodide/pyodide.asm.wasm'), `${target.browser}: Pyodide wasm asset must be bundled`);
  assertFileExists(target.manifestPath.replace('manifest.json', 'pyodide/python_stdlib.zip'), `${target.browser}: Pyodide stdlib asset must be bundled`);
}

const background = readText('entrypoints/background.ts');
const nativeTransport = readText('core/mcp/transports/native.ts');
const browserControlConnection = readText('core/browser-control/cdp.ts');
const browserControlService = readText('core/browser-control/service.ts');
const wxtConfig = readText('wxt.config.ts');
const privacyPolicy = readText('docs/chrome-web-store/privacy-policy.md');
const submission = readText('docs/chrome-web-store/submission.md');

assertIncludes(background, 'chrome.alarms.create', 'alarms permission must create a Chrome alarm');
assertIncludes(background, 'chrome.alarms.onAlarm.addListener', 'alarms permission must listen for alarm wakeups');
assertIncludes(nativeTransport, 'chrome.runtime.connectNative', 'nativeMessaging permission must use connectNative');
assertIncludes(background, 'chrome.contextMenus.create', 'contextMenus permission must create menu items');
assertIncludes(background, 'chrome.contextMenus.onClicked.addListener', 'contextMenus permission must handle clicks');
assertIncludes(background, 'chrome.offscreen.createDocument', 'offscreen permission must create an offscreen document');
assertIncludes(background, 'chrome.sidePanel', 'sidePanel permission must use the side panel API');
assertIncludes(browserControlConnection, 'chromeApi.debugger', 'debugger permission must use the debugger API');
assertIncludes(browserControlService, 'chromeApi.tabs', 'tabs permission must use the tabs API');
assertIncludes(browserControlService, 'chromeApi.tabGroups', 'tabGroups API must be optional browser-control metadata');
assertIncludes(wxtConfig, 'web_accessible_resources', 'web accessible resources must be declared in manifest config');
assertIncludes(wxtConfig, "default_locale: 'en'", 'manifest config must declare default locale');
assertIncludes(wxtConfig, '__MSG_extension_name__', 'manifest config must use localized name');
assertIncludes(wxtConfig, '__MSG_extension_description__', 'manifest config must use localized description');
assertIncludes(wxtConfig, '__MSG_extension_action_title__', 'manifest config must use localized action title');
assertIncludes(wxtConfig, 'pyodideAssetsPlugin', 'manifest build must bundle Pyodide assets for browser Python sandbox');

for (const permission of ['storage', 'alarms', 'contextMenus', 'nativeMessaging', 'offscreen', 'debugger', 'tabs', 'sidePanel']) {
  assertIncludes(privacyPolicy, `\`${permission}\``, `privacy policy must document ${permission}`);
  assertIncludes(submission, `#### \`${permission}\``, `Chrome Web Store submission notes must justify ${permission}`);
}

if (failures.length > 0) {
  console.error('Manifest policy check failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('Manifest policy check passed');

function readJson(relativePath, missingHint) {
  try {
    return JSON.parse(readText(relativePath));
  } catch (error) {
    failures.push(`${relativePath}: ${error.message}${missingHint ? ` ${missingHint}` : ''}`);
    return null;
  }
}

function assertFileExists(relativePath, message) {
  try {
    readFileSync(resolve(root, relativePath));
  } catch {
    failures.push(message);
  }
}

function readText(relativePath) {
  return readFileSync(resolve(root, relativePath), 'utf8');
}

function assert(condition, message) {
  if (!condition) failures.push(message);
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) failures.push(`${message}: expected ${expected}, got ${actual}`);
}

function assertIncludes(text, fragment, message) {
  if (!text.includes(fragment)) failures.push(message);
}

function assertSetEqual(actual, expected, message) {
  if (!Array.isArray(actual)) {
    failures.push(`${message}: expected array`);
    return;
  }
  const actualSorted = [...actual].sort();
  const expectedSorted = [...expected].sort();
  if (JSON.stringify(actualSorted) !== JSON.stringify(expectedSorted)) {
    failures.push(`${message}: expected ${expectedSorted.join(', ')}, got ${actualSorted.join(', ')}`);
  }
}
