export async function requestGitHubApiPermission(): Promise<boolean> {
  const origins = ['https://api.github.com/*'];
  if (!chrome.permissions?.contains || !chrome.permissions?.request) return true;
  const granted = await chrome.permissions.contains({ origins }).catch(() => false);
  if (granted) return true;
  return chrome.permissions.request({ origins }).catch(() => false);
}
