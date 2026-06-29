#!/usr/bin/env node
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { execSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { homedir, platform } from 'node:os';
import { fileURLToPath } from 'node:url';

export const HOST_NAME = 'com.deepseek_pp.code_index';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(__dirname, '..');
const HOST_SOURCE = resolve(PACKAGE_ROOT, 'native', 'code-index-host.mjs');
const FIREFOX_EXTENSION_ID = 'deepseek-pp@zhu1090093659.github';
const SUPPORTED_BROWSERS = new Set(['chrome', 'chromium', 'edge', 'firefox']);
const COMMANDS = new Set(['install', 'status', 'uninstall']);

function parseArgs(argv) {
  const args = { command: 'install', extensionId: null, browser: 'chrome' };
  const tokens = [...argv];

  if (tokens[0] && COMMANDS.has(tokens[0])) args.command = tokens.shift();
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token === '--extension-id' && tokens[i + 1]) args.extensionId = tokens[++i];
    else if (token === '--browser' && tokens[i + 1]) args.browser = tokens[++i].toLowerCase();
    else if (token === '--help' || token === '-h') { printHelp(); process.exit(0); }
    else throw new Error(`Unknown option: ${token}`);
  }
  if (!SUPPORTED_BROWSERS.has(args.browser)) throw new Error(`Unsupported browser: ${args.browser}`);
  return args;
}

function printHelp() {
  console.log(`DeepSeek++ Code Index Native Host installer

Usage:
  deepseek-pp-code-index install --browser chrome --extension-id <extension-id>
  deepseek-pp-code-index status --browser chrome
  deepseek-pp-code-index uninstall --browser chrome

Commands:
  install              Install the Code Index Native Host
  status               Show manifest and host status
  uninstall            Remove the Code Index Native Host

Options:
  --extension-id <id>  Chrome/Edge/Chromium extension ID
  --browser <name>     Target browser: chrome, chromium, edge, firefox (default: chrome)
  --help               Show this help
`);
}

function getAppDataRoot() {
  const home = homedir();
  if (platform() === 'darwin') return `${home}/Library/Application Support/DeepSeek++`;
  if (platform() === 'linux') return `${home}/.local/share/deepseek-pp`;
  if (platform() === 'win32') {
    const localAppData = process.env.LOCALAPPDATA || resolve(home, 'AppData', 'Local');
    return resolve(localAppData, 'DeepSeek++');
  }
  throw new Error(`Unsupported platform: ${platform()}`);
}

function getHostInstallDir() {
  const root = getAppDataRoot();
  return platform() === 'linux' ? resolve(root, 'code-index-host') : resolve(root, 'CodeIndexHost');
}

function getManifestDir(browser) {
  const os = platform();
  const home = homedir();
  if (os === 'darwin') {
    switch (browser) {
      case 'chrome': return `${home}/Library/Application Support/Google/Chrome/NativeMessagingHosts`;
      case 'chromium': return `${home}/Library/Application Support/Chromium/NativeMessagingHosts`;
      case 'edge': return `${home}/Library/Application Support/Microsoft Edge/NativeMessagingHosts`;
      case 'firefox': return `${home}/Library/Application Support/Mozilla/NativeMessagingHosts`;
    }
  }
  if (os === 'linux') {
    switch (browser) {
      case 'chrome': return `${home}/.config/google-chrome/NativeMessagingHosts`;
      case 'chromium': return `${home}/.config/chromium/NativeMessagingHosts`;
      case 'edge': return `${home}/.config/microsoft-edge/NativeMessagingHosts`;
      case 'firefox': return `${home}/.mozilla/native-messaging-hosts`;
    }
  }
  if (os === 'win32') return resolve(getAppDataRoot(), 'NativeMessagingHosts');
  throw new Error(`Unsupported platform: ${os}`);
}

function getManifestPath(browser) {
  return resolve(getManifestDir(browser), `${HOST_NAME}.json`);
}

function getRegistryKey(browser) {
  switch (browser) {
    case 'chrome': return `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${HOST_NAME}`;
    case 'edge': return `HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts\\${HOST_NAME}`;
    case 'chromium': return `HKCU\\Software\\Chromium\\NativeMessagingHosts\\${HOST_NAME}`;
    default: return null;
  }
}

function buildManifest(args, wrapperPath) {
  const manifest = {
    name: HOST_NAME,
    description: 'DeepSeek++ Code Index MCP - Code search, symbol lookup, and file globbing via Native Messaging',
    path: wrapperPath,
    type: 'stdio',
  };
  if (args.browser === 'firefox') {
    manifest.allowed_extensions = [FIREFOX_EXTENSION_ID];
  } else {
    if (!args.extensionId) throw new Error('--extension-id is required for Chrome/Edge/Chromium.');
    manifest.allowed_origins = [`chrome-extension://${args.extensionId}/`];
  }
  return manifest;
}

function copyHostScript(installDir) {
  const hostPath = resolve(installDir, 'code-index-host.mjs');
  mkdirSync(installDir, { recursive: true });
  copyFileSync(HOST_SOURCE, hostPath);
  if (platform() !== 'win32') chmodSync(hostPath, 0o755);
  return hostPath;
}

function createWrapper(hostPath) {
  const installDir = dirname(hostPath);
  const nodePath = process.execPath;
  if (platform() === 'win32') {
    const wrapperPath = resolve(installDir, 'code-index-host.bat');
    writeFileSync(wrapperPath, `@echo off\r\n"${nodePath}" "${hostPath}" %*\r\n`);
    return wrapperPath;
  }
  const wrapperPath = resolve(installDir, 'code-index-host');
  writeFileSync(wrapperPath, `#!/bin/sh\nexec "${nodePath}" "${hostPath}" "$@"\n`, { mode: 0o755 });
  return wrapperPath;
}

function writeWindowsRegistry(browser, manifestPath) {
  const regKey = getRegistryKey(browser);
  if (!regKey) return;
  try {
    execSync(`reg add "${regKey}" /ve /t REG_SZ /d "${manifestPath}" /f`, { stdio: 'pipe' });
    console.log(`Registry: ${regKey}`);
  } catch {
    console.error('Warning: Failed to write registry key. You may need to run as Administrator.');
    console.error(`  Manual: reg add "${regKey}" /ve /t REG_SZ /d "${manifestPath}" /f`);
  }
}

function removeWindowsRegistry(browser) {
  const regKey = getRegistryKey(browser);
  if (!regKey) return;
  try {
    execSync(`reg delete "${regKey}" /f`, { stdio: 'pipe' });
    console.log(`Removed registry key: ${regKey}`);
  } catch { /* already absent */ }
}

function readManifest(manifestPath) {
  if (!existsSync(manifestPath)) return null;
  return JSON.parse(readFileSync(manifestPath, 'utf8'));
}

function install(args) {
  const manifestPath = getManifestPath(args.browser);
  const manifestDir = dirname(manifestPath);
  const hostPath = copyHostScript(getHostInstallDir());
  const wrapperPath = createWrapper(hostPath);
  const manifest = buildManifest(args, wrapperPath);

  mkdirSync(manifestDir, { recursive: true });
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

  if (platform() === 'win32') writeWindowsRegistry(args.browser, manifestPath);

  console.log('\nInstalled Code Index Native Host manifest:');
  console.log(`  ${manifestPath}\n`);
  console.log(`Host script: ${hostPath}`);
  console.log(`Wrapper:     ${manifest.path}`);
  console.log(`Host name:   ${HOST_NAME}`);
  console.log(`Browser:     ${args.browser}`);
  if (manifest.allowed_origins) console.log(`Origin:      ${manifest.allowed_origins[0]}`);
  if (manifest.allowed_extensions) console.log(`Extension:   ${manifest.allowed_extensions[0]}`);
}

function status(args) {
  const installDir = getHostInstallDir();
  const hostPath = resolve(installDir, 'code-index-host.mjs');
  const manifestPath = getManifestPath(args.browser);
  const manifest = readManifest(manifestPath);
  const isReady = Boolean(manifest && existsSync(hostPath));

  console.log('DeepSeek++ Code Index Native Host status');
  console.log(`Browser:      ${args.browser}`);
  console.log(`Host name:    ${HOST_NAME}`);
  console.log(`Install dir:  ${installDir}`);
  console.log(`Host script:  ${existsSync(hostPath) ? 'found' : 'missing'} (${hostPath})`);
  console.log(`Manifest:     ${manifest ? 'found' : 'missing'} (${manifestPath})`);
  if (manifest?.allowed_origins) console.log(`Origins:      ${manifest.allowed_origins.join(', ')}`);
  if (platform() === 'win32') {
    const regKey = getRegistryKey(args.browser);
    if (regKey) console.log(`Registry:     ${regKey}`);
  }
  if (!isReady) process.exitCode = 1;
}

function uninstall(args) {
  const manifestPath = getManifestPath(args.browser);
  rmSync(manifestPath, { force: true });
  if (platform() === 'win32') removeWindowsRegistry(args.browser);
  rmSync(getHostInstallDir(), { recursive: true, force: true });
  console.log(`Removed Code Index Native Host for ${args.browser}.`);
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.command === 'status') { status(args); return; }
  if (args.command === 'uninstall') { uninstall(args); return; }
  install(args);
  console.log(`\nDone. Restart ${args.browser} to activate.`);
}

const isDirect = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirect) {
  main().catch((err) => {
    console.error(`\nInstall failed: ${err.message}`);
    process.exit(1);
  });
}
