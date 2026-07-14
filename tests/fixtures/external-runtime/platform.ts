export const PLATFORM_CAPABILITY_KEYS = [
  'storage',
  'runtimeMessaging',
  'downloads',
  'filePicker',
  'folderPicker',
  'assetUrl',
  'sidePanel',
  'nativeMessaging',
  'contextMenus',
  'alarms',
  'tabs',
  'tabGroups',
  'debugger',
  'browserControl',
  'accessibilityTree',
] as const;

export const PLATFORM_PROFILE_FIXTURES = {
  chromium: {
    supported: PLATFORM_CAPABILITY_KEYS,
    unsupported: [],
  },
  firefox: {
    supported: ['storage', 'runtimeMessaging', 'assetUrl', 'nativeMessaging', 'contextMenus', 'alarms'],
    unsupported: ['downloads', 'filePicker', 'folderPicker', 'sidePanel', 'tabs', 'tabGroups', 'debugger', 'browserControl', 'accessibilityTree'],
  },
} as const;

export const PLATFORM_CURRENT_GAPS = [
  {
    name: 'downloads is probed even though no generated manifest declares the downloads permission',
    currentBehavior: 'api-presence-can-report-supported',
    target: 'consumer-owned-download-contract-in-R4.7',
  },
  {
    name: 'identity is a Chromium manifest permission but is absent from the capability map',
    currentBehavior: 'no-identity-capability-key',
    target: 'consumer-owned-sync-capability-contract-in-R4.11',
  },
  {
    name: 'missing environment temporarily reports Shell Native Host support',
    currentBehavior: 'legacy-null-environment-means-supported',
    target: 'loaded-explicit-capability-state-in-R4.9',
  },
] as const;
