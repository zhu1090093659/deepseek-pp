import { defineConfig, type ConfigEnv, type UserManifest } from 'wxt';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const rootDir = dirname(fileURLToPath(import.meta.url));
const safeWxtBrowser = resolve(rootDir, 'core/browser/safe-wxt-browser.ts');
const CHROMIUM_BROWSERS = new Set(['chrome', 'edge']);

function createManifest(env: ConfigEnv): UserManifest {
  const isFirefox = env.browser === 'firefox';
  const isChromiumTarget = CHROMIUM_BROWSERS.has(env.browser);
  const permissions = ['storage', 'alarms', 'nativeMessaging'];

  return {
    name: 'DeepSeek++',
    description: 'Agentic memory, skill, automation, and MCP tools for DeepSeek',
    version: '0.2.0',
    permissions: isChromiumTarget ? [...permissions, 'sidePanel'] : permissions,
    optional_host_permissions: ['http://*/*', 'https://*/*'],
    host_permissions: ['*://chat.deepseek.com/*'],
    ...(isChromiumTarget ? {
      action: {
        default_title: 'DeepSeek++',
      },
      side_panel: {
        default_path: 'sidepanel.html',
      },
    } : {}),
    ...(isFirefox ? {
      browser_specific_settings: {
        gecko: {
          id: 'deepseek-pp@zhu1090093659.github',
          data_collection_permissions: {
            required: ['websiteContent', 'personalCommunications'],
          },
        },
      },
    } : {}),
  };
}

export default defineConfig({
  outDir: 'dist',
  targetBrowsers: ['chrome', 'edge', 'firefox'],
  modules: ['@wxt-dev/module-react'],
  manifest: createManifest,
  vite: () => ({
    plugins: [tailwindcss()],
    resolve: {
      alias: {
        '@wxt-dev/browser': safeWxtBrowser,
        'wxt/browser': safeWxtBrowser,
      },
    },
  }),
});
