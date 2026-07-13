export const SHELL_HOST_CONTRACT = {
  nativeHost: 'com.deepseek_pp.shell',
  packageName: 'deepseek-pp-shell-host',
  packageVersion: '1.10.0',
  nodeEngine: '>=18.17',
  firefoxExtensionId: 'deepseek-pp@zhu1090093659.github',
  browsers: ['chrome', 'chromium', 'edge', 'firefox'],
  commands: ['install', 'status', 'uninstall'],
  initializedServer: { name: 'deepseek-pp-shell', version: '1.0.0' },
  instructions: 'General-purpose shell execution host. Use shell_exec for local commands and python_exec only for short computation or validation snippets.',
} as const;

export const INSTALLER_LOCATION_FIXTURES = [
  {
    name: 'macOS Chrome',
    input: { os: 'darwin', browser: 'chrome', home: '/Users/contract', localAppData: undefined },
    output: {
      appDataRoot: '/Users/contract/Library/Application Support/DeepSeek++',
      hostInstallDir: '/Users/contract/Library/Application Support/DeepSeek++/NativeHost',
      manifestDir: '/Users/contract/Library/Application Support/Google/Chrome/NativeMessagingHosts',
      manifestPath: '/Users/contract/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.deepseek_pp.shell.json',
      registryKey: null,
    },
  },
  {
    name: 'macOS Firefox',
    input: { os: 'darwin', browser: 'firefox', home: '/Users/contract', localAppData: undefined },
    output: {
      appDataRoot: '/Users/contract/Library/Application Support/DeepSeek++',
      hostInstallDir: '/Users/contract/Library/Application Support/DeepSeek++/NativeHost',
      manifestDir: '/Users/contract/Library/Application Support/Mozilla/NativeMessagingHosts',
      manifestPath: '/Users/contract/Library/Application Support/Mozilla/NativeMessagingHosts/com.deepseek_pp.shell.json',
      registryKey: null,
    },
  },
  {
    name: 'Linux Edge',
    input: { os: 'linux', browser: 'edge', home: '/home/contract', localAppData: undefined },
    output: {
      appDataRoot: '/home/contract/.local/share/deepseek-pp',
      hostInstallDir: '/home/contract/.local/share/deepseek-pp/native-host',
      manifestDir: '/home/contract/.config/microsoft-edge/NativeMessagingHosts',
      manifestPath: '/home/contract/.config/microsoft-edge/NativeMessagingHosts/com.deepseek_pp.shell.json',
      registryKey: null,
    },
  },
  {
    name: 'Linux Chromium',
    input: { os: 'linux', browser: 'chromium', home: '/home/contract', localAppData: undefined },
    output: {
      appDataRoot: '/home/contract/.local/share/deepseek-pp',
      hostInstallDir: '/home/contract/.local/share/deepseek-pp/native-host',
      manifestDir: '/home/contract/.config/chromium/NativeMessagingHosts',
      manifestPath: '/home/contract/.config/chromium/NativeMessagingHosts/com.deepseek_pp.shell.json',
      registryKey: null,
    },
  },
  {
    name: 'Windows Chrome',
    input: {
      os: 'win32',
      browser: 'chrome',
      home: 'C:\\Users\\contract',
      localAppData: 'C:\\Users\\contract\\AppData\\Local',
    },
    output: {
      appDataRoot: 'C:\\Users\\contract\\AppData\\Local\\DeepSeek++',
      hostInstallDir: 'C:\\Users\\contract\\AppData\\Local\\DeepSeek++\\NativeHost',
      manifestDir: 'C:\\Users\\contract\\AppData\\Local\\DeepSeek++\\NativeMessagingHosts',
      manifestPath: 'C:\\Users\\contract\\AppData\\Local\\DeepSeek++\\NativeMessagingHosts\\com.deepseek_pp.shell.json',
      registryKey: 'HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\com.deepseek_pp.shell',
    },
  },
  {
    name: 'Windows Firefox',
    input: {
      os: 'win32',
      browser: 'firefox',
      home: 'C:\\Users\\contract',
      localAppData: 'C:\\Users\\contract\\AppData\\Local',
    },
    output: {
      appDataRoot: 'C:\\Users\\contract\\AppData\\Local\\DeepSeek++',
      hostInstallDir: 'C:\\Users\\contract\\AppData\\Local\\DeepSeek++\\NativeHost',
      manifestDir: 'C:\\Users\\contract\\AppData\\Local\\DeepSeek++\\NativeMessagingHosts',
      manifestPath: 'C:\\Users\\contract\\AppData\\Local\\DeepSeek++\\NativeMessagingHosts\\com.deepseek_pp.shell.json',
      registryKey: null,
    },
  },
] as const;

export const INSTALLER_CURRENT_GAPS = [
  {
    name: 'Shell initialize reports 1.0.0 while the npm package reports 1.10.0',
    target: 'single-host-version-source-after-T4.5',
  },
  {
    name: 'OfficeCLI installation occurs after host files and manifest are committed',
    target: 'explicit-install-journal-or-partial-state-after-T4.5',
  },
  {
    name: 'missing checksum metadata permits installation to continue',
    target: 'fail-closed-checksum-policy-after-T4.5',
  },
  {
    name: 'Windows registry failure is warning-only and status does not verify the registered value',
    target: 'observable-registry-health-after-T5.1',
  },
] as const;
