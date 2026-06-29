#!/usr/bin/env node

// deepseek-pp-code-index-host — Native Messaging MCP host for code understanding
// Provides: code_search, code_symbol, code_structure, code_glob, code_batch_read
//
// Protocol: deepseek-pp-mcp-native v1 JSON-RPC 2.0 over stdin/stdout.
// Framing: 4-byte LE message length prefix (same as shell-mcp-host.mjs).

import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from 'node:path';
import { arch, homedir, hostname, platform } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

// ── Constants ────────────────────────────────────────────────────────────────

const MCP_PROTOCOL_VERSION = '2025-06-18';
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_SEARCH_RESULTS = 200;
const MAX_READ_BYTES = 512_000;
const MAX_GLOB_RESULTS = 5_000;
const MAX_SEARCH_FILE_BYTES = 1_048_576; // Skip files > 1MB for search

const SKIP_DIRS = new Set(['node_modules', '.git', '.svn', '.hg', '__pycache__', '.venv', 'venv', 'dist', 'build', '.next', '.turbo', 'coverage', '.nyc_output', '.cache']);
const TEXT_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts',
  '.py', '.rb', '.go', '.rs', '.java', '.kt', '.swift', '.scala',
  '.c', '.cpp', '.h', '.hpp', '.cs', '.fs',
  '.css', '.scss', '.less', '.sass', '.html', '.xml', '.svg',
  '.yaml', '.yml', '.json', '.jsonc', '.toml', '.ini', '.cfg', '.conf',
  '.md', '.mdx', '.txt', '.tex',
  '.sh', '.bash', '.zsh', '.ps1', '.sql', '.graphql', '.gql',
  '.vue', '.svelte', '.astro', '.ejs', '.hbs', '.erb',
  '.lua', '.r', '.pl', '.pm', '.php', '.ex', '.exs',
  '.gradle', '.sbt', '.clj', '.cljs', '.edn',
  '.dockerfile', '.makefile', '.cmake',
]);
const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.ico', '.webp', '.bmp',
  '.woff', '.woff2', '.ttf', '.eot', '.otf',
  '.zip', '.gz', '.tar', '.bz2', '.7z', '.rar', '.zst',
  '.exe', '.dll', '.so', '.dylib', '.wasm',
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  '.mp3', '.mp4', '.avi', '.mov', '.webm',
  '.o', '.a', '.lib', '.obj', '.pyc', '.pyo',
  '.map', '.br', '.snap',
]);

const __dirname = dirname(fileURLToPath(import.meta.url));
const HOST_VERSION = '1.0.0';

// ── In-memory file index cache ───────────────────────────────────────────────

let indexCache = {
  rootPath: null,
  files: [],       // { path, relativePath, size, mtime, isDir, type }
  refreshedAt: 0,
};

const INDEX_TTL_MS = 30_000; // 30 second cache

function getIndex(path) {
  if (indexCache.rootPath === path && Date.now() - indexCache.refreshedAt < INDEX_TTL_MS) {
    return indexCache.files;
  }
  return null;
}

function buildIndex(rootPath) {
  const files = [];
  const stack = [{ absolutePath: rootPath, relativePath: '' }];

  while (stack.length > 0) {
    const current = stack.pop();
    let entries;
    try {
      entries = readdirSync(current.absolutePath, { withFileTypes: true });
    } catch {
      continue; // Permission denied
    }

    for (const entry of entries) {
      if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue;
      const absPath = join(current.absolutePath, entry.name);
      const relPath = current.relativePath ? `${current.relativePath}/${entry.name}` : entry.name;

      if (entry.isDirectory()) {
        files.push({ path: absPath, relativePath: relPath, type: 'directory', size: 0, mtime: 0 });
        stack.push({ absolutePath: absPath, relativePath: relPath });
      } else if (entry.isFile()) {
        const ext = extname(entry.name).toLowerCase();
        const isBinary = BINARY_EXTENSIONS.has(ext);
        try {
          const stat = statSync(absPath);
          files.push({
            path: absPath,
            relativePath: relPath,
            type: 'file',
            size: stat.size,
            mtime: stat.mtimeMs,
            ext,
            binary: isBinary,
          });
        } catch {
          files.push({ path: absPath, relativePath: relPath, type: 'file', size: 0, mtime: 0, ext, binary: isBinary });
        }
      }
    }
  }

  indexCache = { rootPath, files, refreshedAt: Date.now() };
  return files;
}

function ensureIndex(rootPath) {
  const cached = getIndex(rootPath);
  if (cached) return cached;
  return buildIndex(rootPath);
}

// ── Glob matching ────────────────────────────────────────────────────────────

function globToRegex(pattern) {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '<<GLOBSTAR>>')
    .replace(/\*/g, '[^/]*')
    .replace(/<<GLOBSTAR>>/g, '.*')
    .replace(/\?/g, '[^/]');
  return new RegExp('^' + escaped + '$');
}

function matchGlob(pattern, relativePath) {
  return globToRegex(pattern).test(relativePath);
}

// ── Lightweight symbol extraction ────────────────────────────────────────────

function extractSymbols(content, filePath) {
  const ext = extname(filePath).toLowerCase();
  const lines = content.split('\n');
  const symbols = [];

  // Language-specific patterns
  const patterns = [];

  if (['.ts', '.tsx', '.js', '.jsx', '.mjs', '.mts', '.cts'].includes(ext)) {
    patterns.push(
      /^(?:export\s+)?(?:async\s+)?function\s+\*?\s*(\w+)/gm,
      /^(?:export\s+)?(?:async\s+)?(?:const|let|var)\s+(\w+)\s*[=:]/gm,
      /^(?:export\s+)?class\s+(\w+)/gm,
      /^(?:export\s+)?interface\s+(\w+)/gm,
      /^(?:export\s+)?type\s+(\w+)\s*=/gm,
      /^(?:export\s+)?enum\s+(\w+)/gm,
      /^(?:export\s+)?(?:abstract\s+)?class\s+(\w+).*\{/gm,
      /^(?:export\s+)?default\s+(?:async\s+)?function\s+(\w+)/gm,
      /^(?:export\s+)?default\s+class\s+(\w+)/gm,
      /module\.exports\s*=\s*(\w+)/gm,
      /exports\.(\w+)\s*=/gm,
    );
  }

  if (['.py'].includes(ext)) {
    patterns.push(
      /^def\s+(\w+)\s*\(/gm,
      /^class\s+(\w+)/gm,
      /^async\s+def\s+(\w+)\s*\(/gm,
      /^\s*(\w+)\s*=\s*(?:lambda|async)/gm,
    );
  }

  if (['.go'].includes(ext)) {
    patterns.push(
      /^func\s+(\w+)/gm,
      /^func\s+\([^)]+\)\s+(\w+)/gm,
      /^type\s+(\w+)\s+(?:struct|interface|func)/gm,
    );
  }

  if (['.rs'].includes(ext)) {
    patterns.push(
      /^fn\s+(\w+)/gm,
      /^pub\s+(?:fn|struct|enum|trait|mod|type|const|static)\s+(\w+)/gm,
      /^struct\s+(\w+)/gm,
      /^enum\s+(\w+)/gm,
      /^trait\s+(\w+)/gm,
    );
  }

  if (['.java', '.kt'].includes(ext)) {
    patterns.push(
      /(?:public|private|protected)?\s*(?:static\s+)?(?:class|interface|enum)\s+(\w+)/gm,
      /(?:public|private|protected)?\s*(?:static\s+)?\w+\s+(\w+)\s*\([^)]*\)\s*(?:throws\s+\w+)?\s*\{/gm,
    );
  }

  if (['.rb'].includes(ext)) {
    patterns.push(
      /^def\s+(?:self\.)?(\w+)/gm,
      /^class\s+(\w+)/gm,
      /^module\s+(\w+)/gm,
    );
  }

  // Generic patterns (fallback for any language)
  patterns.push(
    /^\s*(?:export\s+)?(?:function|class|interface|type|struct|enum|trait|fn|def|sub)\s+(\w+)/gm,
  );

  for (const regex of patterns) {
    regex.lastIndex = 0;
    let match;
    while ((match = regex.exec(content)) !== null) {
      const lineNum = content.slice(0, match.index).split('\n').length;
      symbols.push({
        name: match[1],
        kind: inferSymbolKind(match[0], ext),
        line: lineNum,
        column: match.index - content.lastIndexOf('\n', match.index) - 1,
      });
    }
  }

  // Deduplicate by name + line
  const seen = new Set();
  return symbols.filter(s => {
    const key = `${s.name}:${s.line}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function inferSymbolKind(match, ext) {
  if (/class\b/.test(match)) return 'class';
  if (/interface\b/.test(match)) return 'interface';
  if (/enum\b/.test(match)) return 'enum';
  if (/type\b.*=/.test(match)) return 'type';
  if (/trait\b/.test(match)) return 'trait';
  if (/struct\b/.test(match)) return 'struct';
  if (/function\b|^fn\b|^def\b/.test(match)) return 'function';
  if (/const\b|let\b|var\b/.test(match)) return 'variable';
  return 'unknown';
}

// ── File structure outline ───────────────────────────────────────────────────

function extractStructure(content, filePath) {
  const ext = extname(filePath).toLowerCase();
  const lines = content.split('\n');
  const structure = { imports: [], exports: [], classes: [], functions: [], variables: [] };

  // Imports
  let importRegex;
  if (['.ts', '.tsx', '.js', '.jsx', '.mjs'].includes(ext)) {
    importRegex = /^(?:import\s+(?:type\s+)?(?:\{[^}]*\}|\*\s+as\s+\w+|\w+)(?:\s*,\s*(?:\{[^}]*\}|\*\s+as\s+\w+|\w+))*\s+from\s+['"][^'"]+['"]|import\s+['"][^'"]+['"]|export\s+\*|export\s+\{[^}]+\})/gm;
  } else if (['.py'].includes(ext)) {
    importRegex = /^(?:import\s+\w+(?:\.\w+)*(?:\s*,\s*\w+(?:\.\w+)*)*|from\s+\w+(?:\.\w+)*\s+import\s+[\w*,()\s]+)/gm;
  } else if (['.go'].includes(ext)) {
    importRegex = /^import\s+(?:\([^)]*\)|"[^"]+")/gms;
  } else if (['.rs'].includes(ext)) {
    importRegex = /^(?:use\s+[\w:{}*]+(?:::[\w:*]+)?;|extern\s+crate\s+\w+)/gm;
  }
  if (importRegex) {
    importRegex.lastIndex = 0;
    let match;
    while ((match = importRegex.exec(content)) !== null) {
      const lineNum = content.slice(0, match.index).split('\n').length;
      structure.imports.push({ text: match[0].trim().slice(0, 120), line: lineNum });
    }
  }

  // Classes, functions, variables via extractSymbols
  const symbols = extractSymbols(content, filePath);
  for (const sym of symbols) {
    if (sym.kind === 'class') structure.classes.push(sym);
    else if (sym.kind === 'function') structure.functions.push(sym);
    else structure.variables.push(sym);
  }

  // Exports (specific to JS/TS)
  if (['.ts', '.tsx', '.js', '.jsx', '.mjs'].includes(ext)) {
    const exportRegex = /^export\s+(?:default\s+)?(?:function|class|const|let|var|interface|type|enum)\s+(\w+)/gm;
    exportRegex.lastIndex = 0;
    let match;
    while ((match = exportRegex.exec(content)) !== null) {
      const lineNum = content.slice(0, match.index).split('\n').length;
      structure.exports.push({ name: match[1], line: lineNum });
    }
  }

  return structure;
}

// ── Native message framing ───────────────────────────────────────────────────

let buffer = Buffer.alloc(0);
let messageResolve = null;
const messageQueue = [];

function onStdinData(chunk) {
  buffer = Buffer.concat([buffer, chunk]);
  drainBuffer();
}

function drainBuffer() {
  while (true) {
    if (buffer.length < 4) return;
    const len = buffer.readUInt32LE(0);
    if (len === 0 || len > 10 * 1024 * 1024) {
      process.stderr.write(`[code-index-host] Invalid message length: ${len}\n`);
      process.exit(1);
    }
    if (buffer.length < 4 + len) return;
    const json = buffer.subarray(4, 4 + len).toString('utf8');
    buffer = buffer.subarray(4 + len);
    try {
      const msg = JSON.parse(json);
      if (messageResolve) {
        const r = messageResolve;
        messageResolve = null;
        r(msg);
      } else {
        messageQueue.push(msg);
      }
    } catch (err) {
      process.stderr.write(`[code-index-host] JSON parse error: ${err.message}\n`);
    }
  }
}

let stdinEnded = false;
const EOF = Symbol('EOF');

function readMessage() {
  if (messageQueue.length > 0) return Promise.resolve(messageQueue.shift());
  if (stdinEnded) return Promise.resolve(EOF);
  return new Promise((resolve) => { messageResolve = resolve; });
}

process.stdin.on('data', onStdinData);
process.stdin.on('end', () => {
  stdinEnded = true;
  if (messageResolve) {
    const r = messageResolve;
    messageResolve = null;
    r(EOF);
  }
});
process.stdin.on('error', () => {
  stdinEnded = true;
  if (messageResolve) {
    const r = messageResolve;
    messageResolve = null;
    r(EOF);
  }
});

function writeNativeMessage(message) {
  return new Promise((resolve) => {
    const json = JSON.stringify(message);
    const body = Buffer.from(json, 'utf8');
    const header = Buffer.alloc(4);
    header.writeUInt32LE(body.length, 0);
    process.stdout.write(header);
    process.stdout.write(body, resolve);
  });
}

// ── JSON-RPC helpers ─────────────────────────────────────────────────────────

function jsonRpcResult(id, result) {
  return { jsonrpc: '2.0', id, result };
}

function jsonRpcError(id, code, message, data) {
  return { jsonrpc: '2.0', id, error: { code, message, ...(data ? { data } : {}) } };
}

// ── Tool definitions ─────────────────────────────────────────────────────────

const TOOL_DEFINITIONS = [
  {
    name: 'code_search',
    title: 'Code Search',
    description: 'Full-text regex search across project files. Uses ripgrep when available. Skips .git, node_modules, and binary files automatically.',
    inputSchema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Search pattern as regular expression.' },
        path: { type: 'string', description: 'Project root directory for the search.' },
        glob: { type: 'string', description: 'Optional file glob filter (e.g. "*.ts", "src/**/*.py").' },
        maxResults: { type: 'integer', minimum: 1, maximum: 500, description: 'Maximum results. Default 50.' },
        contextLines: { type: 'integer', minimum: 0, maximum: 5, description: 'Context lines before/after match. Default 1.' },
        fixedString: { type: 'boolean', description: 'Treat pattern as literal string. Default false.' },
        caseSensitive: { type: 'boolean', description: 'Case sensitive search. Default false.' },
      },
      required: ['pattern'],
      additionalProperties: false,
    },
    annotations: { operation: 'read', risk: 'low' },
  },
  {
    name: 'code_symbol',
    title: 'Find Symbol',
    description: 'Find symbol definitions (functions, classes, interfaces, types, variables) in project files. Uses language-specific pattern matching.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Symbol name or partial name to search for (case-insensitive substring match).' },
        path: { type: 'string', description: 'Project root directory.' },
        kind: { type: 'string', enum: ['function', 'class', 'interface', 'type', 'variable', 'all'], description: 'Filter by symbol kind. Default "all".' },
        maxResults: { type: 'integer', minimum: 1, maximum: 200, description: 'Maximum results. Default 50.' },
      },
      required: ['query', 'path'],
      additionalProperties: false,
    },
    annotations: { operation: 'read', risk: 'low' },
  },
  {
    name: 'code_structure',
    title: 'File Structure',
    description: 'Get the structural outline of a file: imports, exports, classes, functions, and variables with line numbers.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute path to the file to analyze.' },
      },
      required: ['path'],
      additionalProperties: false,
    },
    annotations: { operation: 'read', risk: 'low' },
  },
  {
    name: 'code_glob',
    title: 'Glob File Search',
    description: 'Search for files matching a glob pattern. Uses an indexed directory cache for fast repeated queries.',
    inputSchema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Glob pattern (e.g. "src/**/*.ts", "**/*.py", "*.json").' },
        path: { type: 'string', description: 'Project root directory.' },
        maxResults: { type: 'integer', minimum: 1, maximum: 5000, description: 'Maximum results. Default 200.' },
        includeHidden: { type: 'boolean', description: 'Include hidden files. Default false.' },
      },
      required: ['pattern', 'path'],
      additionalProperties: false,
    },
    annotations: { operation: 'read', risk: 'low' },
  },
  {
    name: 'code_batch_read',
    title: 'Batch Read Files',
    description: 'Read multiple files in a single call. Returns content with metadata. Best for reading a few related files at once.',
    inputSchema: {
      type: 'object',
      properties: {
        paths: {
          type: 'array',
          items: { type: 'string' },
          minItems: 1,
          maxItems: 20,
          description: 'Absolute paths to files to read (up to 20).',
        },
        maxBytesPerFile: { type: 'integer', minimum: 1024, maximum: 256000, description: 'Max bytes per file. Default 64000.' },
      },
      required: ['paths'],
      additionalProperties: false,
    },
    annotations: { operation: 'read', risk: 'low' },
  },
];

// ── Tool handlers ────────────────────────────────────────────────────────────

async function handleCodeSearch(args) {
  const pattern = typeof args?.pattern === 'string' && args.pattern.trim() ? args.pattern.trim() : null;
  if (!pattern) {
    return { isError: true, content: [{ type: 'text', text: 'pattern is required.' }] };
  }

  const searchPath = typeof args?.path === 'string' && args.path.trim()
    ? resolve(args.path.trim())
    : process.cwd();
  const glob = typeof args?.glob === 'string' && args.glob.trim() ? args.glob.trim() : null;
  const maxResults = typeof args?.maxResults === 'number'
    ? Math.max(1, Math.min(500, Math.floor(args.maxResults)))
    : 50;
  const contextLines = typeof args?.contextLines === 'number'
    ? Math.max(0, Math.min(5, Math.floor(args.contextLines)))
    : 1;
  const fixedString = args?.fixedString === true;
  const caseSensitive = args?.caseSensitive === true;

  // Try ripgrep first
  try {
    return await searchWithRipgrep(pattern, searchPath, { glob, maxResults, contextLines, fixedString, caseSensitive });
  } catch (rgErr) {
    // Fallback to Node.js search
    return searchWithNode(pattern, searchPath, { glob, maxResults, contextLines, fixedString, caseSensitive });
  }
}

async function searchWithRipgrep(pattern, searchPath, { glob, maxResults, contextLines, fixedString, caseSensitive }) {
  const rgArgs = ['--json', '--max-depth', '20', '-g', '!.git', '-g', '!node_modules'];

  if (contextLines > 0) rgArgs.push('-C', String(contextLines));
  if (maxResults) rgArgs.push('--max-count', String(maxResults));
  if (glob) rgArgs.push('-g', glob);
  if (fixedString) rgArgs.push('-F');
  if (!caseSensitive) rgArgs.push('-i');

  rgArgs.push('--', pattern, searchPath);

  const spawned = spawn('rg', rgArgs, {
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: DEFAULT_TIMEOUT_MS,
    windowsHide: true,
  });

  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    spawned.stdout.on('data', (chunk) => { stdout += chunk.toString('utf8'); });
    spawned.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8'); });
    spawned.on('error', (err) => reject(err));
    spawned.on('close', (exitCode) => {
      if (exitCode === 2 && stderr) {
        reject(new Error(`ripgrep failed: ${stderr.trim()}`));
        return;
      }

      const lines = stdout.trim().split('\n').filter(Boolean);
      const matches = [];
      const fileSet = new Set();

      for (const line of lines) {
        try {
          const parsed = JSON.parse(line);
          if (parsed.type === 'match') {
            const data = parsed.data;
            const filePath = data.path?.text || '';
            const lineNum = data.line_number;
            const lineText = data.lines?.text || '';
            fileSet.add(filePath);
            matches.push({
              file: filePath,
              line: lineNum,
              column: data.submatches?.[0]?.start ?? 0,
              match: data.submatches?.[0]?.match?.text || lineText.trim(),
              context: lineText.replace(/\n$/, '').trim(),
            });
          }
        } catch {}
      }

      const truncated = matches.length > maxResults;
      const limited = matches.slice(0, maxResults);
      const grouped = groupBy(limited, m => m.file);
      const textParts = [];

      for (const [file, ms] of Object.entries(grouped)) {
        textParts.push(`\n${file}:`);
        for (const m of ms) {
          textParts.push(`  ${m.line}:${m.column}  ${m.context}`);
        }
      }

      resolve({
        content: [{ type: 'text', text: textParts.join('\n') || 'No matches found.' }],
        structuredContent: {
          ok: true,
          data: {
            pattern,
            searchPath,
            matches: limited,
            matchCount: limited.length,
            totalMatches: matches.length,
            filesWithMatches: [...fileSet],
            truncated: truncated || undefined,
            engine: 'ripgrep',
          },
        },
      });
    });
  });
}

function searchWithNode(pattern, searchPath, { glob, maxResults, contextLines, fixedString, caseSensitive }) {
  const flags = caseSensitive ? 'g' : 'gi';
  const regex = fixedString
    ? new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags)
    : new RegExp(pattern, flags);

  const matches = [];
  const fileSet = new Set();
  const startTime = Date.now();
  const files = ensureIndex(searchPath).filter(f => f.type === 'file' && !f.binary && f.size > 0 && f.size < MAX_SEARCH_FILE_BYTES);

  if (glob) {
    const matchFn = matchGlob.bind(null, glob);
    // Only keep files matching the glob
    // Actually filter by relative path matching the glob pattern
  }

  for (const file of files) {
    if (matches.length >= maxResults) break;
    if (Date.now() - startTime > DEFAULT_TIMEOUT_MS) break;

    try {
      const content = readFileSync(file.path, 'utf8');
      let m;
      while ((m = regex.exec(content)) !== null && matches.length < maxResults) {
        const lineStart = content.lastIndexOf('\n', m.index) + 1;
        const lineEnd = content.indexOf('\n', m.index);
        const lineNum = content.slice(0, m.index).split('\n').length;
        const lineText = content.slice(lineStart, lineEnd !== -1 ? lineEnd : content.length);

        fileSet.add(file.relativePath);
        matches.push({
          file: file.relativePath,
          line: lineNum,
          column: m.index - lineStart,
          match: m[0],
          context: lineText.trim(),
        });
      }
    } catch {}
  }

  const limited = matches.slice(0, maxResults);
  const grouped = groupBy(limited, m => m.file);
  const textParts = [];
  for (const [filePath, ms] of Object.entries(grouped)) {
    textParts.push(`\n${filePath}:`);
    for (const m of ms) {
      textParts.push(`  ${m.line}:${m.column}  ${m.context}`);
    }
  }

  return {
    content: [{ type: 'text', text: textParts.join('\n') || 'No matches found.' }],
    structuredContent: {
      ok: true,
      data: {
        pattern,
        searchPath,
        matches: limited,
        matchCount: limited.length,
        totalMatches: matches.length,
        filesWithMatches: [...fileSet],
        truncated: matches.length >= maxResults || undefined,
        engine: 'node',
      },
    },
  };
}

function groupBy(arr, fn) {
  const result = {};
  for (const item of arr) {
    const key = fn(item);
    if (!result[key]) result[key] = [];
    result[key].push(item);
  }
  return result;
}

function handleCodeSymbol(args) {
  const query = typeof args?.query === 'string' && args.query.trim() ? args.query.trim() : null;
  const rootPath = typeof args?.path === 'string' && args.path.trim() ? resolve(args.path.trim()) : null;
  const kindFilter = typeof args?.kind === 'string' && args.kind !== 'all' ? args.kind : null;
  const maxResults = typeof args?.maxResults === 'number' ? Math.max(1, Math.min(200, Math.floor(args.maxResults))) : 50;

  if (!query || !rootPath) {
    return { isError: true, content: [{ type: 'text', text: 'query and path are required.' }] };
  }

  const queryLower = query.toLowerCase();
  const files = ensureIndex(rootPath).filter(f => f.type === 'file' && !f.binary && f.size < MAX_SEARCH_FILE_BYTES);
  const results = [];
  const fileRefs = new Map();

  for (const file of files) {
    if (results.length >= maxResults) break;
    try {
      const content = readFileSync(file.path, 'utf8');
      const symbols = extractSymbols(content, file.path);
      const matching = symbols.filter(s => {
        if (kindFilter && s.kind !== kindFilter) return false;
        return s.name.toLowerCase().includes(queryLower);
      });
      for (const sym of matching.slice(0, 50)) {
        results.push({ ...sym, file: file.relativePath });
        const key = file.relativePath;
        if (!fileRefs.has(key)) fileRefs.set(key, []);
        fileRefs.get(key).push(sym.line);
      }
    } catch {}
  }

  const limited = results.slice(0, maxResults);
  const textParts = [];
  for (const r of limited) {
    textParts.push(`${r.file}:${r.line}:${r.column}  ${r.kind} ${r.name}`);
  }

  return {
    content: [{ type: 'text', text: textParts.join('\n') || `No symbols matching "${query}" found.` }],
    structuredContent: {
      ok: true,
      data: {
        query,
        searchPath: rootPath,
        symbols: limited,
        matchCount: limited.length,
        totalMatches: results.length,
        truncated: results.length > maxResults || undefined,
      },
    },
  };
}

function handleCodeStructure(args) {
  const filePath = typeof args?.path === 'string' && args.path.trim() ? resolve(args.path.trim()) : null;
  if (!filePath) {
    return { isError: true, content: [{ type: 'text', text: 'path is required.' }] };
  }

  if (!existsSync(filePath)) {
    return { isError: true, content: [{ type: 'text', text: `File not found: ${filePath}` }] };
  }

  const stat = statSync(filePath);
  if (!stat.isFile()) {
    return { isError: true, content: [{ type: 'text', text: `Not a file: ${filePath}` }] };
  }

  const ext = extname(filePath).toLowerCase();
  if (BINARY_EXTENSIONS.has(ext)) {
    return { content: [{ type: 'text', text: 'Binary file — structure not available.' }], structuredContent: { ok: true, data: { path: filePath, binary: true, structure: null } } };
  }

  let content;
  try {
    content = readFileSync(filePath, 'utf8');
  } catch (err) {
    return { isError: true, content: [{ type: 'text', text: `Failed to read file: ${err.message}` }] };
  }

  const structure = extractStructure(content, filePath);
  const lines = content.split('\n');
  const lineCount = lines[lines.length - 1] === '' ? lines.length - 1 : lines.length;

  const textParts = [];
  textParts.push(`File: ${filePath} (${lineCount} lines, ${Math.ceil(stat.size / 1024)} KB)`);
  if (structure.imports.length > 0) {
    textParts.push(`\nImports (${structure.imports.length}):`);
    for (const imp of structure.imports.slice(0, 30)) {
      textParts.push(`  ${imp.line}: ${imp.text}`);
    }
    if (structure.imports.length > 30) textParts.push(`  ... and ${structure.imports.length - 30} more`);
  }
  if (structure.classes.length > 0) {
    textParts.push(`\nClasses (${structure.classes.length}):`);
    for (const cls of structure.classes) textParts.push(`  ${cls.line}: ${cls.name}`);
  }
  if (structure.functions.length > 0) {
    textParts.push(`\nFunctions (${structure.functions.length}):`);
    for (const fn of structure.functions) textParts.push(`  ${fn.line}: ${fn.name}`);
  }
  if (structure.exports.length > 0) {
    textParts.push(`\nExports (${structure.exports.length}):`);
    for (const exp of structure.exports) textParts.push(`  ${exp.line}: ${exp.name}`);
  }

  return {
    content: [{ type: 'text', text: textParts.join('\n') || '(no structure extracted)' }],
    structuredContent: {
      ok: true,
      data: {
        path: filePath,
        lineCount,
        size: stat.size,
        binary: false,
        structure,
      },
    },
  };
}

function handleCodeGlob(args) {
  const pattern = typeof args?.pattern === 'string' && args.pattern.trim() ? args.pattern.trim() : null;
  const rootPath = typeof args?.path === 'string' && args.path.trim() ? resolve(args.path.trim()) : null;
  const maxResults = typeof args?.maxResults === 'number' ? Math.max(1, Math.min(5000, Math.floor(args.maxResults))) : 200;

  if (!pattern || !rootPath) {
    return { isError: true, content: [{ type: 'text', text: 'pattern and path are required.' }] };
  }

  const files = ensureIndex(rootPath).filter(f => f.type === 'file' || f.type === 'directory');
  const matchFn = matchGlob.bind(null, pattern);
  const matched = [];

  for (const file of files) {
    if (matched.length >= maxResults) break;
    if (matchFn(file.relativePath)) {
      matched.push({
        path: file.relativePath,
        type: file.type,
        size: file.type === 'file' ? file.size : undefined,
      });
    }
  }

  const truncated = matched.length >= maxResults;
  const text = matched.length > 0
    ? matched.map(m => `${m.type === 'directory' ? '📁' : '📄'} ${m.path}${m.size ? ` (${m.size} B)` : ''}`).join('\n')
    : 'No files matched the pattern.';

  return {
    content: [{ type: 'text', text: `Found ${Math.min(matched.length, maxResults)} file(s) matching "${pattern}"${truncated ? ' (truncated)' : ''}:\n\n${text}` }],
    structuredContent: {
      ok: true,
      data: {
        pattern,
        searchPath: rootPath,
        files: matched.slice(0, maxResults),
        total: matched.length,
        directoryCount: matched.filter(m => m.type === 'directory').length,
        fileCount: matched.filter(m => m.type === 'file').length,
        truncated,
      },
    },
  };
}

function handleCodeBatchRead(args) {
  const paths = Array.isArray(args?.paths) ? args.paths.filter(p => typeof p === 'string' && p.trim()).map(p => resolve(p.trim())) : [];
  const maxBytesPerFile = typeof args?.maxBytesPerFile === 'number'
    ? Math.max(1024, Math.min(256_000, Math.floor(args.maxBytesPerFile)))
    : 64_000;

  if (paths.length === 0) {
    return { isError: true, content: [{ type: 'text', text: 'paths is required and must be a non-empty array.' }] };
  }

  const results = [];
  let totalBytes = 0;
  const maxTotalBytes = 512_000;

  for (const filePath of paths) {
    if (totalBytes >= maxTotalBytes) {
      results.push({ path: filePath, error: 'Total read budget exceeded' });
      continue;
    }

    if (!existsSync(filePath)) {
      results.push({ path: filePath, error: 'File not found' });
      continue;
    }

    const stat = statSync(filePath);
    if (!stat.isFile()) {
      results.push({ path: filePath, error: 'Not a file' });
      continue;
    }

    const ext = extname(filePath).toLowerCase();
    const isBinary = BINARY_EXTENSIONS.has(ext);

    if (isBinary) {
      results.push({ path: filePath, binary: true, size: stat.size, content: null });
      continue;
    }

    try {
      let content = readFileSync(filePath, 'utf8');
      const contentBytes = Buffer.byteLength(content, 'utf8');
      let truncated = false;

      if (contentBytes > maxBytesPerFile) {
        content = content.slice(0, maxBytesPerFile) + '\n... [truncated]';
        truncated = true;
      }

      totalBytes += contentBytes;
      const lines = content.split('\n');
      results.push({
        path: filePath,
        size: stat.size,
        binary: false,
        truncated,
        lineCount: lines.length,
        content,
      });
    } catch (err) {
      results.push({ path: filePath, error: err.message });
    }
  }

  const textParts = results.map(r => {
    if (r.error) return `\n=== ${r.path} ===\nERROR: ${r.error}`;
    if (r.binary) return `\n=== ${r.path} ===\n(binary, ${r.size} bytes)`;
    return `\n=== ${r.path} ===\n${r.content}`;
  });

  return {
    content: [{ type: 'text', text: textParts.join('\n') || 'No files read.' }],
    structuredContent: {
      ok: true,
      data: {
        files: results,
        totalFiles: results.length,
        totalBytes,
      },
    },
  };
}

// ── Initialize / List tools ──────────────────────────────────────────────────

function handleInitialize(id) {
  return jsonRpcResult(id, {
    protocolVersion: MCP_PROTOCOL_VERSION,
    capabilities: { tools: {} },
    serverInfo: { name: 'deepseek-pp-code-index', version: HOST_VERSION },
    instructions: 'Code understanding server. Use code_search for text search, code_symbol for symbol lookup, code_structure for file outlines, code_glob for file globbing, and code_batch_read for reading multiple files at once.',
  });
}

function handleListTools(id) {
  return jsonRpcResult(id, { tools: TOOL_DEFINITIONS });
}

async function handleCallTool(id, params) {
  const name = params?.name;
  const args = params?.arguments ?? {};

  try {
    switch (name) {
      case 'code_search':
        return jsonRpcResult(id, await handleCodeSearch(args));
      case 'code_symbol':
        return jsonRpcResult(id, handleCodeSymbol(args));
      case 'code_structure':
        return jsonRpcResult(id, handleCodeStructure(args));
      case 'code_glob':
        return jsonRpcResult(id, handleCodeGlob(args));
      case 'code_batch_read':
        return jsonRpcResult(id, handleCodeBatchRead(args));
      default:
        return jsonRpcError(id, -32602, `Unknown tool: ${name}`);
    }
  } catch (err) {
    return jsonRpcResult(id, {
      isError: true,
      content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }],
    });
  }
}

// ── Message dispatch ─────────────────────────────────────────────────────────

async function handleMessage(envelope) {
  if (envelope.protocol !== 'deepseek-pp-mcp-native' || envelope.version !== 1) {
    await writeNativeMessage(jsonRpcError(null, -32600, 'Invalid envelope: expected deepseek-pp-mcp-native v1'));
    return;
  }

  const message = envelope.message;
  if (!message || typeof message !== 'object' || message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
    await writeNativeMessage(jsonRpcError(null, -32600, 'Invalid JSON-RPC request.'));
    return;
  }

  const id = message.id ?? null;
  if (!('id' in message)) return;

  let response;
  switch (message.method) {
    case 'initialize':
      response = handleInitialize(id);
      break;
    case 'tools/list':
      response = handleListTools(id);
      break;
    case 'tools/call':
      response = await handleCallTool(id, message.params);
      break;
    default:
      response = jsonRpcError(id, -32601, `Unsupported method: ${message.method}`);
  }

  await writeNativeMessage(response);
}

// ── Main loop ────────────────────────────────────────────────────────────────

async function main() {
  while (true) {
    let envelope;
    try {
      envelope = await readMessage();
    } catch {
      break;
    }
    if (envelope === EOF) break;
    try {
      await handleMessage(envelope);
    } catch (err) {
      process.stderr.write(`[code-index-host] Error: ${err.message || err}\n`);
      await writeNativeMessage(jsonRpcError(null, -32603, err.message || 'Internal error'));
    }
  }
}

main().catch((err) => {
  process.stderr.write(`[code-index-host] Fatal: ${err.message || err}\n`);
  process.exit(1);
});
