declare const __RAW_EXTENSION_VERSION__: string;

export function getExtensionVersion(): string {
  return typeof __RAW_EXTENSION_VERSION__ === 'string'
    ? __RAW_EXTENSION_VERSION__
    : chrome.runtime.getManifest().version;
}
