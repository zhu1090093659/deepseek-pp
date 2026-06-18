import { readOptionalChromeApi } from './chrome-api';

export type PlatformKind = 'browser_extension' | 'android_webview' | 'electron_desktop' | 'unknown';

export type PlatformCapability =
  | 'storage'
  | 'runtimeMessaging'
  | 'downloads'
  | 'filePicker'
  | 'folderPicker'
  | 'assetUrl'
  | 'sidePanel'
  | 'nativeMessaging'
  | 'contextMenus'
  | 'alarms'
  | 'tabs'
  | 'tabGroups'
  | 'debugger'
  | 'browserControl'
  | 'accessibilityTree';

export type PlatformCapabilityMap = Record<PlatformCapability, boolean>;

export interface PlatformEnvironment {
  kind: PlatformKind;
  name: string;
  capabilities: PlatformCapabilityMap;
}

export interface PlatformStorage {
  get<T = unknown>(key: string): Promise<T | null>;
  set<T = unknown>(key: string, value: T): Promise<void>;
  remove(key: string): Promise<void>;
}

export interface PlatformRuntime {
  sendMessage<T = unknown>(message: unknown): Promise<T>;
}

export interface PlatformDownload {
  download(input: {
    filename: string;
    mimeType: string;
    content: string;
  }): Promise<void>;
}

export interface PlatformFilePicker {
  pickFiles(options?: { multiple?: boolean; accept?: string[] }): Promise<PlatformPickedFile[]>;
  pickFolder?(): Promise<PlatformPickedFile[]>;
}

export interface PlatformPickedFile {
  name: string;
  path: string;
  content: string;
  sizeBytes: number;
}

export interface PlatformServices {
  environment: PlatformEnvironment;
  storage: PlatformStorage;
  runtime: PlatformRuntime;
  download?: PlatformDownload;
  filePicker?: PlatformFilePicker;
  getAssetUrl(path: string): string;
}

export const EMPTY_PLATFORM_CAPABILITIES: PlatformCapabilityMap = {
  storage: false,
  runtimeMessaging: false,
  downloads: false,
  filePicker: false,
  folderPicker: false,
  assetUrl: false,
  sidePanel: false,
  nativeMessaging: false,
  contextMenus: false,
  alarms: false,
  tabs: false,
  tabGroups: false,
  debugger: false,
  browserControl: false,
  accessibilityTree: false,
};

export function createCapabilityMap(
  capabilities: Partial<PlatformCapabilityMap>,
): PlatformCapabilityMap {
  return { ...EMPTY_PLATFORM_CAPABILITIES, ...capabilities };
}

export function isCapabilitySupported(
  environment: PlatformEnvironment,
  capability: PlatformCapability,
): boolean {
  return environment.capabilities[capability] === true;
}

export function getCurrentBrowserExtensionEnvironment(): PlatformEnvironment {
  const runtime = safeChromeRuntime();
  const chromeApi = safeChrome();
  const debuggerSupported = Boolean(
    readOptionalChromeApi(() => chromeApi?.debugger?.attach) &&
    readOptionalChromeApi(() => chromeApi?.debugger?.sendCommand),
  );
  const tabsSupported = Boolean(
    readOptionalChromeApi(() => chromeApi?.tabs?.query) &&
    readOptionalChromeApi(() => chromeApi?.tabs?.get),
  );
  const tabGroupsSupported = Boolean(readOptionalChromeApi(() => chromeApi?.tabGroups?.query));
  return {
    kind: 'browser_extension',
    name: 'WebExtension',
    capabilities: createCapabilityMap({
      storage: Boolean(readOptionalChromeApi(() => chromeApi?.storage?.local)),
      runtimeMessaging: Boolean(readOptionalChromeApi(() => runtime?.sendMessage)),
      downloads: Boolean(readOptionalChromeApi(() => chromeApi?.downloads?.download)),
      filePicker: typeof document !== 'undefined',
      folderPicker: typeof document !== 'undefined',
      assetUrl: Boolean(readOptionalChromeApi(() => runtime?.getURL)),
      sidePanel: Boolean(readOptionalChromeApi(() => chromeApi?.sidePanel)),
      nativeMessaging: Boolean(
        readOptionalChromeApi(() => runtime?.connectNative) ||
        readOptionalChromeApi(() => runtime?.sendNativeMessage),
      ),
      contextMenus: Boolean(readOptionalChromeApi(() => chromeApi?.contextMenus)),
      alarms: Boolean(readOptionalChromeApi(() => chromeApi?.alarms)),
      tabs: tabsSupported,
      tabGroups: tabGroupsSupported,
      debugger: debuggerSupported,
      browserControl: debuggerSupported && tabsSupported,
      accessibilityTree: debuggerSupported,
    }),
  };
}

// The Electron desktop shell sets this marker on `window` from its preload
// scripts (see desktop/). Detected before the Android/extension checks so the
// host advertises its richer, Node-backed capability set.
export function getElectronDesktopEnvironment(): PlatformEnvironment {
  return {
    kind: 'electron_desktop',
    name: 'Electron Desktop',
    capabilities: createCapabilityMap({
      storage: true,
      runtimeMessaging: true,
      downloads: true,
      filePicker: true,
      folderPicker: true,
      assetUrl: true,
      // Backed by child_process in the Electron main process (shell host / MCP).
      nativeMessaging: true,
      // AI-controlled tabs are Electron windows; CDP is webContents.debugger.
      tabs: true,
      debugger: true,
      browserControl: true,
      accessibilityTree: true,
      // Timers in the persistent (never-throttled) background window — unlike an
      // MV3 service worker, it is not torn down, so the scheduler keeps running.
      alarms: true,
      // Phase 2c remaining: contextMenus (Electron Menu), sidePanel.
    }),
  };
}

function hasDesktopBridgeMarker(): boolean {
  try {
    return typeof window !== 'undefined' &&
      (window as typeof window & { __DPP_DESKTOP__?: unknown }).__DPP_DESKTOP__ === true;
  } catch {
    return false;
  }
}

export function getCurrentPlatformEnvironment(): PlatformEnvironment {
  if (hasDesktopBridgeMarker()) return getElectronDesktopEnvironment();

  const androidBridge = typeof window !== 'undefined'
    ? (window as typeof window & { AndroidBridge?: unknown }).AndroidBridge
    : undefined;
  if (androidBridge) {
    return {
      kind: 'android_webview',
      name: 'Android WebView',
      capabilities: createCapabilityMap({
        storage: true,
        runtimeMessaging: true,
        downloads: true,
        filePicker: true,
        folderPicker: true,
        assetUrl: true,
        sidePanel: false,
        nativeMessaging: false,
        contextMenus: false,
        alarms: false,
        tabs: false,
        tabGroups: false,
        debugger: false,
        browserControl: false,
        accessibilityTree: false,
      }),
    };
  }
  if (safeChromeRuntime()) return getCurrentBrowserExtensionEnvironment();
  return {
    kind: 'unknown',
    name: 'Unknown',
    capabilities: createCapabilityMap({}),
  };
}

function safeChrome(): typeof chrome | null {
  try {
    return typeof chrome !== 'undefined' ? chrome : null;
  } catch {
    return null;
  }
}

function safeChromeRuntime(): typeof chrome.runtime | null {
  try {
    return typeof chrome !== 'undefined' && chrome.runtime ? chrome.runtime : null;
  } catch {
    return null;
  }
}
