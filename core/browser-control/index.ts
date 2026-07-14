export {
  browserControlService,
  createBrowserControlToolDescriptors,
  executeBrowserControlToolCall,
  getBrowserControlState,
  isBrowserControlToolName,
} from './tool';

export {
  DEFAULT_BROWSER_CONTROL_SETTINGS,
  getBrowserControlSettings,
  normalizeBrowserControlSettings,
  saveBrowserControlSettings,
  setBrowserControlEnabled,
} from './settings';

export {
  decodeBrowserControlSettings,
  decodeBrowserControlState,
  decodeBrowserControlTarget,
} from './codec';

export type {
  BrowserActionResult,
  BrowserControlSettings,
  BrowserControlState,
  BrowserControlTarget,
  BrowserControlToolName,
  BrowserSnapshotNode,
  BrowserSnapshotResult,
} from './types';
