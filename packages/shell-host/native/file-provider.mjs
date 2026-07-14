import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
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

  const start = typeof args?.start === 'number' && args.start >= 0 ? Math.floor(args.start) : 0;
  const maxChars = typeof args?.max_chars === 'number' && args.max_chars >= 1
    ? Math.min(Math.floor(args.max_chars), MAX_LOCAL_FILE_READ_CHARS)
    : DEFAULT_LOCAL_FILE_READ_CHARS;

  try {
    const resolvedPath = resolveLocalPath(inputPath);
    const stat = safeStat(resolvedPath);
    if (!stat || !stat.isFile()) throw new Error(`Local file is not readable: ${resolvedPath}`);

    const content = readTextFile(resolvedPath);
    const slice = content.slice(start, start + maxChars);
    const nextStart = start + slice.length;
    return {
      content: [{ type: 'text', text: `Read ${slice.length} characters from ${resolvedPath}` }],
      structuredContent: {
        ok: true,
        data: {
          path: resolvedPath,
          content: slice,
          start,
          nextStart,
          maxChars,
          totalChars: content.length,
          truncated: nextStart < content.length,
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
