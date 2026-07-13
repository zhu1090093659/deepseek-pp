export const ANDROID_MINIMUM_CONTRACT = {
  packageName: 'com.deepseekpp.android',
  compileSdk: 35,
  minSdk: 26,
  targetSdk: 35,
  versionCode: 1,
  versionName: '0.6.5',
  trustedScheme: 'https',
  trustedHost: 'chat.deepseek.com',
  bridgeName: 'AndroidBridge',
  sharedPreferences: 'deepseek_pp_android',
  shimRuntimeId: 'deepseek-pp-android',
  requiredBundleFiles: [
    'android-bridge-shim.js',
    'content-scripts/main-world.js',
    'content-scripts/content.js',
  ],
  unsupportedRuntimeError: 'android_background_message_unsupported',
} as const;

export const ANDROID_CURRENT_GAPS = [
  {
    name: 'DeepSeek navigation uses string prefix matching and accepts lookalike hosts',
    currentBehavior: 'startsWith-trusted-origin-string',
    target: 'parsed-scheme-host-port-policy-after-T2.3',
  },
  {
    name: 'JavascriptInterface is attached before navigation and exposes arbitrary storage keys',
    currentBehavior: 'global-bridge-with-generic-storage',
    target: 'structured-allowlisted-bridge-after-T2.3',
  },
  {
    name: 'TypeScript and Kotlin capability producers disagree on picker support',
    currentBehavior: 'typescript-true-kotlin-false',
    target: 'single-shared-capability-contract-after-T3.2',
  },
  {
    name: 'Android wrapper version is independent from the extension package version',
    currentBehavior: 'android-0.6.5-extension-1.10.0',
    target: 'declared-source-commit-and-contract-level-before-android-release',
  },
] as const;
