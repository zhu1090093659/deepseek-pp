import { readOptionalChromeApi } from './chrome-api';

export type PlatformKind = 'browser_extension' | 'unknown';

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

export function getCurrentPlatformEnvironment(): PlatformEnvironment {
  const chromeApi = readChromeApi();
  const runtime = readOptionalChromeApi(() => chromeApi?.runtime) ?? null;
  if (!runtime) {
    return {
      kind: 'unknown',
      name: 'Unknown',
      capabilities: createCapabilityMap({}),
    };
  }

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

function readChromeApi(): typeof chrome | null {
  return readOptionalChromeApi(
    () => typeof chrome !== 'undefined' ? chrome : null,
  ) ?? null;
}
