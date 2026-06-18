#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const androidDir = resolve(root, 'android');
const args = process.argv.slice(2);

if (args.length === 0) {
  fail('No Gradle task was provided. Example: npm run android:assemble:debug');
}

const javaCheck = spawnSync('java', ['-version'], { encoding: 'utf8' });
if (javaCheck.status !== 0) {
  fail([
    'Java runtime is not available, so Android Gradle cannot run.',
    trimOutput(javaCheck.stderr || javaCheck.stdout),
    'Install a JDK and retry.',
  ].filter(Boolean).join('\n'));
}

const gradlew = resolve(androidDir, process.platform === 'win32' ? 'gradlew.bat' : 'gradlew');
const command = existsSync(gradlew)
  ? gradlew
  : commandExists('gradle')
    ? 'gradle'
    : null;

if (!command) {
  fail('Gradle is not available. Add android/gradlew or install Gradle on PATH.');
}

const result = spawnSync(command, args, {
  cwd: androidDir,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

process.exit(result.status ?? 1);

function commandExists(commandName) {
  const result = spawnSync(commandName, ['--version'], {
    encoding: 'utf8',
    stdio: 'ignore',
  });
  return result.status === 0;
}

function trimOutput(value) {
  return String(value ?? '').trim().split(/\r?\n/).slice(0, 4).join('\n');
}

function fail(message) {
  console.error(`Android Gradle task failed: ${message}`);
  process.exit(1);
}
