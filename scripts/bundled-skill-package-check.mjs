#!/usr/bin/env node
import { gzipSync } from 'node:zlib';
import {
  existsSync,
  readFileSync,
  readdirSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packagePolicy = JSON.parse(readFileSync(
  resolve(rootDir, 'scripts/bundled-skill-package-policy.json'),
  'utf8',
));
const requestedTargets = process.argv.slice(2);
const targets = requestedTargets.length > 0
  ? requestedTargets
  : ['chrome-mv3', 'edge-mv3', 'firefox-mv3'];
const expectedGroups = {
  officecli: collectAssetPaths(
    resolve(rootDir, 'core/skill/officecli-official'),
    (path) => /^skills\/[^/]+\/SKILL\.md$/.test(path) || path === 'styles/INDEX.md',
  ),
  'spec-driven-develop': collectAssetPaths(
    resolve(rootDir, 'core/skill/spec-driven-develop-official'),
    (path) => /\.(?:md|py|sh|js)$/.test(path),
  ),
};
const sourceRoots = {
  officecli: resolve(rootDir, 'core/skill/officecli-official'),
  'spec-driven-develop': resolve(rootDir, 'core/skill/spec-driven-develop-official'),
};
const leakedResourceMarkers = [
  'Use this skill any time a .docx file is involved',
  'Data Dashboard: Visual Storytelling',
  'def run_git',
  'S.U.P.E.R',
  'Bundled Reference: references/behavioral-rules.md',
];
const failures = [];

for (const target of targets) {
  const outputDir = resolve(rootDir, 'dist', target);
  const manifestPath = resolve(outputDir, 'bundled-skills/manifest.json');
  const backgroundPath = resolve(outputDir, 'background.js');
  if (!existsSync(manifestPath) || !existsSync(backgroundPath)) {
    failures.push(`${target}: build output is missing; run its browser build first`);
    continue;
  }

  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    failures.push(`${target}: cannot parse bundled Skill manifest: ${error.message}`);
    continue;
  }
  if (manifest.schemaVersion !== 1 || !manifest.groups) {
    failures.push(`${target}: bundled Skill manifest must use schemaVersion 1`);
    continue;
  }

  let assetCount = 0;
  let assetRawBytes = 0;
  for (const [group, expectedPaths] of Object.entries(expectedGroups)) {
    const actualPaths = manifest.groups[group];
    if (JSON.stringify(actualPaths) !== JSON.stringify(expectedPaths)) {
      failures.push(`${target}: ${group} asset manifest does not match source inventory`);
      continue;
    }
    for (const path of expectedPaths) {
      const source = readFileSync(resolve(sourceRoots[group], path));
      const outputPath = resolve(outputDir, 'bundled-skills', group, path);
      if (!existsSync(outputPath)) {
        failures.push(`${target}: missing bundled Skill asset ${group}/${path}`);
        continue;
      }
      const output = readFileSync(outputPath);
      if (!source.equals(output)) {
        failures.push(`${target}: bundled Skill asset changed bytes ${group}/${path}`);
      }
      assetCount += 1;
      assetRawBytes += output.length;
    }
  }

  if (assetCount !== packagePolicy.budget.assetCount) {
    failures.push(`${target}: asset count ${assetCount} exceeds exact budget ${packagePolicy.budget.assetCount}`);
  }
  if (assetRawBytes !== packagePolicy.budget.assetRawBytes) {
    failures.push(`${target}: asset bytes ${assetRawBytes} differ from exact budget ${packagePolicy.budget.assetRawBytes}`);
  }

  const background = readFileSync(backgroundPath);
  const backgroundText = background.toString('utf8');
  const backgroundGzipBytes = gzipSync(background).length;
  if (background.length > packagePolicy.budget.backgroundRawBytesMax) {
    failures.push(`${target}: background raw bytes ${background.length} exceed ${packagePolicy.budget.backgroundRawBytesMax}`);
  }
  if (backgroundGzipBytes > packagePolicy.budget.backgroundGzipBytesMax) {
    failures.push(`${target}: background gzip bytes ${backgroundGzipBytes} exceed ${packagePolicy.budget.backgroundGzipBytesMax}`);
  }
  for (const marker of leakedResourceMarkers) {
    if (backgroundText.includes(marker)) {
      failures.push(`${target}: background still embeds bundled Skill resource marker ${JSON.stringify(marker)}`);
    }
  }

  const rawReduction = packagePolicy.baseline.backgroundRawBytes - background.length;
  const gzipReduction = packagePolicy.baseline.backgroundGzipBytes - backgroundGzipBytes;
  console.log(
    `${target}: ${assetCount} assets / ${assetRawBytes} B; background ${background.length} B raw, `
    + `${backgroundGzipBytes} B gzip; reductions ${rawReduction} B raw / ${gzipReduction} B gzip`,
  );
}

if (failures.length > 0) {
  console.error('Bundled Skill package check failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('Bundled Skill package check passed');

function collectAssetPaths(directory, include, prefix = '') {
  const paths = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      paths.push(...collectAssetPaths(resolve(directory, entry.name), include, relativePath));
    } else if (entry.isFile() && include(relativePath)) {
      paths.push(relativePath);
    }
  }
  return paths.sort((left, right) => left.localeCompare(right));
}
