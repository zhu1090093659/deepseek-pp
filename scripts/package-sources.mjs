#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const packageJson = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const version = packageJson.version;

if (typeof version !== 'string' || version.length === 0) {
  throw new Error('package.json version is required');
}

const distDir = resolve(root, 'dist');
const output = resolve(distDir, `deepseek-plus-plus-${version}-sources.zip`);

execFileSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: root, stdio: 'ignore' });

const status = execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim();
if (status && process.env.CI === 'true') {
  throw new Error('Source package requires a clean git tree in CI');
}
if (status) {
  console.warn('Source package uses git archive HEAD; uncommitted changes are not included.');
}

mkdirSync(distDir, { recursive: true });
rmSync(output, { force: true });
execFileSync('git', ['archive', '--format=zip', '--output', output, 'HEAD'], {
  cwd: root,
  stdio: 'inherit',
});

console.log(`Created ${output}`);
