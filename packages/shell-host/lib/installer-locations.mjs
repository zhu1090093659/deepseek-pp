import { homedir, platform } from 'node:os';
import { posix, resolve, win32 } from 'node:path';

export const HOST_NAME = 'com.deepseek_pp.shell';
export const FIREFOX_EXTENSION_ID = 'deepseek-pp@zhu1090093659.github';
export const SUPPORTED_BROWSER_NAMES = ['chrome', 'chromium', 'edge', 'firefox'];

const SUPPORTED_BROWSERS = new Set(SUPPORTED_BROWSER_NAMES);

export function assertSupportedBrowser(browser) {
  if (!SUPPORTED_BROWSERS.has(browser)) throw new Error(`Unsupported browser: ${browser}`);
}

export function resolveNativeHostLocations({ os, browser, home, localAppData }) {
  assertSupportedBrowser(browser);
  const path = os === 'win32' ? win32 : posix;
  let appDataRoot;
  let manifestDir;

  if (os === 'darwin') {
    appDataRoot = path.resolve(home, 'Library', 'Application Support', 'DeepSeek++');
    const manifestSegments = {
      chrome: ['Google', 'Chrome', 'NativeMessagingHosts'],
      chromium: ['Chromium', 'NativeMessagingHosts'],
      edge: ['Microsoft Edge', 'NativeMessagingHosts'],
      firefox: ['Mozilla', 'NativeMessagingHosts'],
    }[browser];
    manifestDir = path.resolve(home, 'Library', 'Application Support', ...manifestSegments);
  } else if (os === 'linux') {
    appDataRoot = path.resolve(home, '.local', 'share', 'deepseek-pp');
    const manifestSegments = {
      chrome: ['.config', 'google-chrome', 'NativeMessagingHosts'],
      chromium: ['.config', 'chromium', 'NativeMessagingHosts'],
      edge: ['.config', 'microsoft-edge', 'NativeMessagingHosts'],
      firefox: ['.mozilla', 'native-messaging-hosts'],
    }[browser];
    manifestDir = path.resolve(home, ...manifestSegments);
  } else if (os === 'win32') {
    const appData = localAppData || path.resolve(home, 'AppData', 'Local');
    appDataRoot = path.resolve(appData, 'DeepSeek++');
    manifestDir = path.resolve(appDataRoot, 'NativeMessagingHosts');
  } else {
    throw new Error(`Unsupported platform: ${os}`);
  }

  const hostInstallDir = path.resolve(appDataRoot, os === 'linux' ? 'native-host' : 'NativeHost');
  return {
    appDataRoot,
    hostInstallDir,
    manifestDir,
    manifestPath: path.resolve(manifestDir, `${HOST_NAME}.json`),
    registryKey: os === 'win32' ? getWindowsRegistryKey(browser) : null,
  };
}

export function getCurrentNativeHostLocations(browser = 'chrome') {
  return resolveNativeHostLocations({
    os: platform(),
    browser,
    home: homedir(),
    localAppData: process.env.LOCALAPPDATA,
  });
}

export function getHostInstallDir() {
  return getCurrentNativeHostLocations().hostInstallDir;
}

export function getManifestPath(browser) {
  return getCurrentNativeHostLocations(browser).manifestPath;
}

export function getRegistryKey(browser) {
  return getCurrentNativeHostLocations(browser).registryKey;
}

export function createNativeHostManifest(args, wrapperPath) {
  const manifest = {
    name: HOST_NAME,
    description: 'DeepSeek++ Shell MCP - General purpose shell execution via Native Messaging',
    path: wrapperPath,
    type: 'stdio',
  };
  if (args.browser === 'firefox') {
    manifest.allowed_extensions = [FIREFOX_EXTENSION_ID];
  } else {
    if (!args.extensionId) throw new Error('--extension-id is required for Chrome/Edge/Chromium.');
    manifest.allowed_origins = [`chrome-extension://${args.extensionId}/`];
  }
  return manifest;
}

function getWindowsRegistryKey(browser) {
  switch (browser) {
    case 'chrome': return `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${HOST_NAME}`;
    case 'edge': return `HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts\\${HOST_NAME}`;
    case 'chromium': return `HKCU\\Software\\Chromium\\NativeMessagingHosts\\${HOST_NAME}`;
    default: return null;
  }
}
