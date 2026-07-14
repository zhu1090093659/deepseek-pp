import { SHELL_MCP_NATIVE_HOST, SHELL_TOOL_NAMES } from '../shell';
import type { Skill } from '../types';
import { bundledSkillAssets } from './bundled-assets';

const SKILL_ORDER = [
  'spec-driven-develop',
  'deep-discuss',
  'review-spd',
] as const;

const SPEC_DRIVEN_DEVELOP_PROVIDER = 'spec-driven-develop';
const SPEC_DRIVEN_DEVELOP_HOMEPAGE = 'https://github.com/zhu1090093659/spec_driven_develop';
const DEFAULT_ENABLED_SKILLS = new Set(['deep-discuss']);

interface OfficialSkillDoc {
  name: string;
  description: string;
  body: string;
  version: string;
}

const officialSkillDocPromises = new Map<string, Promise<OfficialSkillDoc>>();

export async function loadThirdPartySpecDrivenDevelopSkills(
  requestedNames: readonly string[],
): Promise<Skill[]> {
  const requested = new Set(requestedNames);
  const knownNames = new Set<string>(SKILL_ORDER);
  for (const name of requested) {
    if (!knownNames.has(name)) {
      throw new Error(`Unknown bundled Spec-Driven Develop Skill: ${name}`);
    }
  }
  return Promise.all(
    SKILL_ORDER
      .filter((name) => requested.has(name))
      .map((name) => createThirdPartySpecDrivenDevelopSkill(name)),
  );
}

async function createThirdPartySpecDrivenDevelopSkill(name: string): Promise<Skill> {
  const doc = await getOfficialSkillDoc(name);
  return {
    name: doc.name,
    description: doc.description,
    instructions: await buildOfficialSkillInstructions(name, doc),
    source: 'third-party',
    memoryEnabled: false,
    enabled: DEFAULT_ENABLED_SKILLS.has(name),
    metadata: {
      provider: SPEC_DRIVEN_DEVELOP_PROVIDER,
      kind: 'spec-driven-develop-skill',
      version: doc.version,
      homepage: SPEC_DRIVEN_DEVELOP_HOMEPAGE,
    },
  };
}

async function buildOfficialSkillInstructions(
  name: string,
  doc: OfficialSkillDoc,
): Promise<string> {
  const [referenceDocs, scriptDocs] = await Promise.all([
    renderReferenceDocs(name),
    renderScriptDocs(name),
  ]);
  const officialDoc = renderOfficialDoc(doc.name, doc.body);

  const parts = [
    renderDeepSeekExecutionGuardrails(),
    officialDoc,
    ...referenceDocs,
  ];

  if (scriptDocs.length > 0) {
    parts.push(...scriptDocs);
  }

  return parts.filter(Boolean).join('\n\n---\n\n');
}

async function renderReferenceDocs(skillName: string): Promise<string[]> {
  const skillPrefix = `${skillName}/`;
  const paths = (await bundledSkillAssets.list('spec-driven-develop', skillPrefix))
    .filter((path) => path.endsWith('.md') && !path.endsWith('/SKILL.md'))
    .sort((a, b) => a.localeCompare(b));

  return Promise.all(paths.map(async (path) => {
    const relativePath = path.slice(skillPrefix.length);
    const body = await bundledSkillAssets.read('spec-driven-develop', path);
    return renderReferenceDoc(relativePath, body);
  }));
}

async function renderScriptDocs(skillName: string): Promise<string[]> {
  const skillPrefix = `${skillName}/`;
  const paths = (await bundledSkillAssets.list('spec-driven-develop', skillPrefix))
    .filter((path) => /\.(?:py|sh|js)$/.test(path))
    .sort((a, b) => a.localeCompare(b));

  return Promise.all(paths.map(async (path) => {
    const relativePath = path.slice(skillPrefix.length);
    const body = await bundledSkillAssets.read('spec-driven-develop', path);
    return renderScriptDoc(skillName, relativePath, body);
  }));
}

function renderOfficialDoc(title: string, body: string): string {
  return [`# Bundled Third-party Skill: ${title}`, body.trim()].join('\n\n');
}

function renderReferenceDoc(relativePath: string, body: string): string {
  return [
    `# Bundled Reference: ${relativePath}`,
    '',
    `Below is the full content of \`${relativePath}\`, inlined so the workflow can use it without filesystem access.`,
    '',
    body.trim(),
  ].join('\n');
}

function renderScriptDoc(skillName: string, relativePath: string, body: string): string {
  const fence = '```'.repeat(3);
  const trimmedBody = body.trim();
  const lineCount = trimmedBody.split('\n').length;
  return [
    `# Bundled Script: ${relativePath}`,
    '',
    `Below is the full content of \`${relativePath}\` (${lineCount} lines), inlined so the workflow can use it without filesystem access.`,
    '',
    'To execute this script in DeepSeek++, write the source shown below to a temporary file, then run it. Split the write into multiple shell_exec calls if the script is long:',
    '',
    '<shell_exec>{"command":"cat > /tmp/review-context.py <<\'DPP_EOF\'\\n[write the first chunk of the script source below]\\nDPP_EOF","timeout_ms":30000}</shell_exec>',
    '<shell_exec>{"command":"cat >> /tmp/review-context.py <<\'DPP_EOF\'\\n[append remaining chunks]\\nDPP_EOF","timeout_ms":30000}</shell_exec>',
    '<shell_exec>{"command":"python3 /tmp/review-context.py","timeout_ms":60000}</shell_exec>',
    '',
    'On Windows PowerShell, use Set-Content to write to a temp path and invoke with python instead of cat heredocs.',
    '',
    'Script source:',
    '',
    fence,
    trimmedBody,
    fence,
  ].join('\n');
}

function parseOfficialSkill(raw: string): OfficialSkillDoc {
  const frontmatter = raw.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!frontmatter) {
    throw new Error('Spec-Driven Develop skill is missing frontmatter.');
  }

  const meta = frontmatter[1];
  const name = readFrontmatterValue(meta, 'name');
  const description = readFrontmatterValue(meta, 'description');
  const version = readFrontmatterValue(meta, 'version') || '0';
  if (!name || !description) {
    throw new Error('Spec-Driven Develop skill frontmatter must include name and description.');
  }

  return {
    name,
    description,
    body: raw.slice(frontmatter[0].length).trim(),
    version,
  };
}

function readFrontmatterValue(meta: string, key: string): string {
  const match = meta.match(new RegExp(`^${key}:\\s*(.*)$`, 'm'));
  if (!match) return '';
  const inline = match[1].trim();
  if (inline === '>-') {
    return readFoldedScalar(meta, key);
  }
  if (inline.startsWith('"') && inline.endsWith('"')) {
    return inline.slice(1, -1);
  }
  return inline;
}

function readFoldedScalar(meta: string, key: string): string {
  const lines = meta.split('\n');
  const keyIndex = lines.findIndex((line) => new RegExp(`^${key}:\\s*>-?`).test(line));
  if (keyIndex < 0) return '';
  const collected: string[] = [];
  for (let i = keyIndex + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.length === 0) {
      collected.push(' ');
      continue;
    }
    if (!/^\s+/.test(line)) break;
    collected.push(line.replace(/^\s+/, ''));
  }
  return collected.join(' ').replace(/\s+/g, ' ').trim();
}

function getOfficialSkillDoc(name: string): Promise<OfficialSkillDoc> {
  const existing = officialSkillDocPromises.get(name);
  if (existing) return existing;
  const promise = bundledSkillAssets
    .read('spec-driven-develop', `${name}/SKILL.md`)
    .then(parseOfficialSkill);
  officialSkillDocPromises.set(name, promise);
  void promise.catch(() => {
    if (officialSkillDocPromises.get(name) === promise) officialSkillDocPromises.delete(name);
  });
  return promise;
}

function renderDeepSeekExecutionGuardrails(): string {
  return `你正在 DeepSeek++ 内使用 Spec-Driven Develop 第三方 skill 系列。Skill 内容已内置，但执行边界由 DeepSeek++ 覆盖。

## DeepSeek++ 执行边界

- 可用工具：${SHELL_TOOL_NAMES.join('、')}。只有在工具列表中出现 shell_exec / shell_status 时才调用；不要编造命令结果。
- Shell 工具通过 Chrome Native Messaging 与本机 host (${SHELL_MCP_NATIVE_HOST}) 通信。
- 所有 shell 操作都通过 shell_exec 执行，例如 <shell_exec>{"command":"gh --version"}</shell_exec>。
- 不要输出伪 JSON 调用；DeepSeek++ 只执行 <shell_exec>{"command":"..."}</shell_exec> 这种 XML 标签格式。
- Windows 默认 shell 是 PowerShell：列目录用 Get-ChildItem，不要把 CMD 的 dir /b 或 Unix 的 which/sed/find 直接当 PowerShell 命令。
- Windows 路径在 JSON 中使用双反斜杠或正斜杠，并在命令字符串里只包一层引号。
- 不要使用 /home/user/Documents、/mnt/data、~/Documents 这类占位路径。必须使用用户给出的真实路径，或先用 shell_exec 查询当前目录/文件位置。
- 如果 shell_exec / shell_status 不在可用工具列表中，说明用户未安装 Native Host。此时应告知用户：Spec-Driven Develop 的 GitHub/脚本功能需要 DeepSeek++ Shell MCP，仅靠 skill 文本仍可完成纯规划与分析阶段。
- 当下方 skill 正文与本节冲突时，以本节 DeepSeek++ 执行边界为准。

## 平台差异说明

本 skill 原始正文面向 Claude Code / Codex / OpenCode 等 IDE 编码代理，会引用 \`references/\` 目录和 \`scripts/\` 脚本。在 DeepSeek++ 中，这些文件已被内联到本 skill 指令正文里（见下方 "Bundled Reference" / "Bundled Script" 段落），AI 无需从文件系统读取。

- 凡正文写"读取 \`references/xxx.md\`"或"用 \`references/templates/xxx.md\` 模板"，应改为读取下方对应内联段落。
- 凡正文写"运行 \`scripts/review-context.py\`"，应使用下方内联脚本源码，按脚本段落顶部说明写入临时文件后执行。
- "启动子代理 / sub-agents" 在 DeepSeek++ 中不可用；改为在主对话中顺序执行各子任务，覆盖范围不变。
- "平台的 native task tracking tool（如 TodoWrite）" 在 DeepSeek++ 中不可用；进度跟踪依赖 docs/progress/MASTER.md。`;
}
