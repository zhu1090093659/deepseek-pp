#!/usr/bin/env node
'use strict';

// Post-build hook: ensure the Windows .exe file icon is set correctly.
// electron-builder sometimes fails to embed the icon (e.g. when rcedit is
// missing or winCodeSign extraction fails). This script runs rcedit directly
// as a reliable fallback.

const path = require('node:path');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const iconPath = path.join(root, 'build', 'icon.ico');
const rceditPath = path.join(root, 'node_modules', 'rcedit', 'bin', 'rcedit-x64.exe');

// Find all DeepSeek++.exe files under release/ (win-unpacked + NSIS installer stub)
const releaseDir = path.join(root, 'release');
const exePaths = [];
function findExe(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) findExe(path.join(dir, entry.name));
    else if (entry.name === 'DeepSeek++.exe') exePaths.push(path.join(dir, entry.name));
  }
}
findExe(releaseDir);

if (exePaths.length === 0) {
  console.warn('[set-icon] SKIP: no DeepSeek++.exe found under release/');
  process.exit(0);
}
if (!fs.existsSync(iconPath)) {
  console.warn('[set-icon] SKIP: icon.ico not found at', iconPath);
  process.exit(0);
}
if (!fs.existsSync(rceditPath)) {
  console.warn('[set-icon] SKIP: rcedit-x64.exe not found. Run npm install first.');
  process.exit(0);
}

let failed = 0;
for (const exePath of exePaths) {
  console.log('[set-icon] Setting icon for', path.relative(root, exePath));
  try {
    execFileSync(rceditPath, [exePath, '--set-icon', iconPath], { stdio: 'inherit' });
    console.log('[set-icon] Done!');
  } catch (err) {
    console.error('[set-icon] FAILED:', err.message);
    failed++;
  }
}
if (failed > 0) process.exit(1);
