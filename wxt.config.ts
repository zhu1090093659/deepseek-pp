import { defineConfig, type ConfigEnv, type UserManifest } from 'wxt';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { readFileSync } from 'node:fs';

const rootDir = dirname(fileURLToPath(import.meta.url));
const safeWxtBrowser = resolve(rootDir, 'core/browser/safe-wxt-browser.ts');
const CHROMIUM_BROWSERS = new Set(['chrome', 'edge']);
const extensionVersion = readPackageVersion();

function readPackageVersion(): string {
  const packageJson = JSON.parse(
    readFileSync(resolve(rootDir, 'package.json'), 'utf8'),
  ) as { version?: unknown };

  if (typeof packageJson.version !== 'string' || packageJson.version.length === 0) {
    throw new Error('package.json version is required for extension manifest');
  }

  return packageJson.version;
}

function createManifest(env: ConfigEnv): UserManifest {
  const isFirefox = env.browser === 'firefox';
  const isChromiumTarget = CHROMIUM_BROWSERS.has(env.browser);
  const permissions = ['storage', 'alarms', 'nativeMessaging', 'contextMenus'];

  return {
    name: 'DeepSeek++',
    description: 'Agentic memory, skills, agentic execution, automation, and MCP tools for DeepSeek',
    version: extensionVersion,
    permissions: isChromiumTarget ? [...permissions, 'sidePanel'] : permissions,
    optional_host_permissions: ['http://*/*', 'https://*/*'],
    host_permissions: ['*://chat.deepseek.com/*', '*://cn.bing.com/*', '*://www.bing.com/*'],
    content_security_policy: {
      extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'",
    },
    web_accessible_resources: [{
      resources: ['pet/*.png', 'deepseek/*.wasm'],
      matches: ['*://chat.deepseek.com/*'],
    }],
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
