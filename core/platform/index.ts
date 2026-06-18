export type {
  PlatformCapability,
  PlatformCapabilityMap,
  PlatformDownload,
  PlatformEnvironment,
  PlatformFilePicker,
  PlatformKind,
  PlatformPickedFile,
  PlatformRuntime,
  PlatformServices,
  PlatformStorage,
} from './capabilities';

export {
  EMPTY_PLATFORM_CAPABILITIES,
  createCapabilityMap,
  getCurrentBrowserExtensionEnvironment,
  getCurrentPlatformEnvironment,
  getElectronDesktopEnvironment,
  isCapabilitySupported,
} from './capabilities';

export {
  createBrowserExtensionPlatformServices,
} from './browser';

export {
  getSupportedMcpTransportKinds,
  isShellNativeHostSupported,
} from './gating';
