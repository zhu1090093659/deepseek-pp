export type {
  PlatformCapability,
  PlatformCapabilityMap,
  PlatformEnvironment,
  PlatformKind,
} from './capabilities';

export {
  EMPTY_PLATFORM_CAPABILITIES,
  createCapabilityMap,
  getCurrentPlatformEnvironment,
  isCapabilitySupported,
} from './capabilities';

export {
  getSupportedMcpTransportKinds,
  isShellNativeHostSupported,
} from './gating';
