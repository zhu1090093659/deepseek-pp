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
  bridgeProtocol: 'deepseek-pp-android-bridge',
  bridgeVersion: 1,
  sharedPreferences: 'deepseek_pp_android',
  shimRuntimeId: 'deepseek-pp-android',
  bridgeCommands: [
    'runtime.sendMessage',
    'storage.get',
    'storage.set',
    'storage.remove',
  ],
  storageKeys: [
    'deepseek_pp_locale_preference',
    'deepseek_pp_floating_chat_enabled',
    'deepseek_pp_history_organizer',
  ],
  requiredBundleFiles: [
    'android-bridge-shim.js',
    'content-scripts/main-world.js',
    'content-scripts/content.js',
  ],
  unsupportedRuntimeError: 'android_background_message_unsupported',
} as const;

export const ANDROID_CURRENT_GAPS = [
  {
    name: 'TypeScript and Kotlin capability producers remain duplicated',
    currentBehavior: 'matching-but-separate-capability-maps',
    target: 'single-shared-capability-contract-after-T3.2',
  },
  {
    name: 'Android wrapper version is independent from the extension package version',
    currentBehavior: 'android-0.6.5-extension-1.10.0',
    target: 'declared-source-commit-and-contract-level-before-android-release',
  },
] as const;
