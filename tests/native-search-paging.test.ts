import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let provider: {
  createFileToolHandlers: (ctx: { logLine: () => void }) => Array<{
    name: string;
    handle: (args: Record<string, unknown>) => Record<string, unknown>;
  }>;
};
let file: string;
let tempDir: string;

function search(args: Record<string, unknown>) {
  const handler = provider.createFileToolHandlers({ logLine: () => {} })
    .find((h) => h.name === 'local_file_search')!;
  return handler.handle(args) as {
    isError?: boolean;
    content?: Array<{ text: string }>;
    structuredContent?: { ok: boolean; data: Record<string, unknown> };
  };
}

beforeAll(async () => {
  // @ts-expect-error native ES module has no type declarations
  provider = await import('../packages/shell-host/native/file-provider.mjs');
  tempDir = mkdtempSync(join(tmpdir(), 'dpp-search-paging-'));
  file = join(tempDir, 'search-paging.txt');

  const lines: string[] = [];
  for (let i = 1; i <= 5000; i++) {
    const target = i % 5 === 0 ? 'SAME_TARGET_ALPHA' : 'abcdefghijklmnopqrstuvwxyz';
    lines.push(`LINE_${String(i).padStart(4, '0')}_${target}`);
  }
  writeFileSync(file, lines.join('\n') + '\n', 'utf8');
});

afterAll(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe('local_file_search pagination', () => {
  it('returns first page with offset=0,max_results=100', () => {
    const r = search({ path: file, query: 'SAME_TARGET_ALPHA', offset: 0, max_results: 100 });
    const d = r.structuredContent!.data;
    expect(d.totalMatches).toBe(1000);
    expect(d.returnedMatches).toBe(100);
    expect(d.nextOffset).toBe(100);
    expect(d.hasMore).toBe(true);
    expect(d.truncated).toBe(true);
    const matches = d.matches as Array<{ line: number }>;
    expect(matches[0].line).toBe(5);
    expect(matches[99].line).toBe(500);
  });

  it('returns 101~200 on offset=100', () => {
    const r = search({ path: file, query: 'SAME_TARGET_ALPHA', offset: 100, max_results: 100 });
    const d = r.structuredContent!.data;
    expect(d.returnedMatches).toBe(100);
    expect(d.nextOffset).toBe(200);
    expect(d.hasMore).toBe(true);
    const matches = d.matches as Array<{ line: number }>;
    expect(matches[0].line).toBe(505);
    expect(matches[99].line).toBe(1000);
  });

  it('returns final page on offset=900', () => {
    const r = search({ path: file, query: 'SAME_TARGET_ALPHA', offset: 900, max_results: 100 });
    const d = r.structuredContent!.data;
    expect(d.returnedMatches).toBe(100);
    expect(d.hasMore).toBe(false);
    expect(d.nextOffset).toBeNull();
    expect(d.truncated).toBe(false);
    const matches = d.matches as Array<{ line: number }>;
    expect(matches[0].line).toBe(4505);
    expect(matches[99].line).toBe(5000);
  });

  it('returns empty on offset=1000 (equal totalMatches)', () => {
    const r = search({ path: file, query: 'SAME_TARGET_ALPHA', offset: 1000, max_results: 100 });
    const d = r.structuredContent!.data;
    expect(d.totalMatches).toBe(1000);
    expect(d.returnedMatches).toBe(0);
    expect(d.matches).toEqual([]);
    expect(d.hasMore).toBe(false);
    expect(d.nextOffset).toBeNull();
    expect(d.truncated).toBe(false);
  });

  it('returns empty on offset beyond totalMatches', () => {
    const r = search({ path: file, query: 'SAME_TARGET_ALPHA', offset: 5000, max_results: 100 });
    const d = r.structuredContent!.data;
    expect(d.totalMatches).toBe(1000);
    expect(d.returnedMatches).toBe(0);
    expect(d.hasMore).toBe(false);
    expect(d.nextOffset).toBeNull();
  });

  it('fails closed when expected_sha256 mismatches', () => {
    const r = search({
      path: file,
      query: 'SAME_TARGET_ALPHA',
      offset: 100,
      max_results: 100,
      expected_sha256: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    });
    expect(r.isError).toBe(true);
    expect(r.content![0].text).toBe('file changed during local_file_search; search the file again');
  });

  it('keeps regex paging stable with offset', () => {
    const r = search({ path: file, query: 'SAME_TARGET', use_regex: true, offset: 10, max_results: 5 });
    const d = r.structuredContent!.data;
    expect(d.totalMatches).toBe(1000);
    expect(d.returnedMatches).toBe(5);
    expect(d.offset).toBe(10);
    expect(d.nextOffset).toBe(15);
    const matches = d.matches as Array<{ line: number }>;
    expect(matches[0].line).toBe(55);
  });
});
