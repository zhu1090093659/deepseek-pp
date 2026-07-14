import { execFileSync } from 'node:child_process';
import { homedir, platform } from 'node:os';
import { DEFAULT_TIMEOUT_MS, WINDOWS_POWERSHELL_UTF8_PREAMBLE } from './contracts.mjs';
import { resolveLocalPath, safeStat } from './file-provider.mjs';

export function createPickerToolHandlers() {
  return [{ name: 'local_folder_pick', handle: createLocalFolderPickResult }];
}

function createLocalFolderPickResult(args) {
  const title = typeof args?.title === 'string' && args.title.trim()
    ? args.title.trim()
    : 'Choose a local Skill folder';
  const defaultPath = typeof args?.defaultPath === 'string' && args.defaultPath.trim()
    ? resolveFolderPickerDefault(args.defaultPath)
    : '';

  try {
    const selectedPath = pickLocalFolder({ title, defaultPath });
    const normalizedPath = resolveLocalPath(selectedPath);
    const selectedStat = safeStat(normalizedPath);
    if (!selectedStat || !selectedStat.isDirectory()) {
      throw new Error(`Selected path is not a readable directory: ${normalizedPath}`);
    }
    return {
      content: [{ type: 'text', text: `Selected local folder: ${normalizedPath}` }],
      structuredContent: { ok: true, data: { path: normalizedPath } },
    };
  } catch (error) {
    return { isError: true, content: [{ type: 'text', text: normalizeFolderPickerError(error) }] };
  }
}

function pickLocalFolder({ title, defaultPath }) {
  const hostPlatform = platform();
  if (hostPlatform === 'darwin') return pickLocalFolderOnMac(title, defaultPath);
  if (hostPlatform === 'win32') return pickLocalFolderOnWindows(title, defaultPath);
  return pickLocalFolderOnLinux(title, defaultPath);
}

function pickLocalFolderOnMac(title, defaultPath) {
  const script = [
    'on run argv',
    '  set promptText to item 1 of argv',
    '  set defaultPath to item 2 of argv',
    '  if defaultPath is not "" then',
    '    set chosenFolder to choose folder with prompt promptText default location (POSIX file defaultPath)',
    '  else',
    '    set chosenFolder to choose folder with prompt promptText',
    '  end if',
    '  return POSIX path of chosenFolder',
    'end run',
  ].join('\n');
  return execFileSync('osascript', ['-e', script, title, defaultPath || ''], {
    encoding: 'utf8', timeout: DEFAULT_TIMEOUT_MS, windowsHide: true,
  }).trim();
}

function pickLocalFolderOnWindows(title, defaultPath) {
  const script = [
    WINDOWS_POWERSHELL_UTF8_PREAMBLE,
    'Add-Type -AssemblyName System.Windows.Forms',
    '$dialog = New-Object System.Windows.Forms.FolderBrowserDialog',
    '$dialog.Description = [Environment]::GetEnvironmentVariable("DPP_FOLDER_PICK_TITLE", "Process")',
    '$dialog.ShowNewFolderButton = $false',
    '$defaultPath = [Environment]::GetEnvironmentVariable("DPP_FOLDER_PICK_DEFAULT_PATH", "Process")',
    'if ($defaultPath) { $dialog.SelectedPath = $defaultPath }',
    'if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {',
    '  [Console]::Out.Write($dialog.SelectedPath)',
    '} else {',
    '  [Environment]::Exit(2)',
    '}',
  ].join('; ');
  return execFileSync('powershell.exe', ['-NoProfile', '-STA', '-EncodedCommand', encodePowerShellCommand(script)], {
    encoding: 'utf8',
    env: { ...process.env, DPP_FOLDER_PICK_TITLE: title, DPP_FOLDER_PICK_DEFAULT_PATH: defaultPath || '' },
    timeout: DEFAULT_TIMEOUT_MS,
    windowsHide: false,
  }).trim();
}

function encodePowerShellCommand(script) {
  return Buffer.from(script, 'utf16le').toString('base64');
}

function pickLocalFolderOnLinux(title, defaultPath) {
  const linuxPickers = [
    {
      command: 'zenity',
      args: ['--file-selection', '--directory', '--title', title, ...(defaultPath ? ['--filename', ensureTrailingPathSeparator(defaultPath)] : [])],
    },
    { command: 'kdialog', args: ['--getexistingdirectory', defaultPath || homedir(), '--title', title] },
  ];
  const missing = [];
  for (const picker of linuxPickers) {
    try {
      return execFileSync(picker.command, picker.args, {
        encoding: 'utf8', timeout: DEFAULT_TIMEOUT_MS, windowsHide: true,
      }).trim();
    } catch (error) {
      if (error?.code === 'ENOENT') {
        missing.push(picker.command);
        continue;
      }
      throw error;
    }
  }
  throw new Error(`No graphical folder picker is available. Install one of: ${missing.join(', ')}.`);
}

function resolveFolderPickerDefault(input) {
  const resolved = resolveLocalPath(input);
  return safeStat(resolved)?.isDirectory() ? resolved : homedir();
}

function ensureTrailingPathSeparator(value) {
  return value.endsWith('/') ? value : `${value}/`;
}

function normalizeFolderPickerError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return /User canceled|cancelled|canceled|exit code 2|The operation couldn.?t be completed/i.test(message)
    ? 'Folder selection was cancelled.'
    : message;
}
