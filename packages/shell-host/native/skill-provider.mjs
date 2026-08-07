import { basename, dirname, join } from 'node:path';
import {
  LOCAL_SCRIPT_EXTENSIONS,
  LOCAL_TEXT_RESOURCE_EXTENSIONS,
  MAX_LOCAL_RESOURCE_BYTES_PER_SKILL,
  MAX_LOCAL_RESOURCE_FILE_BYTES,
  MAX_LOCAL_RESOURCE_FILES_PER_SKILL,
  MAX_LOCAL_SKILL_BYTES,
  MAX_LOCAL_SKILLS,
  MAX_LOCAL_TOTAL_CONTENT_BYTES,
} from './contracts.mjs';
import {
  readTextFile,
  resolveLocalPath,
  resolveUnderRoot,
  safeReadDirectory,
  safeStat,
} from './file-provider.mjs';

export function createSkillToolHandlers() {
  return [{ name: 'local_skill_preview', handle: createLocalSkillPreviewResult }];
}
function createLocalSkillPreviewResult(args) {
  const rootInput = args?.rootPath;
  if (typeof rootInput !== 'string' || rootInput.trim().length === 0) {
    return {
      isError: true,
      content: [{ type: 'text', text: 'rootPath is required and must be a non-empty string.' }],
    };
  }

  try {
    const selectedPaths = Array.isArray(args?.selectedPaths)
      ? new Set(args.selectedPaths.filter(item => typeof item === 'string' && item.trim()).map(normalizeRelativePath))
      : null;
    const data = scanLocalSkillFolder(rootInput, selectedPaths);
    return {
      content: [{ type: 'text', text: `Found ${data.skills.length} local Skill(s) in ${data.rootPath}` }],
      structuredContent: {
        ok: true,
        data,
      },
    };
  } catch (err) {
    return {
      isError: true,
      content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }],
    };
  }
}

function scanLocalSkillFolder(rootInput, selectedPaths) {
  const rootPath = resolveLocalPath(rootInput);
  const rootStat = safeStat(rootPath);
  if (!rootStat || !rootStat.isDirectory()) {
    throw new Error(`Local Skill root is not a readable directory: ${rootPath}`);
  }

  const warnings = [];
  const candidates = findLocalSkillCandidates(rootPath);
  if (candidates.length === 0) {
    throw new Error(`No valid Skill files (.md with required frontmatter, or SKILL.md) were found under ${rootPath}`);
  }
  if (candidates.length > MAX_LOCAL_SKILLS) {
    warnings.push(`Found ${candidates.length} Skills; preview is limited to ${MAX_LOCAL_SKILLS}.`);
  }

  const limitedPaths = candidates.slice(0, MAX_LOCAL_SKILLS);
  const selected = selectedPaths
    ? limitedPaths.filter(candidate => selectedPaths.has(candidate.path))
    : limitedPaths;
  if (selectedPaths && selected.length === 0) {
    throw new Error('Selected local Skill paths were not found under the root path.');
  }

  let totalContentBytes = 0;
  const skills = [];
  for (const candidate of selected) {
    const item = readLocalSkill(rootPath, candidate, totalContentBytes);
    totalContentBytes += item.contentBytes;
    skills.push(item.skill);
    warnings.push(...item.warnings);
  }

  return {
    rootPath,
    displayName: basename(rootPath) || rootPath,
    directoryName: basename(rootPath) || rootPath,
    skills,
    warnings: dedupeStrings(warnings),
    truncated: candidates.length > MAX_LOCAL_SKILLS || warnings.some(warning => warning.includes('content budget')),
  };
}

function findLocalSkillCandidates(rootPath) {
  const result = [];
  // Wide-net discovery within root + one level of subdirs:
  // - a SKILL.md marks a directory-style Skill (kind: 'dir');
  // - any other .md file is a candidate single-file Skill (kind: 'file').
  // Broad inclusion here; later vetting (frontmatter checks) filters out
  // mismatches such as README.md.
  walkLocalDirectory(rootPath, '', (relativePath, _absolutePath, entry) => {
    if (!entry.isFile()) return;
    const rel = normalizeRelativePath(relativePath);
    if (entry.name === 'SKILL.md') {
      result.push({ path: rel, kind: 'dir' });
    } else if (entry.name.toLowerCase().endsWith('.md')) {
      result.push({ path: rel, kind: 'file' });
    }
  }, { maxDepth: 1 });
  return result.sort((a, b) => a.path.localeCompare(b.path));
}

function readLocalSkill(rootPath, candidate, usedContentBytes) {
  const skillPath = candidate.path;
  const absoluteSkillPath = resolveUnderRoot(rootPath, skillPath);
  const skillStat = safeStat(absoluteSkillPath);
  if (!skillStat || !skillStat.isFile()) {
    throw new Error(`Local Skill file is not readable: ${skillPath}`);
  }
  if (skillStat.size > MAX_LOCAL_SKILL_BYTES) {
    throw new Error(`${skillPath} exceeds the SKILL.md size limit (${skillStat.size} bytes).`);
  }

  const content = readTextFile(absoluteSkillPath);
  const directory = normalizeRelativePath(dirname(skillPath));
  const directoryPath = dirname(absoluteSkillPath);

  let bundle;
  if (candidate.kind === 'file') {
    // Single-file Skills carry no nested resources; the file itself is the
    // only content. Bundle stays empty (no resource discovery).
    bundle = { includedFiles: [], omittedFiles: [], scriptFiles: [], warnings: [] };
  } else {
    bundle = collectLocalSkillResources(rootPath, directory, content, usedContentBytes + Buffer.byteLength(content, 'utf8'));
  }

  const skill = {
    path: skillPath,
    directory,
    directoryPath,
    kind: candidate.kind,
    content,
    bodyBytes: Buffer.byteLength(content, 'utf8'),
    includedFiles: bundle.includedFiles,
    omittedFiles: bundle.omittedFiles,
    scriptFiles: bundle.scriptFiles,
    warnings: bundle.warnings,
  };
  // includedFiles no longer carry content; contentBytes reflects only the
  // Skill body itself. The budget is enforced by file-size accounting inside
  // collectLocalSkillResources.
  const contentBytes = skill.bodyBytes;
  return {
    skill,
    contentBytes,
    warnings: bundle.warnings,
  };
}

function collectLocalSkillResources(rootPath, directory, skillBody, startingContentBytes) {
  const prefix = directory ? directory + '/' : '';
  const candidates = [];
  walkLocalDirectory(resolveUnderRoot(rootPath, directory || '.'), prefix, (relativePath, absolutePath, entry) => {
    if (!entry.isFile()) return;
    const normalized = normalizeRelativePath(relativePath);
    if (normalized === `${prefix}SKILL.md` || normalized.endsWith('/SKILL.md')) return;
    const stat = safeStat(absolutePath);
    if (!stat) return;
    candidates.push({
      path: normalized,
      absolutePath,
      bytes: stat.size,
    });
  }, { stopAtNestedSkillRoots: true });

  const scriptFiles = candidates
    .filter(candidate => isLocalScriptFile(candidate.path))
    .map(({ path, bytes }) => ({ path, bytes }));
  const textCandidates = candidates
    .filter(candidate => isLocalTextResource(candidate.path))
    .sort((a, b) => rankLocalResource(a.path, skillBody) - rankLocalResource(b.path, skillBody) || a.path.localeCompare(b.path));

  const includedFiles = [];
  const omittedFiles = [];
  const warnings = [];
  let resourceBytes = 0;
  let totalBytes = startingContentBytes;

  for (const candidate of textCandidates) {
    if (includedFiles.length >= MAX_LOCAL_RESOURCE_FILES_PER_SKILL) {
      omittedFiles.push({ path: candidate.path, bytes: candidate.bytes });
      continue;
    }
    if (candidate.bytes > MAX_LOCAL_RESOURCE_FILE_BYTES) {
      omittedFiles.push({ path: candidate.path, bytes: candidate.bytes });
      warnings.push(`${candidate.path} exceeds the per-file resource limit and was not bundled.`);
      continue;
    }
    if (resourceBytes + candidate.bytes > MAX_LOCAL_RESOURCE_BYTES_PER_SKILL) {
      omittedFiles.push({ path: candidate.path, bytes: candidate.bytes });
      continue;
    }
    if (totalBytes + candidate.bytes > MAX_LOCAL_TOTAL_CONTENT_BYTES) {
      omittedFiles.push({ path: candidate.path, bytes: candidate.bytes });
      warnings.push(`${candidate.path} was omitted because the local Skill preview reached the content budget.`);
      continue;
    }

    // Index-only import (Plan 2): record the resource path and size, never
    // read its content. The agent pulls content on demand via local_file_read
    // after activation (see design rules 6.3).
    resourceBytes += candidate.bytes;
    totalBytes += candidate.bytes;
    includedFiles.push({ path: candidate.path, bytes: candidate.bytes });
  }

  return { includedFiles, omittedFiles, scriptFiles, warnings: dedupeStrings(warnings) };
}

const SYS_DIRS = new Set(['node_modules', '.git', '.svn', '.hg']);

function walkLocalDirectory(rootPath, prefix, visit, options = {}) {
  // Depth-bound traversal: root is depth 0, first-level subdirs depth 1.
  // Default maxDepth is Infinity to preserve existing callers that need full
  // recursion (e.g. resource scanning); callers pass an explicit cap.
  const maxDepth = typeof options.maxDepth === 'number' ? options.maxDepth : Infinity;
  const stack = [{ absolutePath: rootPath, relativePrefix: prefix, depth: 0 }];
  while (stack.length > 0) {
    const current = stack.pop();
    const entries = safeReadDirectory(current.absolutePath);
    for (const entry of entries) {
      if (SYS_DIRS.has(entry.name)) continue;
      const absolutePath = join(current.absolutePath, entry.name);
      const relativePath = normalizeRelativePath(join(current.relativePrefix, entry.name));
      visit(relativePath, absolutePath, entry, current.depth);
      if (entry.isDirectory() && current.depth < maxDepth) {
        if (options.stopAtNestedSkillRoots && hasLocalSkillFile(absolutePath)) continue;
        stack.push({ absolutePath, relativePrefix: relativePath, depth: current.depth + 1 });
      }
    }
  }
}

function hasLocalSkillFile(directoryPath) {
  return safeStat(join(directoryPath, 'SKILL.md'))?.isFile() === true;
}

function isLocalTextResource(path) {
  return LOCAL_TEXT_RESOURCE_EXTENSIONS.has(pathExtension(path));
}

function isLocalScriptFile(path) {
  return LOCAL_SCRIPT_EXTENSIONS.has(pathExtension(path));
}

function rankLocalResource(path, skillBody) {
  const relativeName = path.split('/').slice(-2).join('/');
  if (skillBody.includes(path) || skillBody.includes(relativeName)) return 0;
  if (path.includes('/agents/')) return 1;
  if (path.includes('/references/')) return 2;
  if (path.includes('/templates/')) return 3;
  if (path.includes('/examples/')) return 4;
  return 5;
}

function pathExtension(path) {
  const name = path.split('/').pop() ?? '';
  const index = name.lastIndexOf('.');
  return index >= 0 ? name.slice(index).toLowerCase() : '';
}

function normalizeRelativePath(path) {
  const normalized = String(path || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  return normalized === '.' ? '' : normalized;
}

function dedupeStrings(values) {
  return [...new Set(values.filter(Boolean))];
}

// --- Shell execution ---
