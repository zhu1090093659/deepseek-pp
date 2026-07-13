export const HOST_NAME: string;
export const FIREFOX_EXTENSION_ID: string;
export const SUPPORTED_BROWSER_NAMES: string[];

export interface InstallerArgs {
  command: string;
  extensionId: string | null;
  browser: string;
  skipOfficecli: boolean;
  forceOfficecli: boolean;
  logFile: string | null;
}

export interface NativeHostLocations {
  appDataRoot: string;
  hostInstallDir: string;
  manifestDir: string;
  manifestPath: string;
  registryKey: string | null;
}

export function parseArgs(argv: string[]): InstallerArgs;
export function resolveNativeHostLocations(input: {
  os: string;
  browser: string;
  home: string;
  localAppData?: string;
}): NativeHostLocations;
export function createNativeHostManifest(
  args: Pick<InstallerArgs, 'browser' | 'extensionId'>,
  wrapperPath: string,
): Record<string, unknown>;
