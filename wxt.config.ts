import { defineConfig, type ConfigEnv, type UserManifest } from 'wxt';
import tailwindcss from '@tailwindcss/vite';
import type { Plugin } from 'vite';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  copyFileSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import pyodidePackagePolicy from './scripts/pyodide-package-policy.json';

const rootDir = dirname(fileURLToPath(import.meta.url));
const safeWxtBrowser = resolve(rootDir, 'core/browser/safe-wxt-browser.ts');
const CHROMIUM_BROWSERS = new Set(['chrome', 'edge']);
const extensionVersion = readPackageVersion();
const MANIFEST_NAME = '__MSG_extension_name__';
const MANIFEST_DESCRIPTION = '__MSG_extension_description__';
const MANIFEST_ACTION_TITLE = '__MSG_extension_action_title__';
const SANDBOX_CSP = [
  'sandbox allow-scripts',
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' blob:",
  'worker-src blob:',
  "child-src 'self' blob: data:",
  "frame-src 'self' blob: data:",
  "connect-src 'self' blob:",
  "object-src 'none'",
].join('; ');
const PYODIDE_ASSET_FILES = pyodidePackagePolicy.assets.map(({ file }) => file);

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
  // identity: required for chrome.identity.launchWebAuthFlow (Google Drive / OneDrive OAuth).
  // The providers' fixed API hosts are declared as required host_permissions below
  // so the background service worker can fetch them without a runtime permission
  // request; WebDAV URLs are arbitrary and stay in optional_host_permissions.
  const chromiumPermissions = [...permissions, 'offscreen', 'debugger', 'tabs', 'identity'];

  return {
    default_locale: 'en',
    name: MANIFEST_NAME,
    description: MANIFEST_DESCRIPTION,
    version: extensionVersion,
    permissions: isChromiumTarget ? [...chromiumPermissions, 'sidePanel'] : permissions,
    optional_host_permissions: ['http://*/*', 'https://*/*'],
    host_permissions: [
      // DeepSeek + Bing: core extension hosts.
      '*://chat.deepseek.com/*',
      'https://api.deepseek.com/*',
      '*://cn.bing.com/*',
      '*://www.bing.com/*',
      // Cloud sync OAuth providers — required (not optional) because their API
      // hosts are fixed and the background service worker's fetch to these hosts
      // needs host permission to bypass CORS. Declaring them as required avoids a
      // runtime permission-request round-trip on every sync operation.
      'https://accounts.google.com/*',
      'https://oauth2.googleapis.com/*',
      'https://www.googleapis.com/*',
      'https://login.microsoftonline.com/*',
      'https://graph.microsoft.com/*',
    ],
    content_security_policy: {
      extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'",
      sandbox: SANDBOX_CSP,
    },
    sandbox: {
      pages: ['sandbox-runner.html'],
    },
    web_accessible_resources: [
      // Pet sprites + DeepSeek WASM stay scoped to the DeepSeek host.
      {
        resources: ['pet/*.png', 'deepseek/*.wasm'],
        matches: ['*://chat.deepseek.com/*'],
      },
      // sidepanel.html must be web-accessible on every host because the global
      // floating-chat ball embeds it in an iframe from any page. The whale
      // sprite is bundled with the button itself.
      {
        resources: ['sidepanel.html', 'pet/deepseek-whale-pet-states.png'],
        matches: ['<all_urls>'],
      },
    ],
    ...(isChromiumTarget ? {
      action: {
        default_title: MANIFEST_ACTION_TITLE,
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

function asciiJavaScriptOutputPlugin(): Plugin {
  return {
    name: 'deepseek-pp-ascii-js-output',
    enforce: 'post',
    generateBundle(_, bundle) {
      for (const item of Object.values(bundle)) {
        if (item.type === 'chunk') {
          item.code = escapeNonAsciiJavaScript(item.code);
          continue;
        }

        if (!item.fileName.endsWith('.js')) continue;
        const source = typeof item.source === 'string'
          ? item.source
          : Buffer.from(item.source).toString('utf8');
        item.source = escapeNonAsciiJavaScript(source);
      }
    },
  };
}

function copyPyodideAssets(
  outputDir: string,
  publicAssets: Array<{ type: 'asset'; fileName: string }>,
): void {
  const sourceDir = resolve(rootDir, 'node_modules/pyodide');
  const targetDir = resolve(outputDir, 'pyodide');
  mkdirSync(targetDir, { recursive: true });

  for (const file of PYODIDE_ASSET_FILES) {
    const fileName = `pyodide/${file}`;
    copyFileSync(resolve(sourceDir, file), resolve(outputDir, fileName));
    publicAssets.push({ type: 'asset', fileName });
  }
}

function copyBundledSkillAssets(
  outputDir: string,
  publicAssets: Array<{ type: 'asset'; fileName: string }>,
): void {
  const sources = [
    {
      group: 'officecli',
      directory: resolve(rootDir, 'core/skill/officecli-official'),
      include: (path: string) => (
        /^skills\/[^/]+\/SKILL\.md$/.test(path)
        || path === 'styles/INDEX.md'
      ),
    },
    {
      group: 'spec-driven-develop',
      directory: resolve(rootDir, 'core/skill/spec-driven-develop-official'),
      include: (path: string) => /\.(?:md|py|sh|js)$/.test(path),
    },
  ] as const;
  const groups: Record<string, string[]> = {};

  for (const { group, directory, include } of sources) {
    const paths = collectAssetPaths(directory, include);
    groups[group] = paths;
    for (const path of paths) {
      const fileName = `bundled-skills/${group}/${path}`;
      const target = resolve(outputDir, fileName);
      mkdirSync(dirname(target), { recursive: true });
      copyFileSync(resolve(directory, path), target);
      publicAssets.push({ type: 'asset', fileName });
    }
  }

  const manifestFileName = 'bundled-skills/manifest.json';
  const manifestPath = resolve(outputDir, manifestFileName);
  mkdirSync(dirname(manifestPath), { recursive: true });
  writeFileSync(manifestPath, `${JSON.stringify({ schemaVersion: 1, groups }, null, 2)}\n`);
  publicAssets.push({ type: 'asset', fileName: manifestFileName });
}

function collectAssetPaths(
  directory: string,
  include: (relativePath: string) => boolean,
  prefix = '',
): string[] {
  const paths: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      paths.push(...collectAssetPaths(resolve(directory, entry.name), include, relativePath));
    } else if (entry.isFile() && include(relativePath)) {
      paths.push(relativePath);
    }
  }
  return paths.sort((left, right) => left.localeCompare(right));
}

function escapeNonAsciiJavaScript(source: string): string {
  let escaped = '';
  for (const char of source) {
    const codePoint = char.codePointAt(0);
    if (codePoint === undefined || codePoint <= 0x7f) {
      escaped += char;
      continue;
    }
    escaped += codePoint <= 0xffff
      ? `\\u${codePoint.toString(16).padStart(4, '0')}`
      : toSurrogatePairEscape(codePoint);
  }
  return escaped;
}

function toSurrogatePairEscape(codePoint: number): string {
  const value = codePoint - 0x10000;
  const high = 0xd800 + (value >> 10);
  const low = 0xdc00 + (value & 0x3ff);
  return `\\u${high.toString(16).padStart(4, '0')}\\u${low.toString(16).padStart(4, '0')}`;
}

export default defineConfig({
  outDir: 'dist',
  targetBrowsers: ['chrome', 'edge', 'firefox'],
  modules: ['@wxt-dev/module-react'],
  manifest: createManifest,
  hooks: {
    'build:done'(wxt, output) {
      copyBundledSkillAssets(wxt.config.outDir, output.publicAssets);
      copyPyodideAssets(wxt.config.outDir, output.publicAssets);
    },
  },
  vite: () => ({
    plugins: [tailwindcss(), asciiJavaScriptOutputPlugin()],
    resolve: {
      alias: {
        '@wxt-dev/browser': safeWxtBrowser,
        'wxt/browser': safeWxtBrowser,
      },
    },
  }),
});
