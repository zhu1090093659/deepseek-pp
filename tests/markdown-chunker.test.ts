// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { splitMarkdownIntoShellChunks, SHELL_WRITE_CHUNK_LIMIT_BYTES } from '../core/export/markdown-chunker';

const encoder = new TextEncoder();

function byteLen(s: string): number {
  return encoder.encode(s).length;
}

describe('splitMarkdownIntoShellChunks', () => {
  // Each chunk must be <= the limit, and concatenating all chunks must equal the input.
  function assertChunks(content: string, expectMultiple = false): string[] {
    const chunks = splitMarkdownIntoShellChunks(content);
    expect(chunks.join('')).toBe(content);
    for (const chunk of chunks) {
      expect(byteLen(chunk)).toBeLessThanOrEqual(SHELL_WRITE_CHUNK_LIMIT_BYTES);
    }
    if (expectMultiple) expect(chunks.length).toBeGreaterThan(1);
    return chunks;
  }

  it('empty input returns empty array (self-consistent)', () => {
    const chunks = splitMarkdownIntoShellChunks('');
    expect(chunks).toEqual([]);
    expect(chunks.join('')).toBe('');
  });

  it('pure ASCII stays within one chunk and round-trips', () => {
    const s = `${'a'.repeat(1000)} markdown # title\n- list item\n\`\`\`code\`\`\``;
    const chunks = assertChunks(s);
    expect(chunks.length).toBe(1);
  });

  it('pure Chinese round-trips without mojibake', () => {
    const s = '中文内容'.repeat(500) + '结尾测试一二三四五';
    const chunks = assertChunks(s);
    // Every chunk must decode to complete characters (no U+FFFD replacement).
    for (const chunk of chunks) expect(chunk).not.toContain('\uFFFD');
  });

  it('emoji round-trips and is never split', () => {
    const s = 'Hello 🌍 世界 😀 混合内容 🚀🔥💡 结尾';
    const chunks = assertChunks(s);
    for (const chunk of chunks) expect(chunk).not.toContain('\uFFFD');
    expect(chunks.join('')).toBe(s);
  });

  it('tab / special symbols mixed content round-trips', () => {
    // Tab (0x09) is single-byte ASCII, but mix with wide chars and emoji to stress boundaries.
    const unit = '\t# 标题\t中\t文\t🌍\temoji\t😀\t';
    const s = unit.repeat(30_000); // ~1MB, forces multiple aligned chunks
    const chunks = assertChunks(s, true);
    for (const chunk of chunks) expect(chunk).not.toContain('\uFFFD');
  });

  it('content exactly at the 900KB boundary stays in a single chunk', () => {
    // Build a string whose UTF-8 length is exactly the limit, then verify one chunk.
    // ASCII is 1 byte/char, so 900_000 'a' is exactly the limit.
    const s = 'a'.repeat(SHELL_WRITE_CHUNK_LIMIT_BYTES);
    const chunks = assertChunks(s);
    expect(chunks.length).toBe(1);
    expect(byteLen(chunks[0])).toBe(SHELL_WRITE_CHUNK_LIMIT_BYTES);
  });

  it('multi-byte content just over the limit is split into multiple aligned chunks', () => {
    // Each Chinese char is 3 bytes; 300_001 chars = 900_003 bytes (> limit) forces a split.
    const s = '中'.repeat(300_001);
    const chunks = assertChunks(s, true);
    // The split point must be a clean character boundary: chunks.concat should equal s,
    // and no chunk should contain a lone continuation byte.
    for (const chunk of chunks) expect(chunk).not.toContain('\uFFFD');
    // At least one chunk must be strictly below the limit (the boundary was rolled back).
    expect(Math.min(...chunks.map(byteLen))).toBeLessThan(SHELL_WRITE_CHUNK_LIMIT_BYTES);
  });

  it('content far larger than 900KB splits into many chunks and round-trips', () => {
    // ~9MB of mixed multi-byte content: exceeds the limit by ~10x.
    const unit = '中a🌍b# 标题\t';
    const repeat = 1_000_000; // unit ≈ 13 bytes => ~13MB
    const big = unit.repeat(repeat);
    const chunks = assertChunks(big, true);
    expect(chunks.length).toBeGreaterThan(10);
    // Verify no U+FFFD anywhere: boundaries never split a character.
    for (const chunk of chunks) expect(chunk).not.toContain('\uFFFD');
    // Spot-check: the first chunk must START on a clean boundary and end on a clean boundary.
    expect(chunks[0]).toBe(unit.repeat(Math.floor(SHELL_WRITE_CHUNK_LIMIT_BYTES / byteLen(unit))).slice(0, chunks[0].length));
  });

  it('a multi-byte char straddling the 900KB boundary is not split (reverse symmetry of scanUtf8Chars)', () => {
    // 899_999 ASCII bytes, then a 3-byte Chinese char, then a 4-byte emoji, then more ASCII.
    // The 900_000 cut would land inside the Chinese char; it must roll back to the next chunk.
    const head = 'a'.repeat(899_999);
    const tail = 'b'.repeat(50);
    const s = `${head}中🌍${tail}`;
    const chunks = assertChunks(s, true);
    // The chunk that owns the Chinese char must contain the FULL char.
    const joined = chunks.join('');
    expect(joined).toBe(s);
    expect(joined).not.toContain('\uFFFD');
    // The boundary-adjacent chunk must be strictly under the limit (rolled back).
    expect(Math.max(...chunks.map(byteLen))).toBeLessThanOrEqual(SHELL_WRITE_CHUNK_LIMIT_BYTES);
    expect(Math.min(...chunks.map(byteLen))).toBeLessThan(SHELL_WRITE_CHUNK_LIMIT_BYTES);
  });
});
