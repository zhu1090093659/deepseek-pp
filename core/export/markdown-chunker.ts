// Markdown chunker for the shell-host local-file write path.
//
// The Native Host `local_file_write` (packages/shell-host/native/file-provider.mjs)
// rejects a single call whose UTF-8 byte length exceeds MAX_LOCAL_FILE_WRITE_BYTES
// (900_000). To write arbitrarily large Markdown, the caller must split the string
// into chunks each <= that limit and stream them with append=true.
//
// This module performs the WRITE-side counterpart of the read-side boundary logic
// in file-provider.mjs `scanUtf8Chars` / `incompleteTailBytes`:
//   - read side:  an incomplete multi-byte tail at a disk window is rolled back and
//                 re-read in the next window (char stays intact, shifted right).
//   - write side: when a slice boundary falls inside a multi-byte char (emoji /
//                 Chinese / tab / etc.), the straddling char is rolled back to the
//                 START of the NEXT chunk, so the current chunk is cut a little
//                 shorter (never longer than the limit) and every chunk boundary
//                 aligns to a complete UTF-8 code point. No character is ever split.
//
// Pure function: no I/O, no project imports, fully unit-testable in isolation.

// Mirror of MAX_LOCAL_FILE_WRITE_BYTES from packages/shell-host/native/file-provider.mjs.
export const SHELL_WRITE_CHUNK_LIMIT_BYTES = 900_000;

// Split a Markdown string into chunks whose UTF-8 byte length is <= SHELL_WRITE_CHUNK_LIMIT_BYTES.
// Each chunk boundary is aligned to a complete character; joining all chunks yields the
// original content exactly. An empty input returns an empty array (self-consistent: []).join('') === ''.
export function splitMarkdownIntoShellChunks(content: string): string[] {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const bytes = encoder.encode(content);
  const total = bytes.length;
  if (total === 0) return [];

  const chunks: string[] = [];
  let start = 0;

  while (start < total) {
    // Candidate cut: as far as the limit allows, but never past EOF.
    let cut = Math.min(start + SHELL_WRITE_CHUNK_LIMIT_BYTES, total);

    // If the cut is not at EOF and lands on a continuation byte (0x80-0xBF),
    // a multi-byte character straddles the boundary. Roll the straddling char
    // back to the start of the next chunk by walking the cut back to its lead byte.
    // The limit is 900_000 >> 4 bytes, so this can never back up to `start`.
    if (cut < total && (bytes[cut] & 0xc0) === 0x80) {
      while (cut > start && (bytes[cut] & 0xc0) === 0x80) cut--;
    }

    chunks.push(decoder.decode(bytes.subarray(start, cut)));
    start = cut;
  }

  return chunks;
}
