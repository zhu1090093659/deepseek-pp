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
  const allSkillPaths = findLocalSkillPaths(rootPath);
  if (allSkillPaths.length === 0) {
    throw new Error(`No SKILL.md found under ${rootPath}`);
  }
  if (allSkillPaths.length > MAX_LOCAL_SKILLS) {
    warnings.push(`Found ${allSkillPaths.length} Skills; preview is limited to ${MAX_LOCAL_SKILLS}.`);
  }

  const limitedPaths = allSkillPaths.slice(0, MAX_LOCAL_SKILLS);
  const selected = selectedPaths
    ? limitedPaths.filter(path => selectedPaths.has(path))
    : limitedPaths;
  if (selectedPaths && selected.length === 0) {
    throw new Error('Selected local Skill paths were not found under the root path.');
  }

  let totalContentBytes = 0;
  const skills = [];
  for (const skillPath of selected) {
    const item = readLocalSkill(rootPath, skillPath, totalContentBytes);
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
    truncated: allSkillPaths.length > MAX_LOCAL_SKILLS || warnings.some(warning => warning.includes('content budget')),
  };
}

function findLocalSkillPaths(rootPath) {
  const result = [];
  walkLocalDirectory(rootPath, '', (relativePath, absolutePath, entry) => {
    if (!entry.isFile()) return;
    if (entry.name === 'SKILL.md') result.push(normalizeRelativePath(relativePath));
  });
  return result.sort((a, b) => a.localeCompare(b));
}

function readLocalSkill(rootPath, skillPath, usedContentBytes) {
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
  const bundle = collectLocalSkillResources(rootPath, directory, content, usedContentBytes + Buffer.byteLength(content, 'utf8'));
  const skill = {
    path: skillPath,
    directory,
    directoryPath,
    content,
    bodyBytes: Buffer.byteLength(content, 'utf8'),
    includedFiles: bundle.includedFiles,
    omittedFiles: bundle.omittedFiles,
    scriptFiles: bundle.scriptFiles,
    warnings: bundle.warnings,
  };
  const contentBytes = skill.bodyBytes + bundle.includedFiles.reduce((sum, file) => sum + file.bytes, 0);
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

    const content = readTextFile(candidate.absolutePath);
    const bytes = Buffer.byteLength(content, 'utf8');
    resourceBytes += bytes;
    totalBytes += bytes;
    includedFiles.push({ path: candidate.path, bytes, content });
  }

  return { includedFiles, omittedFiles, scriptFiles, warnings: dedupeStrings(warnings) };
}

function walkLocalDirectory(rootPath, prefix, visit, options = {}) {
  const stack = [{ absolutePath: rootPath, relativePrefix: prefix }];
  while (stack.length > 0) {
    const current = stack.pop();
    const entries = safeReadDirectory(current.absolutePath);
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === '.svn' || entry.name === '.hg') continue;
      const absolutePath = join(current.absolutePath, entry.name);
      const relativePath = normalizeRelativePath(join(current.relativePrefix, entry.name));
      visit(relativePath, absolutePath, entry);
      if (entry.isDirectory()) {
        if (options.stopAtNestedSkillRoots && hasLocalSkillFile(absolutePath)) continue;
        stack.push({ absolutePath, relativePrefix: relativePath });
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
