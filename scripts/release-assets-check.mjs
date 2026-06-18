#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, statSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const packageJson = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const version = packageJson.version;
const distDir = resolve(root, 'dist');
const failures = [];

const extensionZips = ['chrome', 'edge', 'firefox'].map((browser) => ({
  browser,
  path: resolve(distDir, `deepseek-plus-plus-${version}-${browser}.zip`),
}));
const sourceZip = resolve(distDir, `deepseek-plus-plus-${version}-sources.zip`);

for (const zip of extensionZips) {
  assertFile(zip.path, `${zip.browser} zip`);
  if (!existsSync(zip.path)) continue;

  const manifest = readZipJson(zip.path, 'manifest.json');
  if (!manifest) continue;
  if (manifest.version !== version) {
    failures.push(`${zip.browser} zip manifest version ${manifest.version} does not match ${version}`);
  }
  if (manifest.name !== '__MSG_extension_name__') {
    failures.push(`${zip.browser} zip manifest name mismatch: ${manifest.name}`);
  }
  if (manifest.default_locale !== 'en') {
    failures.push(`${zip.browser} zip default_locale mismatch: ${manifest.default_locale}`);
  }
  assertZipContains(zip.path, 'background.js', `${zip.browser} zip must contain background.js`);
  assertZipContains(zip.path, '_locales/en/messages.json', `${zip.browser} zip must contain English locale messages`);
  assertZipContains(zip.path, '_locales/zh_CN/messages.json', `${zip.browser} zip must contain Chinese locale messages`);
}

assertFile(sourceZip, 'source zip');
if (existsSync(sourceZip)) {
  assertZipContains(sourceZip, 'package.json', 'source zip must contain package.json');
  assertZipContains(sourceZip, 'wxt.config.ts', 'source zip must contain wxt.config.ts');
  assertZipContains(sourceZip, '.github/workflows/release.yml', 'source zip must contain release workflow');
  assertZipDoesNotContain(sourceZip, 'node_modules/', 'source zip must not contain node_modules');
  assertZipDoesNotContain(sourceZip, 'dist/', 'source zip must not contain dist');
}

if (failures.length > 0) {
  console.error('Release asset check failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('Release asset check passed');

function assertFile(file, label) {
  if (!existsSync(file)) {
    failures.push(`${label} is missing: ${file}`);
    return;
  }
  if (statSync(file).size === 0) {
    failures.push(`${label} is empty: ${file}`);
  }
}

function readZipJson(zipFile, entry) {
  try {
    return JSON.parse(execFileSync('unzip', ['-p', zipFile, entry], { encoding: 'utf8' }));
  } catch (error) {
    failures.push(`${zipFile}: cannot read ${entry}: ${error.message}`);
    return null;
  }
}

function readZipListing(zipFile) {
  return execFileSync('unzip', ['-Z1', zipFile], { encoding: 'utf8' })
    .split('\n')
    .filter(Boolean);
}

function assertZipContains(zipFile, entry, message) {
  const listing = readZipListing(zipFile);
  if (!listing.includes(entry)) failures.push(message);
}

function assertZipDoesNotContain(zipFile, entry, message) {
  const listing = readZipListing(zipFile);
  if (listing.some((item) => item === entry || item.startsWith(entry))) failures.push(message);
}
