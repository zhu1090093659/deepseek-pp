import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { arch, homedir, platform, tmpdir } from 'node:os';
import { resolve } from 'node:path';

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

export function findCompatibleOfficeCli() {
  return getOfficeCliCandidates().find(isCompatibleOfficeCli) ?? null;
}

function detectLinuxMusl() {
  if (existsSync('/etc/alpine-release')) return true;
  try {
    const out = execFileSync('ldd', ['--version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return /musl/i.test(out);
  } catch (error) {
    console.log(`  could not inspect the Linux libc; using the released glibc asset fallback: ${error instanceof Error ? error.message : String(error)}`);
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
        '$installDir=[Environment]::GetEnvironmentVariable("DPP_OFFICECLI_INSTALL_DIR","Process"); $p=[Environment]::GetEnvironmentVariable("Path","User"); if (($p -split ";") -notcontains $installDir) { [Environment]::SetEnvironmentVariable("Path", (($p.TrimEnd(";") + ";" + $installDir).TrimStart(";")), "User") }',
      ], {
        env: { ...process.env, DPP_OFFICECLI_INSTALL_DIR: installDir },
        stdio: 'pipe',
      });
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

export async function ensureOfficeCliInstalled({ force }) {
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
    try {
      execFileSync('xattr', ['-d', 'com.apple.quarantine', stagedPath], { stdio: 'ignore' });
    } catch (error) {
      console.log(`  could not clear macOS quarantine metadata: ${error instanceof Error ? error.message : String(error)}`);
    }
    try {
      execFileSync('codesign', ['-s', '-', '-f', stagedPath], { stdio: 'ignore' });
    } catch (error) {
      console.log(`  could not apply the ad-hoc macOS signature: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  renameSync(stagedPath, targetPath);
  rmSync(tempPath, { force: true });

  addOfficeCliToUserPath(installDir);
  console.log(`OfficeCLI installed: ${targetPath}`);
  return targetPath;
}
