#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, statSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const packageJson = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const version = packageJson.version;
const distDir = resolve(root, 'dist');
const failures = [];
const pyodidePolicyEntry = 'scripts/pyodide-package-policy.json';
const pyodidePolicy = readPyodidePolicy(resolve(root, pyodidePolicyEntry));
const bundledSkillPolicyEntry = 'scripts/bundled-skill-package-policy.json';
const bundledSkillPolicy = readBundledSkillPolicy(resolve(root, bundledSkillPolicyEntry));
const bundledSkillSourceRoots = {
  officecli: resolve(root, 'core/skill/officecli-official'),
  'spec-driven-develop': resolve(root, 'core/skill/spec-driven-develop-official'),
};
const bundledSkillGroups = {
  officecli: collectFiles(bundledSkillSourceRoots.officecli).filter((path) =>
    /^skills\/[^/]+\/SKILL\.md$/.test(path) || path === 'styles/INDEX.md',
  ),
  'spec-driven-develop': collectFiles(bundledSkillSourceRoots['spec-driven-develop']).filter((path) =>
    /\.(?:md|py|sh|js)$/.test(path),
  ),
};

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
  inspectPyodidePackage(zip.browser, zip.path);
  inspectBundledSkillPackage(zip.browser, zip.path);
}

assertFile(sourceZip, 'source zip');
if (existsSync(sourceZip)) {
  assertZipContains(sourceZip, 'package.json', 'source zip must contain package.json');
  assertZipContains(sourceZip, 'wxt.config.ts', 'source zip must contain wxt.config.ts');
  assertZipContains(sourceZip, pyodidePolicyEntry, `source zip must contain ${pyodidePolicyEntry}`);
  assertZipContains(sourceZip, bundledSkillPolicyEntry, `source zip must contain ${bundledSkillPolicyEntry}`);
  assertZipContains(sourceZip, '.github/workflows/release.yml', 'source zip must contain release workflow');
  assertZipDoesNotContain(sourceZip, 'node_modules/', 'source zip must not contain node_modules');
  assertZipDoesNotContain(sourceZip, 'dist/', 'source zip must not contain dist');
  assertZipDoesNotContain(sourceZip, 'bundled-skills/', 'source zip must not duplicate generated bundled Skill assets');
  const sourcePyodidePayloads = readZipListing(sourceZip).filter((entry) =>
    pyodidePolicy.assets.some(({ file }) =>
      entry === `pyodide/${file}` || entry.endsWith(`/pyodide/${file}`),
    ),
  );
  if (sourcePyodidePayloads.length > 0) {
    failures.push(`source zip must not duplicate built Pyodide payloads: ${sourcePyodidePayloads.join(', ')}`);
  }
  console.log(`Pyodide source payload count: ${sourcePyodidePayloads.length}`);
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

function inspectPyodidePackage(browser, zipFile) {
  const buildDir = resolve(distDir, `${browser}-mv3/pyodide`);
  if (!existsSync(buildDir)) {
    failures.push(`${browser} build Pyodide directory is missing: ${buildDir}`);
    return;
  }

  const buildEntries = readdirSync(buildDir, { withFileTypes: true });
  const buildFiles = buildEntries.filter((entry) => entry.isFile()).map((entry) => entry.name).sort();
  const unexpectedBuildEntries = buildEntries.filter((entry) => !entry.isFile()).map((entry) => entry.name);
  if (unexpectedBuildEntries.length > 0) {
    failures.push(`${browser} build Pyodide directory must be flat: ${unexpectedBuildEntries.join(', ')}`);
  }

  const expectedFiles = pyodidePolicy.assets.map(({ file }) => file).sort();
  assertExactEntries(buildFiles, expectedFiles, `${browser} build Pyodide assets`);

  let buildRawBytes = 0;
  const buildInventory = new Map();
  for (const asset of pyodidePolicy.assets) {
    const assetPath = resolve(buildDir, asset.file);
    if (!existsSync(assetPath)) continue;
    const contents = readFileSync(assetPath);
    const hash = sha256(contents);
    buildRawBytes += contents.byteLength;
    buildInventory.set(asset.file, { bytes: contents.byteLength, hash });
    if (contents.byteLength !== asset.bytes) {
      failures.push(`${browser} build pyodide/${asset.file} has ${contents.byteLength} bytes; expected ${asset.bytes}`);
    }
    if (hash !== asset.sha256) {
      failures.push(`${browser} build pyodide/${asset.file} SHA-256 ${hash} does not match ${asset.sha256}`);
    }
  }

  if (buildFiles.length !== pyodidePolicy.budgets.assetCount) {
    failures.push(`${browser} build has ${buildFiles.length} Pyodide assets; budget requires ${pyodidePolicy.budgets.assetCount}`);
  }
  if (buildRawBytes > pyodidePolicy.budgets.maxRawBytes) {
    failures.push(`${browser} build Pyodide raw bytes ${buildRawBytes} exceed budget ${pyodidePolicy.budgets.maxRawBytes}`);
  }

  const zipEntries = readZipListing(zipFile).filter((entry) =>
    entry.startsWith('pyodide/') && !entry.endsWith('/'),
  );
  const expectedZipEntries = pyodidePolicy.assets.map(({ file }) => `pyodide/${file}`).sort();
  assertExactEntries([...zipEntries].sort(), expectedZipEntries, `${browser} zip Pyodide assets`);

  const zipMetrics = readZipMetrics(zipFile).filter(({ name }) =>
    name.startsWith('pyodide/') && !name.endsWith('/'),
  );
  let zipCompressedBytes = 0;
  const zipInventory = new Map();
  for (const asset of pyodidePolicy.assets) {
    const entry = `pyodide/${asset.file}`;
    const occurrences = zipMetrics.filter((metric) => metric.name === entry);
    if (occurrences.length !== 1) {
      failures.push(`${browser} zip must contain ${entry} exactly once; found ${occurrences.length}`);
      continue;
    }
    const contents = readZipEntry(zipFile, entry);
    if (!contents) continue;
    const metric = occurrences[0];
    const hash = sha256(contents);
    zipCompressedBytes += metric.compressedBytes;
    zipInventory.set(asset.file, { compressedBytes: metric.compressedBytes, hash });
    if (metric.rawBytes !== asset.bytes || contents.byteLength !== asset.bytes) {
      failures.push(`${browser} zip ${entry} raw bytes do not match ${asset.bytes}`);
    }
    if (hash !== asset.sha256) {
      failures.push(`${browser} zip ${entry} SHA-256 ${hash} does not match ${asset.sha256}`);
    }
  }

  if (zipEntries.length !== pyodidePolicy.budgets.assetCount) {
    failures.push(`${browser} zip has ${zipEntries.length} Pyodide assets; budget requires ${pyodidePolicy.budgets.assetCount}`);
  }
  if (zipCompressedBytes > pyodidePolicy.budgets.maxZipCompressedBytes) {
    failures.push(`${browser} zip Pyodide compressed bytes ${zipCompressedBytes} exceed budget ${pyodidePolicy.budgets.maxZipCompressedBytes}`);
  }

  console.log([
    `[pyodide:${browser}]`,
    `count=${buildFiles.length}`,
    `rawBytes=${buildRawBytes}`,
    `zipCompressedBytes=${zipCompressedBytes}`,
  ].join(' '));
  for (const asset of pyodidePolicy.assets) {
    const built = buildInventory.get(asset.file);
    const zipped = zipInventory.get(asset.file);
    if (!built || !zipped) continue;
    console.log([
      `- pyodide/${asset.file}`,
      `bytes=${built.bytes}`,
      `zipCompressedBytes=${zipped.compressedBytes}`,
      `sha256=${built.hash}`,
    ].join(' '));
  }
}

function inspectBundledSkillPackage(browser, zipFile) {
  const buildDir = resolve(distDir, `${browser}-mv3/bundled-skills`);
  const buildManifestPath = resolve(buildDir, 'manifest.json');
  if (!existsSync(buildManifestPath)) {
    failures.push(`${browser} build bundled Skill manifest is missing: ${buildManifestPath}`);
    return;
  }

  const expectedPayloadEntries = Object.entries(bundledSkillGroups)
    .flatMap(([group, paths]) => paths.map((path) => `${group}/${path}`))
    .sort(comparePaths);
  const expectedBuildEntries = ['manifest.json', ...expectedPayloadEntries].sort(comparePaths);
  assertExactEntries(collectFiles(buildDir), expectedBuildEntries, `${browser} build bundled Skill assets`);

  const buildManifest = JSON.parse(readFileSync(buildManifestPath, 'utf8'));
  assertBundledSkillManifest(buildManifest, `${browser} build bundled Skill manifest`);

  const zipEntries = readZipListing(zipFile)
    .filter((entry) => entry.startsWith('bundled-skills/') && !entry.endsWith('/'))
    .map((entry) => entry.slice('bundled-skills/'.length))
    .sort(comparePaths);
  assertExactEntries(zipEntries, expectedBuildEntries, `${browser} zip bundled Skill assets`);
  const zipManifest = readZipJson(zipFile, 'bundled-skills/manifest.json');
  if (zipManifest) assertBundledSkillManifest(zipManifest, `${browser} zip bundled Skill manifest`);

  let rawBytes = 0;
  for (const [group, paths] of Object.entries(bundledSkillGroups)) {
    for (const path of paths) {
      const relativePath = `${group}/${path}`;
      const source = readFileSync(resolve(bundledSkillSourceRoots[group], path));
      const built = readFileSync(resolve(buildDir, relativePath));
      const zipped = readZipEntry(zipFile, `bundled-skills/${relativePath}`);
      rawBytes += built.byteLength;
      if (!source.equals(built)) {
        failures.push(`${browser} build bundled Skill asset changed bytes: ${relativePath}`);
      }
      if (zipped && !source.equals(zipped)) {
        failures.push(`${browser} zip bundled Skill asset changed bytes: ${relativePath}`);
      }
    }
  }

  if (expectedPayloadEntries.length !== bundledSkillPolicy.budget.assetCount) {
    failures.push(`${browser} bundled Skill count ${expectedPayloadEntries.length} does not match ${bundledSkillPolicy.budget.assetCount}`);
  }
  if (rawBytes !== bundledSkillPolicy.budget.assetRawBytes) {
    failures.push(`${browser} bundled Skill bytes ${rawBytes} do not match ${bundledSkillPolicy.budget.assetRawBytes}`);
  }
  console.log(`[bundled-skills:${browser}] count=${expectedPayloadEntries.length} rawBytes=${rawBytes}`);
}

function assertBundledSkillManifest(manifest, label) {
  if (manifest?.schemaVersion !== 1 || !manifest.groups) {
    failures.push(`${label} must use schemaVersion 1`);
    return;
  }
  for (const [group, expectedPaths] of Object.entries(bundledSkillGroups)) {
    assertExactEntries(manifest.groups[group] ?? [], expectedPaths, `${label} ${group}`);
  }
  const unexpectedGroups = Object.keys(manifest.groups)
    .filter((group) => !(group in bundledSkillGroups));
  if (unexpectedGroups.length > 0) {
    failures.push(`${label} has unexpected groups: ${unexpectedGroups.join(', ')}`);
  }
}

function readPyodidePolicy(file) {
  const policy = JSON.parse(readFileSync(file, 'utf8'));
  if (!policy || !Array.isArray(policy.assets) || !policy.budgets) {
    throw new Error(`${file}: invalid Pyodide package policy`);
  }
  if (policy.assets.length !== policy.budgets.assetCount) {
    throw new Error(`${file}: assetCount must match assets.length`);
  }
  const rawBytes = policy.assets.reduce((total, asset) => {
    if (
      !asset ||
      typeof asset.file !== 'string' ||
      !Number.isInteger(asset.bytes) ||
      asset.bytes < 0 ||
      !/^[a-f0-9]{64}$/.test(asset.sha256)
    ) {
      throw new Error(`${file}: invalid Pyodide asset record`);
    }
    return total + asset.bytes;
  }, 0);
  if (!Number.isInteger(policy.budgets.maxRawBytes) || rawBytes > policy.budgets.maxRawBytes) {
    throw new Error(`${file}: raw asset bytes exceed maxRawBytes`);
  }
  if (!Number.isInteger(policy.budgets.maxZipCompressedBytes)) {
    throw new Error(`${file}: maxZipCompressedBytes must be an integer`);
  }
  return policy;
}

function readBundledSkillPolicy(file) {
  const policy = JSON.parse(readFileSync(file, 'utf8'));
  if (
    policy?.schemaVersion !== 1
    || !policy.budget
    || !Number.isInteger(policy.budget.assetCount)
    || !Number.isInteger(policy.budget.assetRawBytes)
  ) {
    throw new Error(`${file}: invalid bundled Skill package policy`);
  }
  return policy;
}

function readZipEntry(zipFile, entry) {
  try {
    return execFileSync('unzip', ['-p', zipFile, entry], { maxBuffer: 32 * 1024 * 1024 });
  } catch (error) {
    failures.push(`${zipFile}: cannot read ${entry}: ${error.message}`);
    return null;
  }
}

function readZipMetrics(zipFile) {
  return execFileSync('unzip', ['-v', zipFile], { encoding: 'utf8' })
    .split('\n')
    .map((line) => line.trim().split(/\s+/))
    .filter((parts) => parts.length >= 8 && /^\d+$/.test(parts[0]) && /^\d+$/.test(parts[2]))
    .map((parts) => ({
      rawBytes: Number(parts[0]),
      compressedBytes: Number(parts[2]),
      name: parts.slice(7).join(' '),
    }));
}

function collectFiles(directory, prefix = '') {
  if (!existsSync(directory)) return [];
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      files.push(...collectFiles(resolve(directory, entry.name), path));
    } else if (entry.isFile()) {
      files.push(path);
    }
  }
  return files.sort(comparePaths);
}

function comparePaths(left, right) {
  return left.localeCompare(right);
}

function assertExactEntries(actual, expected, label) {
  if (actual.length === expected.length && actual.every((entry, index) => entry === expected[index])) return;
  failures.push(`${label} mismatch: actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`);
}

function sha256(contents) {
  return createHash('sha256').update(contents).digest('hex');
}
