export function getExtensionVersion(): string {
  return chrome.runtime.getManifest().version;
}
