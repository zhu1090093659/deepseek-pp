import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

// Regression guard for the packaging manifest: every local `require('./x.cjs')`
// from a packaged desktop script must be listed in desktop/package.json
// build.files, otherwise electron-builder omits the module and the packaged app
// crashes at startup with MODULE_NOT_FOUND (this happened with store-crypto.cjs,
// and earlier with navigation-guard.cjs / preload-sidebar.cjs).

const DESKTOP_DIR = resolve(__dirname, '..', 'desktop');

function localCjsRequires(source: string): string[] {
  const out = new Set<string>();
  const re = /require\(\s*['"`]\.\/([^'"`]+\.cjs)['"`]\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) out.add(m[1]);
  return [...out];
}

function isCovered(target: string, files: string[]): boolean {
  return files.includes(target) || files.includes('*.cjs') || files.includes('**/*.cjs');
}

describe('desktop packaging manifest (build.files)', () => {
  const pkg = JSON.parse(readFileSync(resolve(DESKTOP_DIR, 'package.json'), 'utf8'));
  const files: string[] = pkg.build?.files ?? [];

  // Top-level .cjs files are the packaged runtime scripts (subdirs like
  // scripts/ are build-time only and intentionally excluded).
  const topLevelCjs = readdirSync(DESKTOP_DIR).filter((f) => f.endsWith('.cjs'));

  it('lists the main entry and store-crypto.cjs', () => {
    expect(files).toContain('main.cjs');
    expect(files).toContain('store-crypto.cjs');
  });

  it('includes every local require(\'./*.cjs\') reachable from packaged scripts', () => {
    const missing: string[] = [];
    for (const file of topLevelCjs) {
      // Only scan scripts that are themselves packaged (listed in build.files).
      if (!isCovered(file, files)) continue;
      const source = readFileSync(resolve(DESKTOP_DIR, file), 'utf8');
      for (const required of localCjsRequires(source)) {
        if (!isCovered(required, files)) missing.push(`${file} -> ${required}`);
      }
    }
    expect(missing, `local .cjs requires missing from build.files: ${missing.join(', ')}`).toEqual([]);
  });
});
