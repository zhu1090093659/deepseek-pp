#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { platform } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  copyHostRuntime,
  createWrapper,
  detectLogFile,
  escapeShellValue,
  getMissingHostRuntimeFiles,
} from './host-files.mjs';
import {
  FIREFOX_EXTENSION_ID,
  HOST_NAME,
  SUPPORTED_BROWSER_NAMES,
  assertSupportedBrowser,
  createNativeHostManifest,
  getHostInstallDir,
  getManifestPath,
  getRegistryKey,
  resolveNativeHostLocations,
} from './installer-locations.mjs';
import { ensureOfficeCliInstalled, findCompatibleOfficeCli } from './officecli-installer.mjs';

export {
  FIREFOX_EXTENSION_ID,
  HOST_NAME,
  SUPPORTED_BROWSER_NAMES,
  copyHostRuntime,
  createNativeHostManifest,
  createWrapper,
  detectLogFile,
  escapeShellValue,
  getMissingHostRuntimeFiles,
  resolveNativeHostLocations,
};

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const nativeSourceDir = resolve(packageRoot, 'native');
const commands = new Set(['install', 'status', 'uninstall']);

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
  if (tokens[0] && commands.has(tokens[0])) args.command = tokens.shift();

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === '--extension-id' && tokens[index + 1]) args.extensionId = tokens[++index];
    else if (token === '--browser' && tokens[index + 1]) args.browser = tokens[++index].toLowerCase();
    else if (token === '--skip-officecli') args.skipOfficecli = true;
    else if (token === '--force-officecli') args.forceOfficecli = true;
    else if (token === '--log-file') {
      if (!tokens[index + 1]) throw new Error('--log-file requires a path argument');
      args.logFile = tokens[++index];
    } else if (token === '--help' || token === '-h') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown option: ${token}`);
    }
  }

  assertSupportedBrowser(args.browser);
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

function writeWindowsRegistry(browser, manifestPath) {
  const registryKey = getRegistryKey(browser);
  if (!registryKey) return;
  try {
    execFileSync('reg', ['add', registryKey, '/ve', '/t', 'REG_SZ', '/d', manifestPath, '/f'], { stdio: 'pipe' });
    console.log(`Registry: ${registryKey}`);
  } catch {
    console.error('Warning: Failed to write registry key. You may need to run as Administrator.');
    console.error(`  Manual: reg add "${registryKey}" /ve /t REG_SZ /d "${manifestPath}" /f`);
  }
}

function removeWindowsRegistry(browser) {
  const registryKey = getRegistryKey(browser);
  if (!registryKey) return;
  try {
    execFileSync('reg', ['delete', registryKey, '/f'], { stdio: 'pipe' });
    console.log(`Removed registry key: ${registryKey}`);
  } catch {
    console.log(`Registry key not removed or was already absent: ${registryKey}`);
  }
}

function readManifest(manifestPath) {
  if (!existsSync(manifestPath)) return null;
  return JSON.parse(readFileSync(manifestPath, 'utf8'));
}

function install(args) {
  const manifestPath = getManifestPath(args.browser);
  const hostPath = copyHostRuntime(nativeSourceDir, getHostInstallDir());
  const wrapperPath = createWrapper(hostPath, args.logFile);
  const manifest = createNativeHostManifest(args, wrapperPath);

  mkdirSync(dirname(manifestPath), { recursive: true });
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  if (platform() === 'win32') writeWindowsRegistry(args.browser, manifestPath);

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
  if (args.skipOfficecli) console.log('OfficeCLI install skipped by --skip-officecli.');
}

function status(args) {
  const installDir = getHostInstallDir();
  const hostPath = resolve(installDir, 'shell-mcp-host.mjs');
  const wrapperPath = resolve(installDir, platform() === 'win32' ? 'shell-mcp-host.bat' : 'shell-mcp-host');
  const manifestPath = getManifestPath(args.browser);
  const manifest = readManifest(manifestPath);
  const officeCli = findCompatibleOfficeCli();
  const missingRuntimeFiles = getMissingHostRuntimeFiles(installDir);
  const isReady = Boolean(manifest && missingRuntimeFiles.length === 0 && existsSync(manifest.path ?? wrapperPath));
  const logFile = detectLogFile(wrapperPath);

  console.log('DeepSeek++ Shell Native Host status');
  console.log(`Browser:      ${args.browser}`);
  console.log(`Host name:    ${HOST_NAME}`);
  console.log(`Install dir:  ${installDir}`);
  console.log(`Host script:  ${existsSync(hostPath) ? 'found' : 'missing'} (${hostPath})`);
  console.log(`Runtime:      ${missingRuntimeFiles.length === 0 ? 'complete' : `incomplete (${missingRuntimeFiles.join(', ')})`}`);
  console.log(`Wrapper:      ${existsSync(wrapperPath) ? 'found' : 'missing'} (${wrapperPath})`);
  console.log(`Manifest:     ${manifest ? 'found' : 'missing'} (${manifestPath})`);
  if (manifest) {
    console.log(`Target path:  ${manifest.path}`);
    if (manifest.allowed_origins) console.log(`Origins:      ${manifest.allowed_origins.join(', ')}`);
    if (manifest.allowed_extensions) console.log(`Extensions:   ${manifest.allowed_extensions.join(', ')}`);
  }
  console.log(`Log file:     ${logFile || 'disabled'}`);
  if (platform() === 'win32') {
    const registryKey = getRegistryKey(args.browser);
    if (registryKey) console.log(`Registry:     ${registryKey}`);
  }
  console.log(`OfficeCLI:    ${officeCli ? `compatible (${officeCli})` : 'missing or incompatible'}`);
  if (!isReady) process.exitCode = 1;
}

function uninstall(args) {
  const manifestPath = getManifestPath(args.browser);
  rmSync(manifestPath, { force: true });
  if (platform() === 'win32') removeWindowsRegistry(args.browser);
  rmSync(getHostInstallDir(), { recursive: true, force: true });
  console.log(`Removed Shell Native Host for ${args.browser}.`);
  console.log('OfficeCLI was left in place because it may be shared by other tools.');
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.command === 'status') return status(args);
  if (args.command === 'uninstall') return uninstall(args);

  install(args);
  if (!args.skipOfficecli) await ensureOfficeCliInstalled({ force: args.forceOfficecli });
  console.log(`\nDone. Restart ${args.browser} to activate.`);
}

const isDirect = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirect) {
  main().catch(error => {
    console.error(`\nInstall failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
