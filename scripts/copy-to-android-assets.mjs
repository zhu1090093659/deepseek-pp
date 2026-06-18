#!/usr/bin/env node
import { cp, mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const chromeBuildDir = resolve(root, 'dist/chrome-mv3');
const androidAssetDir = resolve(root, 'android/app/src/main/assets/dpp');
const shimSource = resolve(root, 'android/web/android-bridge-shim.js');

if (!existsSync(chromeBuildDir)) {
  fail('Missing dist/chrome-mv3. Run npm run build:chrome before staging Android assets.');
}
if (!existsSync(shimSource)) {
  fail('Missing android/web/android-bridge-shim.js.');
}

await rm(androidAssetDir, { recursive: true, force: true });
await mkdir(androidAssetDir, { recursive: true });

const entries = [
  '_locales',
  'assets',
  'chunks',
  'content-scripts',
  'deepseek',
  'icon',
  'pet',
  'background.js',
  'manifest.json',
  'sidepanel.html',
  'logo.png',
  'wxt.svg',
];

const staged = [];
for (const entry of entries) {
  const source = join(chromeBuildDir, entry);
  if (!existsSync(source)) continue;
  const target = join(androidAssetDir, entry);
  await cp(source, target, { recursive: true });
  staged.push(...await listFiles(target));
}

const shimTarget = join(androidAssetDir, 'android-bridge-shim.js');
await cp(shimSource, shimTarget);
staged.push(shimTarget);

const manifest = {
  generatedAt: new Date().toISOString(),
  source: 'dist/chrome-mv3',
  files: staged
    .map((file) => relative(androidAssetDir, file).split('/').join('/'))
    .sort(),
};
await writeFile(join(androidAssetDir, 'asset-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

console.log(`Android assets staged: ${manifest.files.length} files -> ${relative(root, androidAssetDir)}`);

async function listFiles(path) {
  const info = await stat(path);
  if (info.isFile()) return [path];
  const files = [];
  for (const entry of await readdir(path)) {
    files.push(...await listFiles(join(path, entry)));
  }
  return files;
}

function fail(message) {
  console.error(`Android asset staging failed: ${message}`);
  process.exit(1);
}
