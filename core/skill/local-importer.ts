import { getMcpToolDescriptors, refreshMcpServerDiscovery } from '../mcp/discovery';
import { getAllMcpServers, getMcpToolCache, updateMcpServer } from '../mcp/store';
import { buildShellAllowlistUpgrade, isShellMcpServer } from '../shell';
import type {
  LocalSkillImportRequest,
  LocalSkillImportBlock,
  LocalSkillImportBlockCode,
  LocalSkillImportResponse,
  LocalSkillPreview,
  LocalSkillPreviewItem,
  LocalSkillSource,
  RemoteSkillFile,
  Skill,
} from '../types';
import type { McpServerConfig } from '../mcp/types';
import type { LocalStateMutationRunner } from '../persistence/local-state-mutation';
import type { JsonValue, ToolResult } from '../tool/types';
import type { ToolCall } from '../tool/types';
import {
  getAllSkillSources,
  getSkillCollisionCandidates,
  stageUpsertLocalSkillSourceAlreadyLocked,
  type SkillCollisionCandidate,
} from './registry';

const MAX_SKILL_BYTES = 120_000;
const ON_DEMAND_RESOURCE_READER_NAMES = new Set(['local_file_read', 'shell_exec']);
const STALE_LOCAL_FILE_READ_MESSAGE = [
  'Current Shell Native Host can preview local Skills but does not expose local_file_read, and shell_exec is not available to chat.',
  'Reinstall Shell Native Host from MCP > Shell Local to add the least-privilege reader, restart the browser, then try again.',
].join(' ');

interface LocalSkillHostBundle {
  rootPath: string;
  displayName: string;
  directoryName: string;
  skills: LocalSkillHostItem[];
  warnings: string[];
  truncated: boolean;
}

interface LocalSkillBundleReadResult {
  bundle: LocalSkillHostBundle;
  onDemandResourceBlock?: LocalSkillImportBlock;
}

interface OnDemandResourceIssue {
  code: LocalSkillImportBlockCode;
  detail?: string;
  message: string;
}

class LocalSkillImportBlockedError extends Error {
  constructor(
    message: string,
    readonly importBlock: LocalSkillImportBlock,
  ) {
    super(message);
    this.name = 'LocalSkillImportBlockedError';
  }
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
  byName: Map<string, SkillCollisionCandidate>;
  bySourcePath: Map<string, SkillCollisionCandidate>;
}

export interface LocalSkillImporterDeps {
  executeToolCall(call: ToolCall): Promise<ToolResult>;
}

export interface LocalSkillImportDeps extends LocalSkillImporterDeps, LocalStateMutationRunner {}

export async function previewLocalSkillSource(
  rootPath: string,
  deps: LocalSkillImporterDeps,
): Promise<LocalSkillPreview> {
  return (await loadLocalSkillSource(rootPath, undefined, undefined, deps)).preview;
}

export async function pickLocalSkillFolder(
  defaultPath?: string,
  deps?: LocalSkillImporterDeps,
): Promise<string> {
  if (!deps) throw new Error('Local Skill importer runtime executor is required.');
  const server = await getShellMcpServer();
  const result = await executeShellMcpTool(server, 'local_folder_pick', {
    title: 'Choose a local Skill folder',
    ...(defaultPath ? { defaultPath } : {}),
  }, deps);

  if (!result.ok) {
    throw new Error(formatToolFailure(result));
  }
  return parseLocalFolderPickOutput(result.output);
}

export async function importLocalSkillSource(
  request: LocalSkillImportRequest,
  deps: LocalSkillImportDeps,
): Promise<LocalSkillImportResponse> {
  if (request.selectedPaths.length === 0) {
    throw new Error('Select at least one local Skill before importing.');
  }

  const selectedImportNames = new Map(Object.entries(request.selectedImportNames ?? {}));
  let loaded: LoadedLocalSource;
  try {
    loaded = await loadLocalSkillSource(
      request.rootPath,
      new Set(request.selectedPaths),
      selectedImportNames,
      deps,
    );
  } catch (error) {
    if (error instanceof LocalSkillImportBlockedError) {
      return {
        ok: false,
        error: error.message,
        importBlock: error.importBlock,
      };
    }
    throw error;
  }
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
  const result = await deps.runLocalStateMutation(() => (
    stageUpsertLocalSkillSourceAlreadyLocked(source, incomingSkills)
  ));

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

async function loadLocalSkillSource(
  rootPath: string,
  selectedPaths?: Set<string>,
  selectedImportNames?: ReadonlyMap<string, string>,
  deps?: LocalSkillImporterDeps,
): Promise<LoadedLocalSource> {
  if (!deps) throw new Error('Local Skill importer runtime executor is required.');
  const { bundle, onDemandResourceBlock } = await readLocalSkillBundle(rootPath, selectedPaths, deps);
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
  const loadedSkills = bundle.skills.map((skill) => loadLocalSkill(
    source,
    skill,
    existingContext,
    skill.omittedFiles.length > 0 ? onDemandResourceBlock : undefined,
    selectedImportNames?.get(skill.path),
  ));
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
  importBlock?: LocalSkillImportBlock,
  selectedImportName?: string,
): LoadedLocalSkill {
  const warnings = [...hostSkill.warnings];
  if (hostSkill.content.length > MAX_SKILL_BYTES) {
    throw new Error(`${hostSkill.path} is too large to import (${hostSkill.content.length} bytes).`);
  }

  const parsed = parseSkillDoc(hostSkill.content, hostSkill.path);
  const existingRemoteSkill = existingContext.bySourcePath.get(`${source.id}:${hostSkill.path}`);
  const baseImportName = existingRemoteSkill?.name ?? selectedImportName ?? parsed.name;
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
    importBlock,
    nameChanged: importName !== parsed.name,
    existingSkillName: existingRemoteSkill?.name ?? conflictingSkill?.name,
    existingSourceId: existingRemoteSkill?.remote?.sourceId ?? conflictingSkill?.remote?.sourceId,
  };

  return { item, skill };
}

async function createExistingSkillContext(sourceId: string): Promise<ExistingSkillContext> {
  const [skills, sources] = await Promise.all([
    getSkillCollisionCandidates(),
    getAllSkillSources(),
  ]);
  const validSourceIds = new Set(sources.map((source) => source.id));
  validSourceIds.add(sourceId);
  const byName = new Map(skills.map((skill) => [skill.name, skill]));
  const bySourcePath = new Map<string, SkillCollisionCandidate>();
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

async function readLocalSkillBundle(
  rootPath: string,
  selectedPaths: Set<string> | undefined,
  deps: LocalSkillImporterDeps,
): Promise<LocalSkillBundleReadResult> {
  const server = await getShellMcpServer();
  const result = await executeShellMcpTool(server, 'local_skill_preview', {
    rootPath,
    ...(selectedPaths ? { selectedPaths: [...selectedPaths] } : {}),
  }, deps);

  if (!result.ok) {
    throw new Error(formatToolFailure(result));
  }
  const bundle = parseLocalSkillHostBundle(result.output);
  const onDemandResourceIssue = await getOnDemandResourceIssue(server, bundle);
  if (selectedPaths && onDemandResourceIssue) {
    throw new LocalSkillImportBlockedError(
      onDemandResourceIssue.message,
      toLocalSkillImportBlock(onDemandResourceIssue),
    );
  }
  return {
    bundle,
    onDemandResourceBlock: onDemandResourceIssue
      ? toLocalSkillImportBlock(onDemandResourceIssue)
      : undefined,
  };
}

function toLocalSkillImportBlock(issue: OnDemandResourceIssue): LocalSkillImportBlock {
  return {
    code: issue.code,
    ...(issue.detail ? { detail: issue.detail } : {}),
  };
}

async function getOnDemandResourceIssue(
  server: McpServerConfig,
  bundle: LocalSkillHostBundle,
): Promise<OnDemandResourceIssue | null> {
  const hasOnDemandResources = bundle.skills.some((skill) => skill.omittedFiles.length > 0);
  if (!hasOnDemandResources) return null;

  const discovery = await refreshMcpServerDiscovery(server.id);
  if (discovery.health.status === 'error') {
    const detail = discovery.health.error || 'MCP discovery failed.';
    return {
      code: 'shell_discovery_failed',
      detail,
      message: `Unable to verify Shell MCP local_file_read availability: ${detail}`,
    };
  }
  const runtimeDescriptors = await getMcpToolDescriptors();
  const reader = runtimeDescriptors.find((descriptor) =>
    descriptor.provider.kind === 'mcp' &&
    descriptor.provider.id === server.id &&
    ON_DEMAND_RESOURCE_READER_NAMES.has(descriptor.name)
  );
  if (reader) return null;

  const hasLocalFileReader = discovery.descriptors.some((descriptor) => descriptor.name === 'local_file_read');
  if (!hasLocalFileReader) {
    return {
      code: 'shell_host_update_required',
      message: STALE_LOCAL_FILE_READ_MESSAGE,
    };
  }
  return {
    code: 'shell_reader_unavailable',
    message: 'Shell MCP on-demand file reading is not available to chat. Set Shell Local execution mode to Auto and allow local_file_read before importing this Skill.',
  };
}

async function executeShellMcpTool(
  server: McpServerConfig,
  name: 'local_skill_preview' | 'local_folder_pick',
  payload: Record<string, unknown>,
  deps: LocalSkillImporterDeps,
): Promise<ToolResult> {
  const descriptorId = `mcp:${server.id}:${name}`;
  const cache = await getMcpToolCache(server.id);
  if (!cache?.descriptors.some((descriptor) => descriptor.id === descriptorId)) {
    await refreshMcpServerDiscovery(server.id);
  }
  const call = {
    name,
    descriptorId,
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
  const result = await deps.executeToolCall(call);
  if (result.ok || result.error?.code !== 'mcp_tool_not_found') return result;
  await refreshMcpServerDiscovery(server.id);
  return deps.executeToolCall(call);
}

async function getShellMcpServer(): Promise<McpServerConfig> {
  const servers = await getAllMcpServers({ includeSecrets: false });
  let server = servers.find((candidate) =>
    candidate.transport.kind === 'native_messaging' &&
    isShellMcpServer(candidate)
  );

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
  const upgradedAllowlist = buildShellAllowlistUpgrade(server.allowlist);
  if (!upgradedAllowlist) return server;

  const updated = await updateMcpServer(server.id, {
    allowlist: upgradedAllowlist,
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
    omittedFiles.length > 0 ? `- Supporting files available on demand: ${omittedFiles.length}` : '',
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
    ...scriptFiles.map((file) => `- ${relativeToSkillDirectory(file.path, directory)} (${file.bytes} bytes)`),
  ].join('\n');

  const resourceDocs = resources.length === 0 ? '' : [
    '## Bundled Supporting Files',
    '',
    'These text files come from the same local Skill directory and supplement agents, references, templates, or examples referenced by the original SKILL.md.',
    '',
    ...resources.map((resource) => [
      `### ${relativeToSkillDirectory(resource.path, directory)}`,
      '',
      resource.content.trim(),
    ].join('\n')),
  ].join('\n\n');

  const omitted = omittedFiles.length === 0 ? '' : [
    '## Supporting Files Available on Demand',
    '',
    'These files remain in the referenced local Skill directory and were not bundled into the prompt because of count or size limits. Read them with Shell MCP when the upstream instructions need them.',
    '',
    ...omittedFiles.map((file) => `- ${relativeToSkillDirectory(file.path, directory)} (${file.bytes} bytes)`),
  ].join('\n');

  return [header, executionBoundary, body, scripts, resourceDocs, omitted].filter(Boolean).join('\n\n---\n\n');
}

function relativeToSkillDirectory(path: string, directory: string): string {
  const normalizedPath = path.replace(/\\/g, '/').replace(/^\/+/, '');
  const normalizedDirectory = directory.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  if (!normalizedDirectory) return normalizedPath;
  const prefix = `${normalizedDirectory}/`;
  return normalizedPath.startsWith(prefix) ? normalizedPath.slice(prefix.length) : normalizedPath;
}

function parseSkillDoc(raw: string, path: string): ParsedSkillDoc {
  // Strip a leading UTF-8/UTF-16 BOM so the `^---` frontmatter fence still
  // matches. Editors on Windows (notably Notepad/VS Code with BOM presets)
  // commonly save SKILL.md with a BOM, which previously made the frontmatter
  // regex miss and dropped `name:` along with it (issue #296).
  const bomStripped = raw.replace(/^\uFEFF/, '');
  const frontmatter = bomStripped.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  const meta = frontmatter ? parseYamlSubset(frontmatter[1]) : {};
  const body = frontmatter ? bomStripped.slice(frontmatter[0].length).trim() : bomStripped.trim();
  const name = normalizeSkillName(
    readString(meta, 'name')
    ?? extractH1Title(body)
    ?? parentDirectory(path).split('/').pop()
    ?? path.replace(/\/?SKILL\.md$/i, ''),
  );
  const description = readString(meta, 'description') ?? firstParagraph(body) ?? `Imported local Skill from ${path}`;
  const metadata = readObject(meta, 'metadata');
  const version = readString(metadata, 'version') ?? readString(meta, 'version');
  const lastUpdated = readString(metadata, 'last_updated') ?? readString(metadata, 'lastUpdated') ?? readString(meta, 'last_updated');

  return { name, description, body, version, lastUpdated };
}

function extractH1Title(body: string): string | undefined {
  const match = body.match(/^\s*#\s+(.+?)\s*$/m);
  return match ? match[1] : undefined;
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
  // Normalize Windows backslashes so D:\foo\bar\SKILL.md resolves correctly.
  const normalized = path.replace(/\\/g, '/');
  const parts = normalized.split('/');
  parts.pop();
  return parts.join('/');
}

function normalizeSkillName(name: string): string {
  const normalized = name.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  // Slug collision with non-ASCII names (Chinese titles, etc.) used to throw a
  // hard error and block local Skill import entirely (issue #296). Fall back to
  // a stable hash-derived slug so the import always succeeds; the user can
  // rename it from the Skills UI afterwards.
  if (!normalized) return `skill-${shortHash(name || 'unnamed')}`;
  return normalized;
}

function shortHash(input: string): string {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash << 5) - hash + input.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(36).slice(0, 8).padStart(2, '0');
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
      'Open MCP > Shell Local > Shell Native Host, copy the generated install command from that page, run it, then restart the browser.',
      'Do not run a placeholder command with <extension-id>; the MCP page command includes the current browser and extension id.',
    ].join(' ');
  }
  return message;
}

function isLegacyWindowsFolderPickerFailure(message: string): boolean {
  return /powershell\.exe[\s\S]*-Command[\s\S]*FolderBrowserDialog/i.test(message) &&
    /CommandNotFoundException|ObjectNotFound|Choose a local Skill folder|Choose\s*:/i.test(message);
}
