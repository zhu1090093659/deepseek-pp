#!/usr/bin/env node
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { execFileSync, execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { dirname, posix, resolve, win32 } from 'node:path';
import { arch, homedir, platform, tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

export const HOST_NAME = 'com.deepseek_pp.shell';
export const FIREFOX_EXTENSION_ID = 'deepseek-pp@zhu1090093659.github';
export const SUPPORTED_BROWSER_NAMES = ['chrome', 'chromium', 'edge', 'firefox'];

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(__dirname, '..');
const HOST_SOURCE = resolve(PACKAGE_ROOT, 'native', 'shell-mcp-host.mjs');
const SUPPORTED_BROWSERS = new Set(SUPPORTED_BROWSER_NAMES);
const COMMANDS = new Set(['install', 'status', 'uninstall']);
const OFFICECLI_REPO = 'iOfficeAI/OfficeCLI';
const OFFICECLI_BINARY = platform() === 'win32' ? 'officecli.exe' : 'officecli';
const OFFICECLI_MIRROR_BASE = 'https://d.officecli.ai';
const OFFICECLI_GITHUB_RELEASE_BASE = `https://github.com/${OFFICECLI_REPO}/releases/latest/download`;
const OFFICECLI_REQUIRED_HELP_PATTERNS = [
  /\bview\s+<file>\s+<mode>/,
  /\bget\s+<file>\s+<path>/,
  /\bset\s+<file>\s+<path>/,
  /\bbatch\s+<file>/,
  /\bvalidate\s+<file>/,
  /--json\b/,
];

export function parseArgs(argv) {
  const args = {
    command: 'install',
    extensionId: null,
    browser: 'chrome',
    skipOfficecli: false,
    forceOfficecli: false,
    logFile: null,
  };
  const tokens = [...argv];

  if (tokens[0] && COMMANDS.has(tokens[0])) {
    args.command = tokens.shift();
  }

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token === '--extension-id' && tokens[i + 1]) args.extensionId = tokens[++i];
    else if (token === '--browser' && tokens[i + 1]) args.browser = tokens[++i].toLowerCase();
    else if (token === '--skip-officecli') args.skipOfficecli = true;
    else if (token === '--force-officecli') args.forceOfficecli = true;
    else if (token === '--log-file') {
      if (!tokens[i + 1]) throw new Error('--log-file requires a path argument');
      args.logFile = tokens[++i];
    } else if (token === '--help' || token === '-h') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown option: ${token}`);
    }
  }

  if (!SUPPORTED_BROWSERS.has(args.browser)) {
    throw new Error(`Unsupported browser: ${args.browser}`);
  }

  return args;
}

function printHelp() {
  console.log(`DeepSeek++ Shell Native Host installer

Usage:
  deepseek-pp-shell-host install --browser chrome --extension-id <extension-id>
  deepseek-pp-shell-host status --browser chrome
  deepseek-pp-shell-host uninstall --browser chrome

Commands:
  install              Install the Shell Native Host and OfficeCLI
  status               Show manifest, host, and OfficeCLI status
  uninstall            Remove the Shell Native Host manifest and installed host files

Options:
  --extension-id <id>  Chrome/Edge/Chromium extension ID
  --browser <name>     Target browser: chrome, chromium, edge, firefox (default: chrome)
  --skip-officecli     Install only the Shell Native Host
  --force-officecli    Reinstall OfficeCLI even if a compatible binary exists
  --log-file <path>    Write native host diagnostic logs to this file (for troubleshooting)
  --help               Show this help

Examples:
  npx deepseek-pp-shell-host install --browser chrome --extension-id abcdefghijklmnopqrstuvwxyz123456
  npx deepseek-pp-shell-host install --browser chrome --extension-id abcdefghijklmnopqrstuvwxyz123456 --log-file "$HOME/dpp-host.log"
  npx deepseek-pp-shell-host install --browser firefox
`);
}

export function resolveNativeHostLocations({ os, browser, home, localAppData }) {
  if (!SUPPORTED_BROWSERS.has(browser)) {
    throw new Error(`Unsupported browser: ${browser}`);
  }

  const path = os === 'win32' ? win32 : posix;
  let appDataRoot;
  let manifestDir;

  if (os === 'darwin') {
    appDataRoot = path.resolve(home, 'Library', 'Application Support', 'DeepSeek++');
    const manifestSegments = {
      chrome: ['Google', 'Chrome', 'NativeMessagingHosts'],
      chromium: ['Chromium', 'NativeMessagingHosts'],
      edge: ['Microsoft Edge', 'NativeMessagingHosts'],
      firefox: ['Mozilla', 'NativeMessagingHosts'],
    }[browser];
    manifestDir = path.resolve(home, 'Library', 'Application Support', ...manifestSegments);
  } else if (os === 'linux') {
    appDataRoot = path.resolve(home, '.local', 'share', 'deepseek-pp');
    const manifestSegments = {
      chrome: ['.config', 'google-chrome', 'NativeMessagingHosts'],
      chromium: ['.config', 'chromium', 'NativeMessagingHosts'],
      edge: ['.config', 'microsoft-edge', 'NativeMessagingHosts'],
      firefox: ['.mozilla', 'native-messaging-hosts'],
    }[browser];
    manifestDir = path.resolve(home, ...manifestSegments);
  } else if (os === 'win32') {
    const appData = localAppData || path.resolve(home, 'AppData', 'Local');
    appDataRoot = path.resolve(appData, 'DeepSeek++');
    manifestDir = path.resolve(appDataRoot, 'NativeMessagingHosts');
  } else {
    throw new Error(`Unsupported platform: ${os}`);
  }

  const hostInstallDir = path.resolve(
    appDataRoot,
    os === 'linux' ? 'native-host' : 'NativeHost',
  );
  return {
    appDataRoot,
    hostInstallDir,
    manifestDir,
    manifestPath: path.resolve(manifestDir, `${HOST_NAME}.json`),
    registryKey: os === 'win32' ? getWindowsRegistryKey(browser) : null,
  };
}

function getCurrentNativeHostLocations(browser = 'chrome') {
  return resolveNativeHostLocations({
    os: platform(),
    browser,
    home: homedir(),
    localAppData: process.env.LOCALAPPDATA,
  });
}

function getAppDataRoot() {
  return getCurrentNativeHostLocations().appDataRoot;
}

function getHostInstallDir() {
  return getCurrentNativeHostLocations().hostInstallDir;
}

function getManifestDir(browser) {
  return getCurrentNativeHostLocations(browser).manifestDir;
}

function getManifestPath(browser) {
  return getCurrentNativeHostLocations(browser).manifestPath;
}

function getWindowsRegistryKey(browser) {
  switch (browser) {
    case 'chrome': return `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${HOST_NAME}`;
    case 'edge': return `HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts\\${HOST_NAME}`;
    case 'chromium': return `HKCU\\Software\\Chromium\\NativeMessagingHosts\\${HOST_NAME}`;
    default: return null;
  }
}

function getRegistryKey(browser) {
  return getCurrentNativeHostLocations(browser).registryKey;
}

export function createNativeHostManifest(args, wrapperPath) {
  const manifest = {
    name: HOST_NAME,
    description: 'DeepSeek++ Shell MCP - General purpose shell execution via Native Messaging',
    path: wrapperPath,
    type: 'stdio',
  };

  if (args.browser === 'firefox') {
    manifest.allowed_extensions = [FIREFOX_EXTENSION_ID];
  } else {
    if (!args.extensionId) {
      throw new Error('--extension-id is required for Chrome/Edge/Chromium.');
    }
    manifest.allowed_origins = [`chrome-extension://${args.extensionId}/`];
  }

  return manifest;
}

function copyHostScript(installDir) {
  const hostPath = resolve(installDir, 'shell-mcp-host.mjs');
  mkdirSync(installDir, { recursive: true });
  copyFileSync(HOST_SOURCE, hostPath);
  if (platform() !== 'win32') chmodSync(hostPath, 0o755);
  return hostPath;
}

const LOG_META_FILENAME = 'shell-mcp-host.log-meta';

export function createWrapper(hostPath, logFile) {
  const installDir = dirname(hostPath);
  const nodePath = process.execPath;
  const metaPath = resolve(installDir, LOG_META_FILENAME);

  if (platform() === 'win32') {
    const wrapperPath = resolve(installDir, 'shell-mcp-host.bat');
    const setLine = logFile ? `set "DPP_LOG_FILE=${logFile.replaceAll('%', '%%')}"\r\n` : '';
    const content = `@echo off\r\n${setLine}"${nodePath}" "${hostPath}" %*\r\n`;
    writeFileSync(wrapperPath, content);
    writeLogMeta(metaPath, logFile);
    return wrapperPath;
  }

  const wrapperPath = resolve(installDir, 'shell-mcp-host');
  const envPrefix = logFile ? `DPP_LOG_FILE=${escapeShellValue(logFile)} ` : '';
  const content = `#!/bin/sh\n${envPrefix}exec "${nodePath}" "${hostPath}" "$@"\n`;
  writeFileSync(wrapperPath, content, { mode: 0o755 });
  writeLogMeta(metaPath, logFile);
  return wrapperPath;
}

function writeLogMeta(metaPath, logFile) {
  if (logFile) {
    writeFileSync(metaPath, JSON.stringify({ logFile }), 'utf8');
  } else {
    rmSync(metaPath, { force: true });
  }
}

export function escapeShellValue(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
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
  } catch {
    console.log(`Registry key not removed or was already absent: ${regKey}`);
  }
}

function getOfficeCliInstallDir() {
  if (platform() === 'win32') {
    const localAppData = process.env.LOCALAPPDATA || resolve(homedir(), 'AppData', 'Local');
    return resolve(localAppData, 'OfficeCLI');
  }
  return resolve(homedir(), '.local', 'bin');
}

function isProjectNodeModulesPath(path) {
  const normalized = path.replaceAll('\\', '/');
  return normalized.includes('/node_modules/.bin/');
}

function getPathOfficeCliCandidates() {
  const command = platform() === 'win32' ? 'where.exe' : 'which';
  const args = platform() === 'win32' ? [OFFICECLI_BINARY] : ['-a', 'officecli'];
  try {
    const out = execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return out
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function getOfficeCliCandidates() {
  const installPath = resolve(getOfficeCliInstallDir(), OFFICECLI_BINARY);
  const candidates = [installPath, ...getPathOfficeCliCandidates()]
    .filter(candidate => !isProjectNodeModulesPath(candidate));
  return [...new Set(candidates)];
}

function isCompatibleOfficeCli(binaryPath) {
  if (!existsSync(binaryPath)) return false;
  try {
    const help = execFileSync(binaryPath, ['--help'], {
      encoding: 'utf8',
      timeout: 20_000,
      env: { ...process.env, OFFICECLI_SKIP_UPDATE: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return OFFICECLI_REQUIRED_HELP_PATTERNS.every(pattern => pattern.test(help));
  } catch {
    return false;
  }
}

function findCompatibleOfficeCli() {
  return getOfficeCliCandidates().find(isCompatibleOfficeCli) ?? null;
}

function detectLinuxMusl() {
  if (existsSync('/etc/alpine-release')) return true;
  try {
    const out = execFileSync('ldd', ['--version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return /musl/i.test(out);
  } catch {
    return false;
  }
}

function getOfficeCliAssetName() {
  const os = platform();
  const cpu = arch();
  if (os === 'darwin') {
    if (cpu === 'arm64') return 'officecli-mac-arm64';
    if (cpu === 'x64') return 'officecli-mac-x64';
  }
  if (os === 'linux') {
    const distro = detectLinuxMusl() ? 'linux-alpine' : 'linux';
    if (cpu === 'x64') return `officecli-${distro}-x64`;
    if (cpu === 'arm64') return `officecli-${distro}-arm64`;
  }
  if (os === 'win32') {
    if (cpu === 'x64') return 'officecli-win-x64.exe';
    if (cpu === 'arm64') return 'officecli-win-arm64.exe';
  }
  throw new Error(`Unsupported OfficeCLI platform: ${os}/${cpu}`);
}

async function fetchBytes(url) {
  const response = await fetch(url, {
    headers: { 'user-agent': 'deepseek-pp-officecli-installer' },
  });
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

async function downloadWithFallback(asset, outPath) {
  const primary = `${OFFICECLI_MIRROR_BASE}/releases/latest/download/${asset}`;
  const fallback = `${OFFICECLI_GITHUB_RELEASE_BASE}/${asset}`;
  try {
    writeFileSync(outPath, await fetchBytes(primary));
    console.log(`  downloaded ${asset} via mirror`);
  } catch (primaryError) {
    console.log(`  mirror unavailable for ${asset}, falling back to GitHub`);
    try {
      writeFileSync(outPath, await fetchBytes(fallback));
    } catch (fallbackError) {
      throw new Error(`Failed to download ${asset}: mirror=${primaryError.message}; github=${fallbackError.message}`);
    }
  }
}

async function verifyOfficeCliChecksum(asset, binaryPath) {
  const sumsPath = resolve(tmpdir(), `officecli-SHA256SUMS-${process.pid}`);
  try {
    try {
      await downloadWithFallback('SHA256SUMS', sumsPath);
    } catch {
      console.log('  checksum file unavailable, skipping verification');
      return;
    }
    const sums = readFileSync(sumsPath, 'utf8');
    const expectedLine = sums.split(/\r?\n/).find(line => line.includes(asset));
    if (!expectedLine) {
      console.log('  checksum entry not found, skipping verification');
      return;
    }
    const expected = expectedLine.trim().split(/\s+/)[0].toLowerCase();
    const actual = createHash('sha256').update(readFileSync(binaryPath)).digest('hex');
    if (actual !== expected) {
      throw new Error(`Checksum mismatch for ${asset}: expected ${expected}, got ${actual}`);
    }
    console.log('  checksum verified');
  } finally {
    rmSync(sumsPath, { force: true });
  }
}

function verifyDownloadedOfficeCli(binaryPath) {
  if (platform() !== 'win32') {
    chmodSync(binaryPath, 0o755);
  }
  execFileSync(binaryPath, ['--version'], {
    timeout: 20_000,
    stdio: ['ignore', 'ignore', 'pipe'],
    env: { ...process.env, OFFICECLI_SKIP_UPDATE: '1' },
  });
  if (!isCompatibleOfficeCli(binaryPath)) {
    throw new Error('Downloaded OfficeCLI does not expose the required command-based interface.');
  }
}

function addOfficeCliToUserPath(installDir) {
  if (platform() === 'win32') {
    try {
      execFileSync('powershell.exe', [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        `$p=[Environment]::GetEnvironmentVariable('Path','User'); if (($p -split ';') -notcontains '${installDir.replaceAll("'", "''")}') { [Environment]::SetEnvironmentVariable('Path', (($p.TrimEnd(';') + ';${installDir.replaceAll("'", "''")}').TrimStart(';')), 'User') }`,
      ], { stdio: 'pipe' });
      console.log(`Added ${installDir} to the user PATH.`);
    } catch {
      console.log(`Could not update the user PATH automatically. Add this directory manually: ${installDir}`);
    }
    return;
  }

  const shellRc = platform() === 'darwin' || process.env.SHELL?.includes('zsh')
    ? resolve(homedir(), '.zshrc')
    : resolve(homedir(), '.bashrc');
  const pathLine = `export PATH="${installDir}:$PATH"`;
  try {
    const existing = existsSync(shellRc) ? readFileSync(shellRc, 'utf8') : '';
    if (!existing.includes(installDir)) {
      writeFileSync(shellRc, `${existing}${existing.endsWith('\n') || existing.length === 0 ? '' : '\n'}\n${pathLine}\n`);
      console.log(`Added ${installDir} to PATH in ${shellRc}.`);
    }
  } catch {
    console.log(`Could not update shell PATH automatically. Add this line manually: ${pathLine}`);
  }
}

async function ensureOfficeCliInstalled({ force }) {
  if (!force) {
    const existing = findCompatibleOfficeCli();
    if (existing) {
      console.log(`OfficeCLI command binary already available: ${existing}`);
      return existing;
    }
  }

  const asset = getOfficeCliAssetName();
  const installDir = getOfficeCliInstallDir();
  const targetPath = resolve(installDir, OFFICECLI_BINARY);
  const tempPath = resolve(tmpdir(), `${OFFICECLI_BINARY}-${process.pid}`);
  const stagedPath = `${targetPath}.new`;

  console.log(`Installing OfficeCLI from ${OFFICECLI_REPO} (${asset})...`);
  await downloadWithFallback(asset, tempPath);
  await verifyOfficeCliChecksum(asset, tempPath);
  verifyDownloadedOfficeCli(tempPath);

  mkdirSync(installDir, { recursive: true });
  copyFileSync(tempPath, stagedPath);
  if (platform() !== 'win32') {
    chmodSync(stagedPath, 0o755);
  }
  if (platform() === 'darwin') {
    try { execFileSync('xattr', ['-d', 'com.apple.quarantine', stagedPath], { stdio: 'ignore' }); } catch {}
    try { execFileSync('codesign', ['-s', '-', '-f', stagedPath], { stdio: 'ignore' }); } catch {}
  }
  renameSync(stagedPath, targetPath);
  rmSync(tempPath, { force: true });

  addOfficeCliToUserPath(installDir);
  console.log(`OfficeCLI installed: ${targetPath}`);
  return targetPath;
}

function readManifest(manifestPath) {
  if (!existsSync(manifestPath)) return null;
  return JSON.parse(readFileSync(manifestPath, 'utf8'));
}

function install(args) {
  const manifestPath = getManifestPath(args.browser);
  const manifestDir = dirname(manifestPath);
  const hostPath = copyHostScript(getHostInstallDir());
  const wrapperPath = createWrapper(hostPath, args.logFile);
  const manifest = createNativeHostManifest(args, wrapperPath);

  mkdirSync(manifestDir, { recursive: true });
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

  if (platform() === 'win32') {
    writeWindowsRegistry(args.browser, manifestPath);
  }

  console.log('\nInstalled native messaging host manifest:');
  console.log(`  ${manifestPath}\n`);
  console.log(`Host script: ${hostPath}`);
  console.log(`Wrapper:     ${manifest.path}`);
  console.log(`Host name:   ${HOST_NAME}`);
  console.log(`Browser:     ${args.browser}`);
  if (manifest.allowed_origins) console.log(`Origin:      ${manifest.allowed_origins[0]}`);
  if (manifest.allowed_extensions) console.log(`Extension:   ${manifest.allowed_extensions[0]}`);
  if (args.logFile) console.log(`Log file:    ${args.logFile}`);
  console.log('');
  if (args.skipOfficecli) {
    console.log('OfficeCLI install skipped by --skip-officecli.');
  }
}

function status(args) {
  const installDir = getHostInstallDir();
  const hostPath = resolve(installDir, 'shell-mcp-host.mjs');
  const wrapperPath = resolve(installDir, platform() === 'win32' ? 'shell-mcp-host.bat' : 'shell-mcp-host');
  const manifestPath = getManifestPath(args.browser);
  const manifest = readManifest(manifestPath);
  const officeCli = findCompatibleOfficeCli();
  const isReady = Boolean(manifest && existsSync(hostPath) && existsSync(manifest.path ?? wrapperPath));
  const logFile = detectLogFile(wrapperPath);

  console.log('DeepSeek++ Shell Native Host status');
  console.log(`Browser:      ${args.browser}`);
  console.log(`Host name:    ${HOST_NAME}`);
  console.log(`Install dir:  ${installDir}`);
  console.log(`Host script:  ${existsSync(hostPath) ? 'found' : 'missing'} (${hostPath})`);
  console.log(`Wrapper:      ${existsSync(wrapperPath) ? 'found' : 'missing'} (${wrapperPath})`);
  console.log(`Manifest:     ${manifest ? 'found' : 'missing'} (${manifestPath})`);
  if (manifest) {
    console.log(`Target path:  ${manifest.path}`);
    if (manifest.allowed_origins) console.log(`Origins:      ${manifest.allowed_origins.join(', ')}`);
    if (manifest.allowed_extensions) console.log(`Extensions:   ${manifest.allowed_extensions.join(', ')}`);
  }
  console.log(`Log file:     ${logFile || 'disabled'}`);
  if (platform() === 'win32') {
    const regKey = getRegistryKey(args.browser);
    if (regKey) console.log(`Registry:     ${regKey}`);
  }
  console.log(`OfficeCLI:    ${officeCli ? `compatible (${officeCli})` : 'missing or incompatible'}`);

  if (!isReady) {
    process.exitCode = 1;
  }
}

export function detectLogFile(wrapperPath) {
  const installDir = dirname(wrapperPath);
  const metaPath = resolve(installDir, LOG_META_FILENAME);
  if (!existsSync(metaPath)) return null;
  try {
    const data = JSON.parse(readFileSync(metaPath, 'utf8'));
    return typeof data.logFile === 'string' ? data.logFile : null;
  } catch {
    return null;
  }
}

function uninstall(args) {
  const manifestPath = getManifestPath(args.browser);
  rmSync(manifestPath, { force: true });
  if (platform() === 'win32') {
    removeWindowsRegistry(args.browser);
  }
  rmSync(getHostInstallDir(), { recursive: true, force: true });
  console.log(`Removed Shell Native Host for ${args.browser}.`);
  console.log('OfficeCLI was left in place because it may be shared by other tools.');
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.command === 'status') {
    status(args);
    return;
  }
  if (args.command === 'uninstall') {
    uninstall(args);
    return;
  }

  install(args);
  if (!args.skipOfficecli) {
    await ensureOfficeCliInstalled({ force: args.forceOfficecli });
  }
  console.log(`\nDone. Restart ${args.browser} to activate.`);
}

const isDirect = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirect) {
  main().catch((err) => {
    console.error(`\nInstall failed: ${err.message}`);
    process.exit(1);
  });
}
