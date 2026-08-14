import { createHash, randomUUID } from 'node:crypto';
import {
  closeSync,
  fstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  readSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';

import { homedir } from 'node:os';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import {
  DEFAULT_LOCAL_FILE_READ_CHARS,
  MAX_LOCAL_FILE_READ_CHARS,
  MAX_LOCAL_FILE_WRITE_BYTES,
} from './contracts.mjs';
import { formatBytes } from './logger.mjs';

export function createFileToolHandlers({ logLine }) {
  return [
    { name: 'local_file_stat', handle: createLocalFileStatResult },
    { name: 'local_file_read', handle: createLocalFileReadResult },
    { name: 'local_file_write', handle: args => createLocalFileWriteResult(args, logLine) },
    { name: 'local_file_edit', handle: args => createLocalFileEditResult(args, logLine) },
    { name: 'local_file_search', handle: args => createLocalFileSearchResult(args, logLine) },
  ];
}

function createLocalFileStatResult(args) {
  const inputPath = typeof args?.path === 'string' ? args.path.trim() : '';
  if (!inputPath) return toolError('path is required and must be a non-empty string.');

  try {
    const resolvedPath = resolveLocalPath(inputPath);
    const stat = safeStat(resolvedPath);
    return {
      content: [{ type: 'text', text: stat ? `Local path exists: ${resolvedPath}` : `Local path does not exist: ${resolvedPath}` }],
      structuredContent: {
        ok: true,
        data: {
          path: resolvedPath,
          exists: Boolean(stat),
          isFile: stat?.isFile() === true,
          isDirectory: stat?.isDirectory() === true,
          sizeBytes: stat?.size ?? 0,
          modifiedAt: stat?.mtimeMs ?? null,
        },
      },
    };
  } catch (error) {
    return toolError(errorMessage(error));
  }
}

function createLocalFileReadResult(args) {
  const inputPath = typeof args?.path === 'string' ? args.path.trim() : '';
  if (!inputPath) return toolError('path is required and must be a non-empty string.');

  // 检测行模式
  const mode = args?.mode === 'lines' ? 'lines' : 'chars';
  const startLine = typeof args?.start_line === 'number' && args.start_line >= 1 ? Math.floor(args.start_line) : 1;
  const endLine = typeof args?.end_line === 'number' && args.end_line >= 1 ? Math.floor(args.end_line) : undefined;

  // 字符模式参数
  const start = typeof args?.start === 'number' && args.start >= 0 ? Math.floor(args.start) : 0;
  const maxChars = typeof args?.max_chars === 'number' && args.max_chars >= 1
    ? Math.min(Math.floor(args.max_chars), MAX_LOCAL_FILE_READ_CHARS)
    : DEFAULT_LOCAL_FILE_READ_CHARS;

  try {
    const resolvedPath = resolveLocalPath(inputPath);
    const stat = safeStat(resolvedPath);
    if (!stat || !stat.isFile()) throw new Error(`Local file is not readable: ${resolvedPath}`);

    let result;
    if (mode === 'lines') {
      const lineResult = readTextFileLines(resolvedPath, startLine, endLine);
      result = {
        content: lineResult.content,
        startLine: lineResult.startLine,
        endLine: lineResult.endLine,
        totalLines: lineResult.totalLines,
        totalChars: lineResult.totalChars,
        lineEnding: lineResult.lineEnding,
      };
    } else {
      const { content, totalChars, charsRead } = readTextFileWindow(resolvedPath, start, maxChars);
      result = {
        content,
        totalChars,
        charsRead,
        startLine: undefined,
        endLine: undefined,
        nextStart: start + charsRead,
      };
    }

    const sha256 = hashFileSha256(resolvedPath);
    const nextStart = mode === 'lines'
      ? (result.endLine < result.totalLines ? result.endLine + 1 : null)
      : result.nextStart;
    const hasMore = mode === 'lines'
      ? (result.endLine < result.totalLines)
      : (nextStart < result.totalChars);

    return {
      content: [{ type: 'text', text: `Read ${result.content.length} characters from ${resolvedPath}` }],
      structuredContent: {
        ok: true,
        data: {
          path: resolvedPath,
          content: result.content,
          startLine: result.startLine ?? undefined,
          endLine: result.endLine ?? undefined,
          totalLines: result.totalLines,
          totalChars: result.totalChars,
          sizeBytes: stat.size,
          sha256,
          hasMore,
          nextStart: nextStart,
          lineEnding: result.lineEnding,
          mode,
        },
      },
    };
  } catch (error) {
    return toolError(errorMessage(error));
  }
}

function createLocalFileWriteResult(args, logLine) {
  const inputPath = typeof args?.path === 'string' ? args.path.trim() : '';
  if (!inputPath) return toolError('path is required and must be a non-empty string.');
  if (typeof args?.content !== 'string') return toolError('content is required and must be a string.');

  try {
    const resolvedPath = resolveLocalPath(inputPath);
    const content = args.content;
    const contentBytes = Buffer.byteLength(content, 'utf8');
    if (contentBytes > MAX_LOCAL_FILE_WRITE_BYTES) {
      logLine(`local_file_write REJECTED path=${resolvedPath} contentBytes=${contentBytes} limit=${MAX_LOCAL_FILE_WRITE_BYTES}`);
      throw new Error(
        `Content exceeds the local file write limit (${formatBytes(contentBytes)} > ${formatBytes(MAX_LOCAL_FILE_WRITE_BYTES)}). Write the file in chunks: send the first section now, then call local_file_write again with append=true for each remaining section.`,
      );
    }

    const append = args?.append === true;
    const createDirectories = args?.create_directories !== false;
    const parentDir = dirname(resolvedPath);
    if (createDirectories) mkdirSync(parentDir, { recursive: true });
    else if (!safeStat(parentDir)?.isDirectory()) throw new Error(`Parent directory does not exist: ${parentDir}`);

    writeFileSync(resolvedPath, content, { encoding: 'utf8', flag: append ? 'a' : 'w' });
    const sizeAfter = safeStat(resolvedPath)?.size ?? null;
    const sizeMatch = sizeAfter === null ? false : (append ? sizeAfter >= contentBytes : sizeAfter === contentBytes);
    logLine(`local_file_write OK path=${resolvedPath} append=${append} bytesWritten=${contentBytes} sizeOnDisk=${sizeAfter} sizeMatch=${sizeMatch}`);

    return {
      content: [{ type: 'text', text: `${append ? 'Appended' : 'Wrote'} ${contentBytes} bytes to ${resolvedPath}` }],
      structuredContent: {
        ok: true,
        data: { path: resolvedPath, append, bytesWritten: contentBytes, sizeBytes: sizeAfter ?? contentBytes },
      },
    };
  } catch (error) {
    logLine(`local_file_write ERROR path=${inputPath} error=${errorMessage(error)}`);
    return toolError(errorMessage(error));
  }
}

function createLocalFileEditResult(args, logLine) {
  const inputPath = typeof args?.path === 'string' ? args.path.trim() : '';

  try {
    const plan = prepareLocalFileEdit(args);
    const result = applyPreparedLocalFileEdit(plan);

    logLine(
      `local_file_edit OK path=${result.path} replacements=${result.replacements} ` +
      `bytesBefore=${result.bytesBefore} bytesAfter=${result.bytesAfter} ` +
      `sha256Before=${result.sha256Before} sha256After=${result.sha256After}`,
    );

    return {
      content: [{
        type: 'text',
        text: `Edited ${result.path}: ${result.replacements} exact replacement.`,
      }],
      structuredContent: {
        ok: true,
        data: result,
      },
    };
  } catch (error) {
    logLine(
      `local_file_edit ERROR path=${inputPath} error=${errorMessage(error)}`,
    );

    return toolError(errorMessage(error));
  }
}

function createLocalFileSearchResult(args, logLine) {
  const inputPath = typeof args?.path === 'string' ? args.path.trim() : '';
  if (!inputPath) return toolError('path is required and must be a non-empty string.');

  const query = typeof args?.query === 'string' ? args.query.trim() : '';
  if (!query) return toolError('query is required and must be a non-empty string.');

  const caseSensitive = args?.case_sensitive !== false;
  const useRegex = args?.use_regex === true;
  const maxResults = typeof args?.max_results === 'number' && args.max_results >= 1
    ? Math.min(Math.floor(args.max_results), 100)
    : 10;
  const contextLines = typeof args?.context_lines === 'number' && args.context_lines >= 0
    ? Math.min(Math.floor(args.context_lines), 50)
    : 0;
  const offset = typeof args?.offset === 'number' && args.offset >= 0
    ? Math.floor(args.offset)
    : 0;
  const expectedSha256 = typeof args?.expected_sha256 === 'string'
    ? args.expected_sha256.trim().toLowerCase()
    : '';

  try {
    const resolvedPath = resolveLocalPath(inputPath);
    const stat = safeStat(resolvedPath);
    if (!stat || !stat.isFile()) throw new Error(`Local file is not readable: ${resolvedPath}`);

    const fd = openSync(resolvedPath, 'r');
    try {
      const before = fstatSync(fd);
      const totalBytes = before.size;
      const sha256 = hashFdSha256(fd);
      if (expectedSha256 && expectedSha256 !== sha256) {
        throw new Error('file changed during local_file_search; search the file again');
      }

    let searchFn;
    if (useRegex) {
      // No global flag: g keeps lastIndex across .test() calls and misses matches.
      const flags = caseSensitive ? '' : 'i';
      const regex = new RegExp(query, flags);
      searchFn = (line) => regex.test(line);
    } else {
      const searchStr = caseSensitive ? query : query.toLowerCase();
      searchFn = (line) => {
        const compare = caseSensitive ? line : line.toLowerCase();
        return compare.includes(searchStr);
      };
    }

      const matches = [];
      const pending = [];
      const beforeRing = [];
      const collectStart = offset;
      const collectLimit = offset + maxResults;
      let totalMatches = 0;
      let totalLines = 0;

      for (const line of iterLinesByByte(fd, totalBytes)) {
        totalLines++;

        if (contextLines > 0) {
          for (let j = pending.length - 1; j >= 0; j--) {
            pending[j].after.push(line);
            pending[j].afterRemaining--;
            if (pending[j].afterRemaining <= 0) {
              const m = pending.splice(j, 1)[0];
              matches.push({
                line: m.line,
                content: m.content,
                context: { before: m.before, after: m.after },
              });
            }
          }
        }

        if (searchFn(line)) {
          const matchIndex = totalMatches;
          totalMatches++;

          if (matchIndex >= collectStart && matchIndex < collectLimit) {
            if (contextLines > 0) {
              pending.push({
                line: totalLines,
                content: line,
                before: beforeRing.slice(),
                after: [],
                afterRemaining: contextLines,
              });
            } else {
              matches.push({ line: totalLines, content: line });
            }
          }
        }

        if (contextLines > 0) {
          beforeRing.push(line);
          if (beforeRing.length > contextLines) beforeRing.shift();
        }
      }

      for (const m of pending) {
        matches.push({
          line: m.line,
          content: m.content,
          context: { before: m.before, after: m.after },
        });
      }

      const returnedMatches = matches.length;
      const hasMore = offset + returnedMatches < totalMatches;
      const nextOffset = hasMore ? offset + returnedMatches : null;
      const truncated = hasMore;

      const after = fstatSync(fd);
      if (
        after.size !== before.size
        || after.mtimeMs !== before.mtimeMs
        || after.ctimeMs !== before.ctimeMs
      ) {
        throw new Error('file changed during local_file_search; search the file again');
      }

      logLine(`local_file_search OK path=${resolvedPath} query=${query} matches=${totalMatches} returned=${matches.length} truncated=${truncated}`);

      const summary = totalMatches === 0
        ? `No matches found for ${JSON.stringify(query)} in ${resolvedPath} (searched ${totalLines} lines).`
        : `Found ${totalMatches} match${totalMatches !== 1 ? 'es' : ''} for ${JSON.stringify(query)} in ${resolvedPath}${hasMore ? ` (showing first ${returnedMatches}, next offset ${nextOffset})` : ''}.`;

      return {
        content: [{ type: 'text', text: summary }],
        structuredContent: {
          ok: true,
          data: {
            path: resolvedPath,
            matches,
            totalMatches,
            offset,
            returnedMatches,
            nextOffset,
            hasMore,
            truncated,
            sha256,
            totalLines,
            query,
            caseSensitive,
            useRegex,
          },
        },
      };
    } finally {
      closeSync(fd);
    }
  } catch (error) {
    logLine(`local_file_search ERROR path=${inputPath} error=${errorMessage(error)}`);
    return toolError(errorMessage(error));
  }
}

function* iterLinesByByte(fd, totalBytes) {
  const chunkSize = 64 * 1024;
  let bytePos = 0;
  let carry = Buffer.alloc(0);

  while (bytePos < totalBytes) {
    const want = Math.min(chunkSize, totalBytes - bytePos);
    const buf = Buffer.alloc(want);
    const got = readSync(fd, buf, 0, want, bytePos);
    if (got === 0) break;
    bytePos += got;
    const atEof = bytePos >= totalBytes;
    const combined = Buffer.concat([carry, buf.subarray(0, got)]);
    let lineStart = 0;
    for (let i = 0; i < combined.length; i++) {
      if (combined[i] !== 0x0A) continue;
      let end = i;
      if (end > lineStart && combined[end - 1] === 0x0D) end--;
      yield combined.subarray(lineStart, end).toString('utf8');
      lineStart = i + 1;
    }
    if (atEof) {
      if (lineStart < combined.length) {
        let end = combined.length;
        if (end > lineStart && combined[end - 1] === 0x0D) end--;
        yield combined.subarray(lineStart, end).toString('utf8');
      }
      carry = Buffer.alloc(0);
    } else {
      carry = combined.subarray(lineStart);
    }
  }
}

export function resolveLocalPath(input) {
  const trimmed = input.trim();
  if (trimmed === '~') return homedir();
  if (trimmed.startsWith('~/') || trimmed.startsWith('~\\')) return resolve(homedir(), trimmed.slice(2));
  return resolve(trimmed);
}

export function resolveUnderRoot(rootPath, relativePath) {
  const resolved = resolve(rootPath, relativePath);
  const rel = relative(rootPath, resolved);
  if (rel.startsWith('..') || rel === '..' || isAbsolute(rel)) {
    throw new Error(`Path escapes local Skill root: ${relativePath}`);
  }
  return resolved;
}

export function readTextFile(filePath) {
  return readFileSync(filePath, 'utf8');
}

function hashFdSha256(fd) {
  const hash = createHash('sha256');
  const buffer = Buffer.alloc(256 * 1024);
  let position = 0;

  while (true) {
    const bytesRead = readSync(
      fd,
      buffer,
      0,
      buffer.length,
      position,
    );

    if (bytesRead === 0) break;

    hash.update(buffer.subarray(0, bytesRead));
    position += bytesRead;
  }

  return hash.digest('hex');
}

function hashFileSha256(filePath) {
  const hash = createHash('sha256');
  const fd = openSync(filePath, 'r');

  try {
    const buffer = Buffer.alloc(256 * 1024);
    let position = 0;

    while (true) {
      const bytesRead = readSync(
        fd,
        buffer,
        0,
        buffer.length,
        position,
      );

      if (bytesRead === 0) break;

      hash.update(buffer.subarray(0, bytesRead));
      position += bytesRead;
    }

    return hash.digest('hex');
  } finally {
    closeSync(fd);
  }
}

export function prepareLocalFileEdit(args) {
  const inputPath = typeof args?.path === 'string' ? args.path.trim() : '';
  if (!inputPath) {
    throw new Error('path is required and must be a non-empty string.');
  }

  const oldText = args?.old_text;
  if (typeof oldText !== 'string' || oldText.length === 0) {
    throw new Error('old_text is required and must be a non-empty string.');
  }

  const newText = args?.new_text;
  if (typeof newText !== 'string') {
    throw new Error('new_text is required and must be a string.');
  }

  const expectedSha256 = typeof args?.expected_sha256 === 'string'
    ? args.expected_sha256.trim().toLowerCase()
    : '';

  if (!/^[a-f0-9]{64}$/.test(expectedSha256)) {
    throw new Error(
      'expected_sha256 is required and must be a 64-character SHA-256 hex string.',
    );
  }

  const resolvedPath = resolveLocalPath(inputPath);
  const stat = safeStat(resolvedPath);

  if (!stat || !stat.isFile()) {
    throw new Error(`Local file is not editable: ${resolvedPath}`);
  }

  // 一次性读取同一份原始字节，再同时用于 SHA 校验和文本编辑，
  // 避免“读到的内容”和“计算 SHA 的内容”不是同一个版本。
  const originalBytes = readFileSync(resolvedPath);

  const sha256Before = createHash('sha256')
    .update(originalBytes)
    .digest('hex');

  if (sha256Before !== expectedSha256) {
    throw new Error(
      `File changed since it was read: SHA-256 mismatch for ${resolvedPath}. ` +
      'Read the file again before editing. No changes were made.',
    );
  }

  const originalContent = originalBytes.toString('utf8');
  const matchCount = countExactOccurrences(originalContent, oldText);

  if (matchCount === 0) {
    throw new Error(
      `old_text was not found in ${resolvedPath}. ` +
      'Read the file again and use the exact current text. No changes were made.',
    );
  }

  if (matchCount > 1) {
    throw new Error(
      `old_text matched ${matchCount} locations in ${resolvedPath}. ` +
      'Provide more surrounding context so exactly one location matches. No changes were made.',
    );
  }

  const matchIndex = originalContent.indexOf(oldText);

  const updatedContent =
    originalContent.slice(0, matchIndex) +
    newText +
    originalContent.slice(matchIndex + oldText.length);

  const sha256After = createHash('sha256')
    .update(updatedContent, 'utf8')
    .digest('hex');

  return {
    path: resolvedPath,
    originalContent,
    updatedContent,
    replacements: 1,
    bytesBefore: originalBytes.length,
    bytesAfter: Buffer.byteLength(updatedContent, 'utf8'),
    sha256Before,
    sha256After,
  };
}

export function applyPreparedLocalFileEdit(plan) {
  if (!plan || typeof plan !== 'object') {
    throw new Error('A prepared local file edit plan is required.');
  }

  const tempPath =
    `${plan.path}.dpp-${process.pid}-${randomUUID()}.tmp`;

  let tempCreated = false;

  try {
    // 1. 新内容只写临时文件，不碰正式文件
    writeFileSync(
      tempPath,
      plan.updatedContent,
      {
        encoding: 'utf8',
        flag: 'wx',
      },
    );

    tempCreated = true;

    // 2. 验证临时文件
    const tempBytes = readFileSync(tempPath);
    const tempContent = tempBytes.toString('utf8');

    const tempSha256 = createHash('sha256')
      .update(tempBytes)
      .digest('hex');

    if (
      tempContent !== plan.updatedContent ||
      tempSha256 !== plan.sha256After
    ) {
      throw new Error(
        `Temporary file verification failed for ${plan.path}. ` +
        'Original file was not modified.',
      );
    }

    // 3. 最后一次检查正式文件有没有被 IDEA / 用户再次修改
    const currentBytes = readFileSync(plan.path);

    const currentSha256 = createHash('sha256')
      .update(currentBytes)
      .digest('hex');

    if (currentSha256 !== plan.sha256Before) {
      throw new Error(
        `File changed after the edit was prepared: SHA-256 mismatch for ${plan.path}. ` +
        'Read the file again before editing. Original file was not modified.',
      );
    }

    // 4. 临时文件已经验证通过，此时才替换正式文件
    renameSync(tempPath, plan.path);
    tempCreated = false;

    // 5. 再读取真正的正式文件做最终验证
    const finalBytes = readFileSync(plan.path);
    const finalContent = finalBytes.toString('utf8');

    const finalSha256 = createHash('sha256')
      .update(finalBytes)
      .digest('hex');

    if (
      finalContent !== plan.updatedContent ||
      finalSha256 !== plan.sha256After
    ) {
      throw new Error(
        `Final file verification failed for ${plan.path}.`,
      );
    }

    return {
      path: plan.path,
      replacements: plan.replacements,
      bytesBefore: plan.bytesBefore,
      bytesAfter: finalBytes.length,
      sha256Before: plan.sha256Before,
      sha256After: finalSha256,
    };
  } finally {
    // 写临时文件后任何一步失败，都清理临时文件
    if (tempCreated) {
      try {
        unlinkSync(tempPath);
      } catch {
        // Cleanup failure must not hide the original edit error.
      }
    }
  }
}

function countExactOccurrences(content, needle) {
  let count = 0;
  let start = 0;

  while (start <= content.length - needle.length) {
    const index = content.indexOf(needle, start);
    if (index === -1) break;

    count++;
    start = index + 1;
  }

  return count;
}


// 按需字节读取字符窗口，避免整文件读入内存（根除 OOM）。
// 返回 { content: 窗口字符串(≤maxChars 字符), totalChars: 整文件字符数 }。
function readTextFileLines(filePath, startLine, endLine) {
  const stat = safeStat(filePath);
  if (!stat || !stat.isFile()) throw new Error(`Local file is not readable: ${filePath}`);
  const totalBytes = stat.size;
  if (totalBytes === 0) {
    return { content: '', startLine: 1, endLine: 0, totalLines: 0, totalChars: 0, lineEnding: 'LF' };
  }

  const fd = openSync(filePath, 'r');
  try {
    const chunkSize = 64 * 1024;
    let bytePos = 0;
    let carry = Buffer.alloc(0);
    let totalLines = 0;
    let totalChars = 0;
    let lineEnding = 'LF';
    const wantedStart = startLine;
    const wantedEnd = endLine === undefined ? Infinity : endLine;
    const parts = [];

    while (bytePos < totalBytes) {
      const want = Math.min(chunkSize, totalBytes - bytePos);
      const buf = Buffer.alloc(want);
      const got = readSync(fd, buf, 0, want, bytePos);
      if (got === 0) break;
      bytePos += got;
      const atEof = bytePos >= totalBytes;
      const combined = Buffer.concat([carry, buf.subarray(0, got)]);
      let lineStart = 0;

      for (let i = 0; i < combined.length; i++) {
        if (combined[i] !== 0x0A) continue;
        let end = i;
        let sepLen = 1;
        if (end > lineStart && combined[end - 1] === 0x0D) {
          end--;
          sepLen = 2;
          lineEnding = 'CRLF';
        }
        const text = combined.subarray(lineStart, end).toString('utf8');
        totalLines++;
        totalChars += text.length + sepLen;
        if (totalLines >= wantedStart && totalLines <= wantedEnd) {
          parts.push(text);
        }
        lineStart = i + 1;
      }

      if (atEof) {
        if (lineStart < combined.length) {
          let end = combined.length;
          if (end > lineStart && combined[end - 1] === 0x0D) {
            end--;
            lineEnding = 'CRLF';
          }
          const text = combined.subarray(lineStart, end).toString('utf8');
          totalLines++;
          totalChars += text.length;
          if (totalLines >= wantedStart && totalLines <= wantedEnd) {
            parts.push(text);
          }
        }
        carry = Buffer.alloc(0);
      } else {
        carry = combined.subarray(lineStart);
      }
    }

    const actualStart = Math.max(1, Math.min(startLine, totalLines));
    const actualEnd = endLine === undefined ? totalLines : Math.min(endLine, totalLines);
    const lineSep = lineEnding === 'CRLF' ? '\r\n' : '\n';
    return {
      content: parts.join(lineSep),
      startLine: actualStart,
      endLine: actualEnd,
      totalLines,
      totalChars,
      lineEnding,
    };
  } finally {
    closeSync(fd);
  }
}

export function readTextFileWindow(filePath, startChar, maxChars) {
  const stat = safeStat(filePath);
  if (!stat || !stat.isFile()) throw new Error(`Local file is not readable: ${filePath}`);
  const totalBytes = stat.size;
  if (totalBytes === 0) return { content: '', totalChars: 0, charsRead: 0 };

  const fd = openSync(filePath, 'r');
  try {
    const chunkSize = 64 * 1024;

    // 定位起始字节偏移（UTF-8 变长；带顺序续读缓存避免 O(N^2)）
    let bytePos = 0;
    let charPos = 0;
    const cached = readWindowPosCache.get(filePath);
    if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size && startChar >= cached.charPos) {
      bytePos = cached.bytePos;
      charPos = cached.charPos;
    }
    while (bytePos < totalBytes && charPos < startChar) {
      const want = Math.min(chunkSize, totalBytes - bytePos);
      const buf = Buffer.alloc(want);
      const got = readSync(fd, buf, 0, want, bytePos);
      if (got === 0) break;
      const atEof = bytePos + got >= totalBytes;
      // 只扫实际读到的 got 字节：Buffer.alloc 为零填充，短读时尾部 0x00 会被误计为字符。
      const { bytes: consumed, chars: added } = scanUtf8Chars(buf.subarray(0, got), startChar - charPos, atEof);
      if (consumed === 0) break; // 纵深防御：字节指针不前进即终止，杜绝死循环
      charPos += added;
      // 统一用 consumed 前进：用 got 会跳过被回退的尾部不完整序列，令后续窗口全部错位。
      bytePos += consumed;
      if (charPos >= startChar) break;
    }
    if (charPos < startChar) {
      return { content: '', totalChars: getTotalCharCount(fd, totalBytes, filePath, stat), charsRead: 0 };
    }
    // 达上限时仅淘汰最旧条目（FIFO），避免一次性清空所有热缓存导致频繁全扫。
    if (readWindowPosCache.size >= MAX_WINDOW_POS_CACHE) {
      const oldest = readWindowPosCache.keys().next().value;
      if (oldest !== undefined) readWindowPosCache.delete(oldest);
    }
    readWindowPosCache.set(filePath, { bytePos, charPos, mtimeMs: stat.mtimeMs, size: stat.size });

    // 读取窗口 [startChar, startChar + maxChars)
    let remaining = maxChars;
    let charsRead = 0;
    const parts = [];
    while (bytePos < totalBytes && remaining > 0) {
      const want = Math.min(chunkSize, totalBytes - bytePos);
      const buf = Buffer.alloc(want);
      const got = readSync(fd, buf, 0, want, bytePos);
      if (got === 0) break;
      const atEof = bytePos + got >= totalBytes;
      // 同上：仅扫描实际读到的 got 字节，并在非 EOF 时回退尾部不完整多字节序列。
      const { bytes: consumed, chars: added } = scanUtf8Chars(buf.subarray(0, got), remaining, atEof);
      if (consumed === 0) break; // 纵深防御：字节指针不前进即终止，杜绝死循环
      parts.push(buf.subarray(0, consumed));
      remaining -= added;
      charsRead += added;
      bytePos += consumed;
    }
    const text = Buffer.concat(parts).toString('utf8');
    const windowChars = Array.from(text).slice(0, Math.max(0, maxChars));
    const windowContent = windowChars.join('');
    const totalChars = getTotalCharCount(fd, totalBytes, filePath, stat);
    return { content: windowContent, totalChars, charsRead: windowChars.length };
  } finally {
    closeSync(fd);
  }
}

// 扫描 buffer，返回"前 maxChars 个字符所占字节数"与"实际字符数"(可能因 buffer 不足 < maxChars)。
// 跨 buffer 的字符连续性由 UTF-8 字节前缀规则保证：续字节(0x80-0xBF)不计入字符数。
//
// atEof=true 表示本 buffer 末尾即文件末尾：尾部不完整序列属损坏数据，原样保留不静默丢弃。
// atEof=false 时必须回退尾部不完整的多字节序列。否则当某个字符的首字节恰好落在 buffer
// 最后一个字节时，内层 while 的 i < bytes.length 立即为假、续字节未被纳入，返回的 bytes
// 含一个孤立首字节，Buffer.concat().toString('utf8') 会将其解码为 U+FFFD；同时 bytePos
// 停在字符中间，导致后续所有窗口的起始位置错位。
function scanUtf8Chars(bytes, maxChars, atEof = false) {
  let i = 0;
  let chars = 0;
  while (i < bytes.length && chars < maxChars) {
    if ((bytes[i] & 0xC0) !== 0x80) {
      chars++;
      if (chars === maxChars) {
        i++;
        while (i < bytes.length && (bytes[i] & 0xC0) === 0x80) i++;
        break;
      }
    }
    i++;
  }
  if (atEof) return { bytes: i, chars };
  const rollback = incompleteTailBytes(bytes, i);
  return rollback > 0 ? { bytes: i - rollback, chars: chars - 1 } : { bytes: i, chars };
}

// 返回 bytes[0, end) 末尾"不完整多字节序列"所占字节数；序列完整时返回 0。
// UTF-8 单字符最长 4 字节，故最多回看 3 个续字节。
function incompleteTailBytes(bytes, end) {
  let k = end - 1;
  let continuation = 0;
  while (k >= 0 && continuation < 3 && (bytes[k] & 0xC0) === 0x80) {
    k--;
    continuation++;
  }
  if (k < 0) return 0;
  const lead = bytes[k];
  const need = lead < 0x80 ? 1 : lead < 0xE0 ? 2 : lead < 0xF0 ? 3 : 4;
  return continuation + 1 < need ? continuation + 1 : 0;
}

// 顺序续读定位缓存：记录 (path -> 已扫描到的字节/字符偏移)，使 auto 续读每窗只扫新增量。
// 上限保护（L1）：长驻宿主进程读取大量不同文件时避免 Map 无限增长导致内存泄漏。
const MAX_WINDOW_POS_CACHE = 1024;
const readWindowPosCache = new Map();
// 整文件字符数缓存（按 mtime+size 失效），避免每次调用全文件重扫。上限保护同 L1。
const MAX_FILE_CHAR_CACHE = 1024;
const fileCharCountCache = new Map();

function getTotalCharCount(fd, totalBytes, path, stat) {
  const cached = fileCharCountCache.get(path);
  if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) return cached.count;
  let count = 0;
  let bytePos = 0;
  const chunkSize = 256 * 1024;
  const buf = Buffer.alloc(chunkSize);
  while (bytePos < totalBytes) {
    const want = Math.min(chunkSize, totalBytes - bytePos);
    const got = readSync(fd, buf, 0, want, bytePos);
    if (got === 0) break;
    for (let j = 0; j < got; j++) if ((buf[j] & 0xC0) !== 0x80) count++;
    bytePos += got;
  }
  // 达上限时仅淘汰最旧条目（FIFO），避免一次性清空所有热缓存导致频繁全扫。
  if (fileCharCountCache.size >= MAX_FILE_CHAR_CACHE) {
    const oldest = fileCharCountCache.keys().next().value;
    if (oldest !== undefined) fileCharCountCache.delete(oldest);
  }
  fileCharCountCache.set(path, { count, mtimeMs: stat.mtimeMs, size: stat.size });
  return count;
}

export function safeReadDirectory(directory) {
  try {
    return readdirSync(directory, { withFileTypes: true });
  } catch (error) {
    if (isMissingPathError(error)) return [];
    throw error;
  }
}

export function safeStat(path) {
  try {
    return statSync(path);
  } catch (error) {
    if (isMissingPathError(error)) return null;
    throw error;
  }
}

function isMissingPathError(error) {
  return error && typeof error === 'object'
    && (error.code === 'ENOENT' || error.code === 'ENOTDIR');
}

function toolError(message) {
  return { isError: true, content: [{ type: 'text', text: message }] };
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
