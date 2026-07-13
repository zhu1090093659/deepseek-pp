import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ANDROID_CURRENT_GAPS,
  ANDROID_MINIMUM_CONTRACT,
} from './fixtures/external-runtime/android';

const root = process.cwd();
const gradle = read('android/app/build.gradle.kts');
const gradleProperties = read('android/gradle.properties');
const manifest = read('android/app/src/main/AndroidManifest.xml');
const activity = read('android/app/src/main/java/com/deepseekpp/android/MainActivity.kt');
const bridge = read('android/app/src/main/java/com/deepseekpp/android/DeepSeekPlusPlusBridge.kt');
const preferenceStore = read('android/app/src/main/java/com/deepseekpp/android/AndroidPreferenceStore.kt');
const bridgeContract = read('android/app/src/main/java/com/deepseekpp/android/AndroidBridgeContract.kt');
const bridgeCodec = read('android/app/src/main/java/com/deepseekpp/android/AndroidBridgeRequestCodec.kt');
const navigationPolicy = read('android/app/src/main/java/com/deepseekpp/android/DeepSeekNavigationPolicy.kt');
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
    expect(gradle).toContain('implementation("androidx.webkit:webkit:1.16.0")');
    expect(gradle).toContain('sourceCompatibility = JavaVersion.VERSION_17');
    expect(gradle).toContain('targetCompatibility = JavaVersion.VERSION_17');
    expect(gradle).toContain('jvmToolchain(17)');
    expect(gradleProperties).toContain('android.useAndroidX=true');
    expect(manifest).toContain('android:usesCleartextTraffic="false"');
    expect(manifest).toContain(`android:scheme="${ANDROID_MINIMUM_CONTRACT.trustedScheme}"`);
    expect(manifest).toContain(`android:host="${ANDROID_MINIMUM_CONTRACT.trustedHost}"`);
  });

  it('freezes the exact-origin WebMessage bridge and structured dispatcher identity', () => {
    expect(activity).toContain('WebViewFeature.WEB_MESSAGE_LISTENER');
    expect(activity).toContain('WebViewCompat.addWebMessageListener(');
    expect(activity).toContain('if (!isMainFrame || !DeepSeekNavigationPolicy.isTrustedOrigin(sourceOrigin.toString()))');
    expect(activity).not.toContain('addJavascriptInterface');
    expect(activity).not.toContain('removeJavascriptInterface');
    expect(bridge).not.toContain('@JavascriptInterface');
    expect(bridge).toContain('fun dispatch(requestJson: String): String');
    expect(preferenceStore).toContain('AndroidBridgeContract.SHARED_PREFERENCES');
    expect(bridge).toContain(`.put("error", "${ANDROID_MINIMUM_CONTRACT.unsupportedRuntimeError}")`);
    expect(bridgeContract).toContain(`const val BRIDGE_NAME = "${ANDROID_MINIMUM_CONTRACT.bridgeName}"`);
    expect(bridgeContract).toContain(`const val PROTOCOL = "${ANDROID_MINIMUM_CONTRACT.bridgeProtocol}"`);
    expect(bridgeContract).toContain(`const val VERSION = ${ANDROID_MINIMUM_CONTRACT.bridgeVersion}`);
    expect(bridgeContract).toContain(`const val SHARED_PREFERENCES = "${ANDROID_MINIMUM_CONTRACT.sharedPreferences}"`);
    for (const command of ANDROID_MINIMUM_CONTRACT.bridgeCommands) {
      expect(bridgeContract).toContain(`"${command}"`);
    }
    expect(bridgeCodec).toContain('request.opt("version") !is Int');
    expect(bridgeCodec).toContain('request.keys().asSequence().toSet() != REQUEST_KEYS');
    for (const key of ANDROID_MINIMUM_CONTRACT.storageKeys) {
      expect(bridgeContract).toContain(`"${key}"`);
    }
    expect(bridgeContract).not.toContain('"deepseekCachedClientHeaders"');
    expect(bridgeContract).not.toContain('"dpp_tool_execution_blocks"');
    expect(bridgeContract).not.toContain('"dpp_inline_agent_traces"');
    expect(shim).toContain(`id: "${ANDROID_MINIMUM_CONTRACT.shimRuntimeId}"`);
    expect(shim).toContain('window.chrome.runtime = window.chrome.runtime || runtime');
    expect(shim).toContain('window.chrome.storage = window.chrome.storage || storage');
    expect(shim).not.toContain('window.chrome.downloads =');
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

  it('parses trusted navigation once and keeps only follow-up capability/version gaps', () => {
    expect(activity).not.toContain('startsWith(');
    expect(navigationPolicy).toContain('URI(value)');
    expect(navigationPolicy).toContain('host == TRUSTED_HOST');
    expect(navigationPolicy).toContain('(port == -1 || port == HTTPS_PORT)');
    expect(bridge).not.toContain('fun getStorage(');
    expect(bridge).not.toContain('fun setStorage(');
    expect(bridge).not.toContain('fun removeStorage(');
    expect(bridge).not.toContain('fun downloadBlob(');
    expect(bridge).toContain('.put("downloads", false)');
    expect(bridge).toContain('.put("filePicker", true)');
    expect(bridge).toContain('.put("folderPicker", false)');
    expect(ANDROID_CURRENT_GAPS.map((gap) => gap.target)).toEqual([
      'single-shared-capability-contract-after-T3.2',
      'declared-source-commit-and-contract-level-before-android-release',
    ]);
  });
});

function read(path: string): string {
  return readFileSync(resolve(root, path), 'utf8');
}
