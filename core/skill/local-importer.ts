import { executeMcpToolCall, refreshMcpServerDiscovery } from '../mcp/discovery';
import { getAllMcpServers, updateMcpServer } from '../mcp/store';
import { SHELL_MCP_NATIVE_HOST, SHELL_MCP_SERVER_NAME } from '../shell';
import type {
  LocalSkillImportRequest,
  LocalSkillImportResult,
  LocalSkillPreview,
  LocalSkillPreviewItem,
  LocalSkillSource,
  RemoteSkillFile,
  Skill,
} from '../types';
import type { McpServerConfig } from '../mcp/types';
import type { JsonValue, ToolResult } from '../tool/types';
import {
  getAllSkillSources,
  getSkillLibrary,
  upsertLocalSkillSource,
} from './registry';

const MAX_SKILL_BYTES = 120_000;
const LOCAL_SKILL_SHELL_TOOLS = ['local_skill_preview', 'local_folder_pick'];

interface LocalSkillHostBundle {
  rootPath: string;
  displayName: string;
  directoryName: string;
  skills: LocalSkillHostItem[];
  warnings: string[];
  truncated: boolean;
}

interface LocalSkillHostItem {
  path: string;
  directory: string;
  directoryPath: string;
  content: string;
  bodyBytes: number;
  includedFiles: Array<RemoteSkillFile & { content: string }>;
  omittedFiles: RemoteSkillFile[];
  scriptFiles: RemoteSkillFile[];
  warnings: string[];
}

interface LoadedLocalSkill {
  item: LocalSkillPreviewItem;
  skill: Skill;
}

interface LoadedLocalSource {
  preview: LocalSkillPreview;
  skills: LoadedLocalSkill[];
}

interface ParsedSkillDoc {
  name: string;
  description: string;
  body: string;
  version?: string;
  lastUpdated?: string;
}

interface ExistingSkillContext {
  occupiedNames: Set<string>;
  byName: Map<string, Skill>;
  bySourcePath: Map<string, Skill>;
}

export async function previewLocalSkillSource(rootPath: string): Promise<LocalSkillPreview> {
  return (await loadLocalSkillSource(rootPath)).preview;
}

export async function pickLocalSkillFolder(defaultPath?: string): Promise<string> {
  const server = await getShellMcpServer();
  const result = await executeShellMcpTool(server, 'local_folder_pick', {
    title: 'Choose a local Skill folder',
    ...(defaultPath ? { defaultPath } : {}),
  });

  if (!result.ok) {
    throw new Error(formatToolFailure(result));
  }
  return parseLocalFolderPickOutput(result.output);
}

export async function importLocalSkillSource(
  request: LocalSkillImportRequest,
): Promise<LocalSkillImportResult> {
  if (request.selectedPaths.length === 0) {
    throw new Error('Select at least one local Skill before importing.');
  }

  const loaded = await loadLocalSkillSource(request.rootPath, new Set(request.selectedPaths));
  const selected = loaded.skills.filter((skill) => request.selectedPaths.includes(skill.item.path));
  const importedPaths = new Set(selected.map((skill) => skill.item.path));
  const missingPaths = request.selectedPaths.filter((path) => !importedPaths.has(path));
  if (missingPaths.length > 0) {
    throw new Error(`Selected local Skill paths were not found: ${missingPaths.join(', ')}`);
  }
  if (selected.length === 0) {
    throw new Error('Selected local Skill paths were not found.');
  }

  const now = Date.now();
  const source: LocalSkillSource = {
    ...loaded.preview.source,
    skillPaths: selected.map((skill) => skill.item.path),
    importedSkillNames: selected.map((skill) => skill.skill.name),
    updatedAt: now,
    lastCheckedAt: now,
  };
  const incomingSkills = selected.map((loadedSkill) => ({
    ...loadedSkill.skill,
    remote: loadedSkill.skill.remote ? {
      ...loadedSkill.skill.remote,
      importedAt: loadedSkill.skill.remote.importedAt || now,
      updatedAt: now,
      lastCheckedAt: now,
    } : undefined,
  }));
  const result = await upsertLocalSkillSource(source, incomingSkills);

  return {
    ok: true,
    source: {
      ...source,
      importedSkillNames: result.imported.map((skill) => skill.name),
    },
    imported: result.imported,
    replaced: result.replaced,
    renamed: result.renamed,
    warnings: loaded.preview.warnings,
  };
}

async function loadLocalSkillSource(rootPath: string, selectedPaths?: Set<string>): Promise<LoadedLocalSource> {
  const bundle = await readLocalSkillBundle(rootPath, selectedPaths);
  if (bundle.skills.length === 0) {
    throw new Error('No SKILL.md was found under this local directory.');
  }

  const now = Date.now();
  const source: LocalSkillSource = {
    id: createLocalSourceId(bundle.rootPath),
    provider: 'local',
    rootPath: bundle.rootPath,
    displayName: bundle.displayName,
    directoryName: bundle.directoryName,
    skillPaths: bundle.skills.map((skill) => skill.path),
    importedSkillNames: [],
    importedAt: now,
    updatedAt: now,
    lastCheckedAt: now,
    warnings: bundle.warnings,
  };

  const existingContext = await createExistingSkillContext(source.id);
  const loadedSkills = bundle.skills.map((skill) => loadLocalSkill(source, skill, existingContext));
  const previewSkills = loadedSkills.map((skill) => skill.item);

  return {
    preview: {
      source: {
        ...source,
        skillPaths: previewSkills.map((skill) => skill.path),
        importedSkillNames: previewSkills.map((skill) => skill.importName),
      },
      skills: previewSkills,
      warnings: bundle.warnings,
      truncated: bundle.truncated,
    },
    skills: loadedSkills,
  };
}

function loadLocalSkill(
  source: LocalSkillSource,
  hostSkill: LocalSkillHostItem,
  existingContext: ExistingSkillContext,
): LoadedLocalSkill {
  const warnings = [...hostSkill.warnings];
  if (hostSkill.content.length > MAX_SKILL_BYTES) {
    throw new Error(`${hostSkill.path} is too large to import (${hostSkill.content.length} bytes).`);
  }

  const parsed = parseSkillDoc(hostSkill.content, hostSkill.path);
  const existingRemoteSkill = existingContext.bySourcePath.get(`${source.id}:${hostSkill.path}`);
  const baseImportName = existingRemoteSkill?.name ?? parsed.name;
  const importName = existingRemoteSkill?.name ?? createUniqueSkillName(baseImportName, existingContext.occupiedNames);
  existingContext.occupiedNames.add(importName);

  const now = Date.now();
  const instructions = buildLocalImportedInstructions({
    source,
    skillPath: hostSkill.path,
    directory: hostSkill.directory,
    directoryPath: hostSkill.directoryPath,
    parsed,
    resources: hostSkill.includedFiles,
    omittedFiles: hostSkill.omittedFiles,
    scriptFiles: hostSkill.scriptFiles,
  });
  const remote = {
    provider: 'local' as const,
    sourceId: source.id,
    path: hostSkill.path,
    originalName: parsed.name,
    importedAt: existingRemoteSkill?.remote?.importedAt ?? now,
    updatedAt: now,
    lastCheckedAt: now,
    localRootPath: source.rootPath,
    localDirectory: hostSkill.directoryPath,
    localDisplayName: source.displayName,
    upstreamVersion: parsed.version,
    upstreamUpdatedAt: parsed.lastUpdated,
    includedFiles: hostSkill.includedFiles.map(({ content: _content, ...file }) => file),
    omittedFiles: hostSkill.omittedFiles,
    scriptFiles: hostSkill.scriptFiles,
    warnings,
  };
  const skill: Skill = {
    name: importName,
    description: parsed.description,
    instructions,
    source: 'remote',
    memoryEnabled: false,
    enabled: existingRemoteSkill?.enabled ?? true,
    metadata: {
      provider: 'local',
      sourceId: source.id,
      rootPath: source.rootPath,
      path: hostSkill.path,
      originalName: parsed.name,
      localDirectory: hostSkill.directoryPath,
      upstreamVersion: parsed.version ?? '',
    },
    remote,
  };

  const conflictingSkill = existingContext.byName.get(parsed.name);
  const includedFiles = remote.includedFiles;
  const item: LocalSkillPreviewItem = {
    path: hostSkill.path,
    name: parsed.name,
    importName,
    description: parsed.description,
    version: parsed.version,
    lastUpdated: parsed.lastUpdated,
    bytes: hostSkill.content.length + includedFiles.reduce((sum, file) => sum + file.bytes, 0),
    bodyBytes: hostSkill.content.length,
    includedFiles,
    omittedFiles: remote.omittedFiles,
    scriptFiles: remote.scriptFiles ?? [],
    warnings,
    nameChanged: importName !== parsed.name,
    existingSkillName: existingRemoteSkill?.name ?? conflictingSkill?.name,
    existingSourceId: existingRemoteSkill?.remote?.sourceId ?? conflictingSkill?.remote?.sourceId,
  };

  return { item, skill };
}

async function createExistingSkillContext(sourceId: string): Promise<ExistingSkillContext> {
  const [skills, sources] = await Promise.all([
    getSkillLibrary(),
    getAllSkillSources(),
  ]);
  const validSourceIds = new Set(sources.map((source) => source.id));
  validSourceIds.add(sourceId);
  const byName = new Map(skills.map((skill) => [skill.name, skill]));
  const bySourcePath = new Map<string, Skill>();
  for (const skill of skills) {
    if (skill.source === 'remote' && skill.remote && validSourceIds.has(skill.remote.sourceId)) {
      bySourcePath.set(`${skill.remote.sourceId}:${skill.remote.path}`, skill);
    }
  }

  return {
    occupiedNames: new Set(skills.map((skill) => skill.name)),
    byName,
    bySourcePath,
  };
}

async function readLocalSkillBundle(rootPath: string, selectedPaths?: Set<string>): Promise<LocalSkillHostBundle> {
  const server = await getShellMcpServer();
  const result = await executeShellMcpTool(server, 'local_skill_preview', {
    rootPath,
    ...(selectedPaths ? { selectedPaths: [...selectedPaths] } : {}),
  });

  if (!result.ok) {
    throw new Error(formatToolFailure(result));
  }
  return parseLocalSkillHostBundle(result.output);
}

async function executeShellMcpTool(
  server: McpServerConfig,
  name: 'local_skill_preview' | 'local_folder_pick',
  payload: Record<string, unknown>,
): Promise<ToolResult> {
  const call = {
    name,
    descriptorId: `mcp:${server.id}:${name}`,
    provider: {
      kind: 'mcp' as const,
      id: server.id,
      displayName: server.displayName,
      transport: server.transport.kind,
    },
    payload,
    raw: '',
    source: { trigger: 'manual_chat' as const },
  };
  const result = await executeMcpToolCall(call);
  if (result.ok || result.error?.code !== 'mcp_tool_not_found') return result;
  await refreshMcpServerDiscovery(server.id);
  return executeMcpToolCall(call);
}

async function getShellMcpServer(): Promise<McpServerConfig> {
  const servers = await getAllMcpServers({ includeSecrets: false });
  let server = servers.find((candidate) =>
    candidate.transport.kind === 'native_messaging' &&
    candidate.transport.nativeHost === SHELL_MCP_NATIVE_HOST
  ) ?? servers.find((candidate) => candidate.displayName === SHELL_MCP_SERVER_NAME);

  if (!server) {
    throw new Error('Shell MCP was not found. Create and install Shell Native Host from the MCP page first.');
  }
  if (!server.enabled) {
    throw new Error('Shell MCP is disabled. Enable Shell Local on the MCP page first.');
  }
  if (!server.execution.enabled || server.execution.mode === 'disabled') {
    throw new Error('Shell MCP execution is disabled. Enable manual execution on the MCP page before importing local Skills.');
  }
  server = await ensureLocalSkillShellToolsAllowed(server);
  return server;
}

async function ensureLocalSkillShellToolsAllowed(server: McpServerConfig): Promise<McpServerConfig> {
  if (server.allowlist.mode !== 'allow') return server;
  const names = new Set(server.allowlist.toolNames);
  const missing = LOCAL_SKILL_SHELL_TOOLS.filter((name) => !names.has(name));
  if (missing.length === 0) return server;

  const updated = await updateMcpServer(server.id, {
    allowlist: {
      mode: 'allow',
      toolNames: [...server.allowlist.toolNames, ...missing],
    },
  });
  return updated ?? server;
}

function parseLocalSkillHostBundle(output: JsonValue | undefined): LocalSkillHostBundle {
  const value = output && typeof output === 'object' && !Array.isArray(output)
    ? output as Record<string, unknown>
    : {};
  const data = value.data && typeof value.data === 'object' && !Array.isArray(value.data)
    ? value.data as Record<string, unknown>
    : value;
  const rootPath = readRequiredString(data, 'rootPath');
  const displayName = readRequiredString(data, 'displayName');
  const directoryName = readRequiredString(data, 'directoryName');
  const skills = readArray(data.skills).map(parseHostSkill);
  return {
    rootPath,
    displayName,
    directoryName,
    skills,
    warnings: readStringArray(data.warnings),
    truncated: data.truncated === true,
  };
}

function parseLocalFolderPickOutput(output: JsonValue | undefined): string {
  const value = output && typeof output === 'object' && !Array.isArray(output)
    ? output as Record<string, unknown>
    : {};
  const data = value.data && typeof value.data === 'object' && !Array.isArray(value.data)
    ? value.data as Record<string, unknown>
    : value;
  const path = data.path;
  if (typeof path !== 'string' || !path.trim()) {
    throw new Error('Shell MCP local_folder_pick response is missing path');
  }
  return path.trim();
}

function parseHostSkill(value: unknown): LocalSkillHostItem {
  const data = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  return {
    path: readRequiredString(data, 'path'),
    directory: readRequiredString(data, 'directory'),
    directoryPath: readRequiredString(data, 'directoryPath'),
    content: readRequiredString(data, 'content'),
    bodyBytes: readNumber(data.bodyBytes),
    includedFiles: readArray(data.includedFiles).map(parseContentFile),
    omittedFiles: readArray(data.omittedFiles).map(parseFile),
    scriptFiles: readArray(data.scriptFiles).map(parseFile),
    warnings: readStringArray(data.warnings),
  };
}

function parseContentFile(value: unknown): RemoteSkillFile & { content: string } {
  const data = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  return {
    ...parseFile(data),
    content: readRequiredString(data, 'content'),
  };
}

function parseFile(value: unknown): RemoteSkillFile {
  const data = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  return {
    path: readRequiredString(data, 'path'),
    bytes: readNumber(data.bytes),
  };
}

function buildLocalImportedInstructions(input: {
  source: LocalSkillSource;
  skillPath: string;
  directory: string;
  directoryPath: string;
  parsed: ParsedSkillDoc;
  resources: Array<RemoteSkillFile & { content: string }>;
  omittedFiles: RemoteSkillFile[];
  scriptFiles: RemoteSkillFile[];
}): string {
  const { source, skillPath, directory, directoryPath, parsed, resources, omittedFiles, scriptFiles } = input;
  const header = [
    `# Local Skill: ${parsed.name}`,
    '',
    '## DeepSeek++ Import Metadata',
    '',
    `- Source: ${source.displayName}`,
    `- Root path: ${source.rootPath}`,
    `- Skill path: ${skillPath}`,
    `- Skill directory: ${directory || '.'}`,
    `- Skill directory path: ${directoryPath}`,
    parsed.version ? `- Upstream version: ${parsed.version}` : '',
    parsed.lastUpdated ? `- Upstream updated: ${parsed.lastUpdated}` : '',
    `- Bundled supporting files: ${resources.length}`,
    scriptFiles.length > 0 ? `- Local executable/script files: ${scriptFiles.length}` : '',
    omittedFiles.length > 0 ? `- Omitted supporting files: ${omittedFiles.length}` : '',
  ].filter(Boolean).join('\n');

  const executionBoundary = [
    '## Local Execution Boundary',
    '',
    '- This Skill was imported by reference from a local folder. The extension did not execute any local script during import.',
    '- If the task requires a bundled script, use Shell MCP only when the tool list exposes the needed shell tool. Do not invent command results.',
    `- Run commands with cwd set to the Skill directory path: ${directoryPath}`,
    '- Use shell_status first when command syntax or platform-specific quoting matters.',
    '- Treat paths shown here as local user-machine paths. Do not expose or rewrite them unless the user asks.',
  ].join('\n');

  const body = [
    '## Upstream SKILL.md',
    '',
    parsed.body.trim(),
  ].join('\n');

  const scripts = scriptFiles.length === 0 ? '' : [
    '## Local Script Files',
    '',
    'These scripts remain in the local Skill directory. Import does not execute them and does not bundle their source into the prompt.',
    '',
    ...scriptFiles.map((file) => `- ${file.path} (${file.bytes} bytes)`),
  ].join('\n');

  const resourceDocs = resources.length === 0 ? '' : [
    '## Bundled Supporting Files',
    '',
    'These text files come from the same local Skill directory and supplement agents, references, templates, or examples referenced by the original SKILL.md.',
    '',
    ...resources.map((resource) => [
      `### ${resource.path}`,
      '',
      resource.content.trim(),
    ].join('\n')),
  ].join('\n\n');

  const omitted = omittedFiles.length === 0 ? '' : [
    '## Omitted Supporting Files',
    '',
    'These files were not bundled into the prompt because of count, size, or type limits. Inspect the local directory when needed.',
    '',
    ...omittedFiles.map((file) => `- ${file.path} (${file.bytes} bytes)`),
  ].join('\n');

  return [header, executionBoundary, body, scripts, resourceDocs, omitted].filter(Boolean).join('\n\n---\n\n');
}

function parseSkillDoc(raw: string, path: string): ParsedSkillDoc {
  const frontmatter = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  const meta = frontmatter ? parseYamlSubset(frontmatter[1]) : {};
  const body = frontmatter ? raw.slice(frontmatter[0].length).trim() : raw.trim();
  const name = normalizeSkillName(readString(meta, 'name') ?? parentDirectory(path).split('/').pop() ?? path.replace(/\/?SKILL\.md$/, ''));
  const description = readString(meta, 'description') ?? firstParagraph(body) ?? `Imported local Skill from ${path}`;
  const metadata = readObject(meta, 'metadata');
  const version = readString(metadata, 'version') ?? readString(meta, 'version');
  const lastUpdated = readString(metadata, 'last_updated') ?? readString(metadata, 'lastUpdated') ?? readString(meta, 'last_updated');

  return { name, description, body, version, lastUpdated };
}

function parseYamlSubset(raw: string): Record<string, unknown> {
  const lines = raw.replace(/\r\n/g, '\n').split('\n');
  const result: Record<string, unknown> = {};
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const match = line.match(/^([A-Za-z0-9_-]+):(?:\s*(.*))?$/);
    if (!match) continue;
    const key = match[1];
    const value = match[2] ?? '';
    if (value === '|' || value === '|-' || value === '>' || value === '>-') {
      const block: string[] = [];
      while (i + 1 < lines.length && /^(\s+|$)/.test(lines[i + 1])) {
        i += 1;
        block.push(lines[i].replace(/^\s{2,}/, ''));
      }
      result[key] = value.startsWith('>') ? block.join(' ').replace(/\s+/g, ' ').trim() : block.join('\n').trim();
      continue;
    }
    if (value === '') {
      const nested: Record<string, string> = {};
      while (i + 1 < lines.length && /^\s+/.test(lines[i + 1])) {
        i += 1;
        const nestedMatch = lines[i].match(/^\s+([A-Za-z0-9_-]+):\s*(.*)$/);
        if (nestedMatch) nested[nestedMatch[1]] = cleanYamlScalar(nestedMatch[2]);
      }
      result[key] = nested;
      continue;
    }
    result[key] = cleanYamlScalar(value);
  }
  return result;
}

function cleanYamlScalar(value: string): string {
  const trimmed = value.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function readString(record: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = record?.[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function readObject(record: Record<string, unknown>, key: string): Record<string, unknown> | undefined {
  const value = record[key];
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function readRequiredString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== 'string') throw new Error(`Shell MCP local_skill_preview response is missing ${key}`);
  return value;
}

function readNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function firstParagraph(body: string): string | undefined {
  const paragraph = body
    .replace(/^# .+$/m, '')
    .split(/\n\s*\n/)
    .map((part) => part.replace(/\s+/g, ' ').trim())
    .find((part) => part.length > 0 && !part.startsWith('```'));
  return paragraph ? paragraph.slice(0, 240) : undefined;
}

function createLocalSourceId(rootPath: string): string {
  return `local:${rootPath}`;
}

function parentDirectory(path: string): string {
  const parts = path.split('/');
  parts.pop();
  return parts.join('/');
}

function normalizeSkillName(name: string): string {
  const normalized = name.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  if (!normalized) throw new Error('Local Skill is missing a valid name.');
  return normalized;
}

function createUniqueSkillName(preferred: string, occupiedNames: Set<string>): string {
  const normalized = normalizeSkillName(preferred);
  if (!occupiedNames.has(normalized)) return normalized;
  for (let suffix = 2; suffix < 1000; suffix += 1) {
    const candidate = `${normalized}-${suffix}`;
    if (!occupiedNames.has(candidate)) return candidate;
  }
  throw new Error(`Unable to generate a unique name for local Skill: ${preferred}`);
}

function formatToolFailure(result: ToolResult): string {
  if (result.error?.code === 'mcp_tool_not_found' && result.name === 'local_folder_pick') {
    return 'Current Shell Native Host does not expose local_folder_pick. Reinstall Shell Native Host from the MCP page, restart the browser, then try again.';
  }
  if (result.error?.code === 'mcp_tool_not_found' && result.name === 'local_skill_preview') {
    return 'Current Shell Native Host does not expose local_skill_preview. Reinstall Shell Native Host from the MCP page, restart the browser, then try again.';
  }
  const message = result.error?.message || result.detail || result.summary || 'Local Skill scan failed';
  if (isLegacyWindowsFolderPickerFailure(message)) {
    return [
      'The installed Shell Native Host is older than the extension and still passes folder picker labels as PowerShell command text.',
      'Reinstall Shell Native Host from the MCP page or run `npx deepseek-pp-shell-host install --browser chrome --extension-id <your-extension-id>`, restart the browser, then try local Skill import again.',
    ].join(' ');
  }
  return message;
}

function isLegacyWindowsFolderPickerFailure(message: string): boolean {
  return /powershell\.exe[\s\S]*-Command[\s\S]*FolderBrowserDialog/i.test(message) &&
    /CommandNotFoundException|ObjectNotFound|Choose a local Skill folder|Choose\s*:/i.test(message);
}
