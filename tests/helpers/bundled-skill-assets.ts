import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const extensionOrigin = 'chrome-extension://test-extension/';

const groups = {
  officecli: collectAssetPaths(
    resolve(rootDir, 'core/skill/officecli-official'),
    (path) => /^skills\/[^/]+\/SKILL\.md$/.test(path) || path === 'styles/INDEX.md',
  ),
  'spec-driven-develop': collectAssetPaths(
    resolve(rootDir, 'core/skill/spec-driven-develop-official'),
    (path) => /\.(?:md|py|sh|js)$/.test(path),
  ),
};

export function getBundledSkillAssetUrl(path: string): string {
  return new URL(path, extensionOrigin).href;
}

export async function fetchBundledSkillAsset(input: string | URL | Request): Promise<Response> {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  if (url.protocol !== 'chrome-extension:' || url.host !== 'test-extension') {
    return new Response('', { status: 404 });
  }
  const path = url.pathname.slice(1);
  if (path === 'bundled-skills/manifest.json') {
    return new Response(JSON.stringify({ schemaVersion: 1, groups }), { status: 200 });
  }

  for (const [group, sourceRoot] of [
    ['officecli', 'officecli-official'],
    ['spec-driven-develop', 'spec-driven-develop-official'],
  ] as const) {
    const prefix = `bundled-skills/${group}/`;
    if (!path.startsWith(prefix)) continue;
    const relativePath = path.slice(prefix.length);
    if (!groups[group].includes(relativePath)) return new Response('', { status: 404 });
    return new Response(
      readFileSync(resolve(rootDir, `core/skill/${sourceRoot}`, relativePath)),
      { status: 200 },
    );
  }

  return new Response('', { status: 404 });
}

function collectAssetPaths(
  directory: string,
  include: (relativePath: string) => boolean,
  prefix = '',
): string[] {
  const paths: string[] = [];
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
