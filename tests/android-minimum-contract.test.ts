import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ANDROID_CURRENT_GAPS,
  ANDROID_MINIMUM_CONTRACT,
} from './fixtures/external-runtime/android';

const root = process.cwd();
const gradle = read('android/app/build.gradle.kts');
const manifest = read('android/app/src/main/AndroidManifest.xml');
const activity = read('android/app/src/main/java/com/deepseekpp/android/MainActivity.kt');
const bridge = read('android/app/src/main/java/com/deepseekpp/android/DeepSeekPlusPlusBridge.kt');
const shim = read('android/web/android-bridge-shim.js');
const staging = read('scripts/copy-to-android-assets.mjs');
const readme = read('android/README.md');

describe('Android minimum shared/security contract', () => {
  it('freezes package, SDK, independent version, and HTTPS DeepSeek intent identity', () => {
    expect(gradle).toContain(`namespace = "${ANDROID_MINIMUM_CONTRACT.packageName}"`);
    expect(gradle).toContain(`applicationId = "${ANDROID_MINIMUM_CONTRACT.packageName}"`);
    expect(gradle).toContain(`compileSdk = ${ANDROID_MINIMUM_CONTRACT.compileSdk}`);
    expect(gradle).toContain(`minSdk = ${ANDROID_MINIMUM_CONTRACT.minSdk}`);
    expect(gradle).toContain(`targetSdk = ${ANDROID_MINIMUM_CONTRACT.targetSdk}`);
    expect(gradle).toContain(`versionCode = ${ANDROID_MINIMUM_CONTRACT.versionCode}`);
    expect(gradle).toContain(`versionName = "${ANDROID_MINIMUM_CONTRACT.versionName}"`);
    expect(manifest).toContain('android:usesCleartextTraffic="false"');
    expect(manifest).toContain(`android:scheme="${ANDROID_MINIMUM_CONTRACT.trustedScheme}"`);
    expect(manifest).toContain(`android:host="${ANDROID_MINIMUM_CONTRACT.trustedHost}"`);
  });

  it('freezes the minimal bridge identity, storage namespace, and explicit unsupported result', () => {
    expect(activity).toContain(`addJavascriptInterface(bridge, "${ANDROID_MINIMUM_CONTRACT.bridgeName}")`);
    expect(activity).toContain(`removeJavascriptInterface("${ANDROID_MINIMUM_CONTRACT.bridgeName}")`);
    expect(bridge).toContain(`getSharedPreferences("${ANDROID_MINIMUM_CONTRACT.sharedPreferences}"`);
    expect(bridge).toContain(`.put("error", "${ANDROID_MINIMUM_CONTRACT.unsupportedRuntimeError}")`);
    expect(shim).toContain(`id: "${ANDROID_MINIMUM_CONTRACT.shimRuntimeId}"`);
    expect(shim).toContain('window.chrome.runtime = window.chrome.runtime || runtime');
    expect(shim).toContain('window.chrome.storage = window.chrome.storage || storage');
    expect(shim).not.toContain('connectNative');
  });

  it('requires shim, MAIN, and content bundles before Android asset staging mutates output', () => {
    expect(staging.indexOf('const requiredBuildFiles')).toBeGreaterThanOrEqual(0);
    expect(staging.indexOf('for (const file of requiredBuildFiles)'))
      .toBeLessThan(staging.indexOf('await rm(androidAssetDir'));
    for (const file of ANDROID_MINIMUM_CONTRACT.requiredBundleFiles.slice(1)) {
      expect(staging).toContain(`'${file}'`);
    }
    expect(staging).toContain('Missing android/web/android-bridge-shim.js.');
  });

  it('keeps Android explicitly outside browser feature-parity scope', () => {
    for (const unsupported of [
      'Browser side panel APIs.',
      'Native Messaging and Shell Native Host.',
      'Browser context menus.',
      'Background alarms.',
    ]) {
      expect(readme).toContain(unsupported);
    }
    expect(readme).toContain('capability validation, not a replacement for the browser extension store packages');
  });

  it('records origin-prefix, generic bridge, capability double truth, and version drift as gaps', () => {
    expect(activity.match(/startsWith\(DEEPSEEK_ORIGIN\)/g)?.length).toBe(4);
    expect(bridge).toContain('fun getStorage(key: String?)');
    expect(bridge).toContain('fun setStorage(key: String?, value: String?)');
    expect(bridge).toContain('.put("filePicker", false)');
    expect(bridge).toContain('.put("folderPicker", false)');
    expect(ANDROID_CURRENT_GAPS.map((gap) => gap.target)).toEqual([
      'parsed-scheme-host-port-policy-after-T2.3',
      'structured-allowlisted-bridge-after-T2.3',
      'single-shared-capability-contract-after-T3.2',
      'declared-source-commit-and-contract-level-before-android-release',
    ]);
  });
});

function read(path: string): string {
  return readFileSync(resolve(root, path), 'utf8');
}
