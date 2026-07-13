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
    permissions: ['storage', 'alarms', 'nativeMessaging', 'contextMenus', 'offscreen', 'debugger', 'tabs', 'identity', 'sidePanel'],
  },
  {
    browser: 'edge',
    manifestPath: 'dist/edge-mv3/manifest.json',
    permissions: ['storage', 'alarms', 'nativeMessaging', 'contextMenus', 'offscreen', 'debugger', 'tabs', 'identity', 'sidePanel'],
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
  'https://accounts.google.com/*',
  'https://oauth2.googleapis.com/*',
  'https://www.googleapis.com/*',
  'https://login.microsoftonline.com/*',
  'https://graph.microsoft.com/*',
];
const expectedOptionalHostPermissions = ['http://*/*', 'https://*/*'];
const expectedLocalizedManifest = {
  default_locale: 'en',
  name: '__MSG_extension_name__',
  description: '__MSG_extension_description__',
  actionTitle: '__MSG_extension_action_title__',
};
const expectedExtensionCsp = "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'";
const expectedSandboxCsp = [
  'sandbox allow-scripts',
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' blob:",
  'worker-src blob:',
  "child-src 'self' blob: data:",
  "frame-src 'self' blob: data:",
  "connect-src 'self' blob:",
  "object-src 'none'",
].join('; ');
const expectedFirefoxId = 'deepseek-pp@zhu1090093659.github';
const expectedFirefoxDataCategories = ['websiteContent', 'personalCommunications'];

for (const target of targets) {
  const manifest = readJson(target.manifestPath, `Run npm run build:all before npm run verify:manifest-policy.`);
  if (!manifest) continue;

  assertEqual(manifest.manifest_version, 3, `${target.browser}: manifest_version`);
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
    assertEqual(manifest.side_panel?.default_path, 'sidepanel.html', `${target.browser}: side_panel.default_path`);
    assertEqual(manifest.action?.default_title, expectedLocalizedManifest.actionTitle, `${target.browser}: action.default_title`);
    assert(!manifest.browser_specific_settings, `${target.browser}: browser_specific_settings must be omitted`);
  } else {
    assert(!manifest.side_panel, `${target.browser}: side_panel must be omitted`);
    assert(!manifest.action, `${target.browser}: action must be omitted`);
    assertEqual(
      manifest.browser_specific_settings?.gecko?.id,
      expectedFirefoxId,
      `${target.browser}: stable Firefox extension id`,
    );
    assertSetEqual(
      manifest.browser_specific_settings?.gecko?.data_collection_permissions?.required,
      expectedFirefoxDataCategories,
      `${target.browser}: Firefox data collection categories`,
    );
  }

  const webResources = manifest.web_accessible_resources ?? [];
  assertEqual(webResources.length, 2, `${target.browser}: web-accessible resource group count`);
  const deepSeekResources = webResources.find((entry) =>
    Array.isArray(entry.resources) && entry.resources.includes('deepseek/*.wasm'));
  const globalResources = webResources.find((entry) =>
    Array.isArray(entry.resources) && entry.resources.includes('sidepanel.html'));
  assertSetEqual(
    deepSeekResources?.resources,
    ['pet/*.png', 'deepseek/*.wasm'],
    `${target.browser}: DeepSeek-scoped web resources`,
  );
  assertSetEqual(
    deepSeekResources?.matches,
    ['*://chat.deepseek.com/*'],
    `${target.browser}: DeepSeek-scoped resource matches`,
  );
  assertSetEqual(
    globalResources?.resources,
    ['sidepanel.html', 'pet/deepseek-whale-pet-states.png'],
    `${target.browser}: global floating-chat resources`,
  );
  assertSetEqual(
    globalResources?.matches,
    ['<all_urls>'],
    `${target.browser}: global floating-chat resource matches`,
  );
  assertSetEqual(manifest.sandbox?.pages, ['sandbox-runner.html'], `${target.browser}: sandbox pages`);
  assertEqual(manifest.content_security_policy?.extension_pages, expectedExtensionCsp, `${target.browser}: extension CSP`);
  assertEqual(manifest.content_security_policy?.sandbox, expectedSandboxCsp, `${target.browser}: sandbox CSP`);
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
assertIncludes(wxtConfig, "'identity'", 'identity permission must be declared for cloud sync OAuth');
assertIncludes(wxtConfig, 'chrome.identity.launchWebAuthFlow', 'identity permission must be tied to user-approved cloud sync OAuth');
assertIncludes(wxtConfig, 'web_accessible_resources', 'web accessible resources must be declared in manifest config');
assertIncludes(wxtConfig, "default_locale: 'en'", 'manifest config must declare default locale');
assertIncludes(wxtConfig, '__MSG_extension_name__', 'manifest config must use localized name');
assertIncludes(wxtConfig, '__MSG_extension_description__', 'manifest config must use localized description');
assertIncludes(wxtConfig, '__MSG_extension_action_title__', 'manifest config must use localized action title');
assertIncludes(wxtConfig, 'pyodideAssetsPlugin', 'manifest build must bundle Pyodide assets for browser Python sandbox');

for (const permission of ['storage', 'alarms', 'contextMenus', 'nativeMessaging', 'offscreen', 'debugger', 'tabs', 'identity', 'sidePanel']) {
  assertIncludes(privacyPolicy, `\`${permission}\``, `privacy policy must document ${permission}`);
  assertIncludes(submission, `#### \`${permission}\``, `Chrome Web Store submission notes must justify ${permission}`);
}

for (const hostPermission of [
  'https://accounts.google.com/*',
  'https://oauth2.googleapis.com/*',
  'https://www.googleapis.com/*',
  'https://login.microsoftonline.com/*',
  'https://graph.microsoft.com/*',
]) {
  assertIncludes(privacyPolicy, `\`${hostPermission}\``, `privacy policy must document ${hostPermission}`);
  assertIncludes(submission, hostPermission, `Chrome Web Store submission notes must justify ${hostPermission}`);
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
