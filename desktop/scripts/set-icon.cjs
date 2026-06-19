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
const exePath = path.join(root, 'release', 'win-unpacked', 'DeepSeek++.exe');
const iconPath = path.join(root, 'build', 'icon.ico');
const rceditPath = path.join(root, 'node_modules', 'rcedit', 'bin', 'rcedit-x64.exe');

if (!fs.existsSync(exePath)) {
  console.warn('[set-icon] SKIP: exe not found at', exePath);
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

console.log('[set-icon] Setting exe icon...');
try {
  execFileSync(rceditPath, [exePath, '--set-icon', iconPath], { stdio: 'inherit' });
  console.log('[set-icon] Done!');
} catch (err) {
  console.error('[set-icon] FAILED:', err.message);
  process.exit(1);
}
