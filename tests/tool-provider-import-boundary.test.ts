import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const CORE_ROOT = resolve(ROOT, 'core');
const TARGET_PREFIXES = ['core/tool/', 'core/mcp/'];
const TARGET_FILES = new Set(['core/constants.ts', 'core/types.ts']);

describe('tool provider import boundary', () => {
  it('keeps registry and runtime independent from concrete providers', () => {
    expect(relativeImports('core/tool/provider-registry.ts').sort()).toEqual([
      '../i18n',
      './types',
    ]);
    expect(relativeImports('core/tool/runtime.ts').sort()).toEqual([
      '../i18n',
      '../messaging/tool-record-codec',
      './authorization',
      './externalized-payload',
      './history',
      './provider-registry',
      './types',
    ]);
  });

  it('has no static SCC in the migrated tool/MCP contract slice', () => {
    const files = listSourceFiles(CORE_ROOT);
    const graph = new Map(files.map((file) => [file, resolveImports(file, files)]));
    const cycles = stronglyConnectedComponents(graph)
      .filter((component) => component.length > 1 || graph.get(component[0])?.has(component[0]))
      .filter((component) => component.some((file) => {
        const relative = toRelative(file);
        return TARGET_FILES.has(relative) || TARGET_PREFIXES.some((prefix) => relative.startsWith(prefix));
      }))
      .map((component) => component.map(toRelative).sort());

    expect(cycles).toEqual([]);
  });

  it('keeps the only production registration array in Background composition', () => {
    const productionFiles = listSourceFiles(ROOT)
      .filter((file) => !toRelative(file).startsWith('tests/'));
    const owners = productionFiles
      .filter((file) => registryConstructionShape(file).count > 0)
      .map(toRelative);

    expect(owners).toEqual(['entrypoints/background/tool-provider-composition.ts']);
    expect(registryConstructionShape(resolve(
      ROOT,
      'entrypoints/background/tool-provider-composition.ts',
    ))).toEqual({ count: 1, inlineProviderArrays: 1 });
    expect(relativeImports('entrypoints/background.ts')).toContain('./background/tool-provider-composition');
  });

  it('keeps content descriptor synchronization strict and fail-closed', () => {
    const source = readFileSync(resolve(ROOT, 'entrypoints/content.ts'), 'utf8');

    expect(source).toContain("import { isToolDescriptorRecord } from '../core/messaging/tool-record-codec';");
    expect(source).toContain("sendRuntimeMessageStrict<ToolDescriptor[]>({ type: 'GET_TOOL_DESCRIPTORS' })");
    expect(source).toContain('tool descriptor sync failed; tool execution disabled');
    expect(source).toContain('let currentToolDescriptors: ToolDescriptor[] = [];');
    expect(source).toContain('const toolDescriptorSyncGate = createLatestSyncGate();');
    expect(source).toMatch(/const runtimeStateSync = Promise\.all\([\s\S]*?currentToolDescriptors,[\s\S]*?const descriptorSync = descriptorResultPromise\.then/);
    expect(source).toContain('await Promise.all([runtimeStateSync, descriptorSync]);');
    expect(source).toContain('syncLease.commit(() => syncToMainWorld(');
    expect(source).toContain('syncCurrentRuntimeStateToMainWorld();');
    expect(source).not.toContain('normalizeToolDescriptors');

    const hookSource = readFileSync(resolve(ROOT, 'core/interceptor/fetch-hook.ts'), 'utf8');
    const mainWorldSource = readFileSync(resolve(ROOT, 'entrypoints/main-world.content.ts'), 'utf8');
    expect(hookSource).toContain('toolDescriptors: [],');
    expect(hookSource).not.toContain('DEFAULT_TOOL_DESCRIPTORS');
    expect(mainWorldSource).toContain('updateHookState({ toolDescriptors: [] });');
  });
});

function registryConstructionShape(file: string): { count: number; inlineProviderArrays: number } {
  const source = readFileSync(file, 'utf8');
  const kind = extname(file) === '.tsx' ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, kind);
  const localNames = new Set<string>();
  sourceFile.forEachChild((node) => {
    if (!ts.isImportDeclaration(node) || !node.importClause?.namedBindings) return;
    if (!ts.isNamedImports(node.importClause.namedBindings)) return;
    for (const element of node.importClause.namedBindings.elements) {
      if ((element.propertyName ?? element.name).text === 'ToolProviderRegistry') {
        localNames.add(element.name.text);
      }
    }
  });
  let count = 0;
  let inlineProviderArrays = 0;
  const visit = (node: ts.Node) => {
    if (
      ts.isNewExpression(node)
      && ts.isIdentifier(node.expression)
      && localNames.has(node.expression.text)
    ) {
      count += 1;
      if (node.arguments?.length === 1 && ts.isArrayLiteralExpression(node.arguments[0])) {
        inlineProviderArrays += 1;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return { count, inlineProviderArrays };
}

function relativeImports(path: string): string[] {
  return parseModuleSpecifiers(resolve(ROOT, path)).filter((specifier) => specifier.startsWith('.'));
}

function resolveImports(file: string, files: readonly string[]): Set<string> {
  const fileSet = new Set(files);
  const result = new Set<string>();
  for (const specifier of parseModuleSpecifiers(file)) {
    if (!specifier.startsWith('.')) continue;
    const candidate = resolve(dirname(file), specifier);
    const resolved = [
      candidate,
      `${candidate}.ts`,
      `${candidate}.tsx`,
      join(candidate, 'index.ts'),
      join(candidate, 'index.tsx'),
    ].find((item) => fileSet.has(normalize(item)));
    if (resolved) result.add(normalize(resolved));
  }
  return result;
}

function parseModuleSpecifiers(file: string): string[] {
  const source = readFileSync(file, 'utf8');
  const kind = extname(file) === '.tsx' ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, kind);
  const specifiers: string[] = [];
  sourceFile.forEachChild((node) => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
      specifiers.push((node.moduleSpecifier as ts.StringLiteral).text);
    }
  });
  return specifiers;
}

function listSourceFiles(root: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(root)) {
    if (entry === 'node_modules' || entry === '.git' || entry === '.output' || entry === 'dist') continue;
    const path = join(root, entry);
    if (statSync(path).isDirectory()) {
      files.push(...listSourceFiles(path));
    } else if (path.endsWith('.ts') || path.endsWith('.tsx')) {
      files.push(normalize(path));
    }
  }
  return files.sort();
}

function stronglyConnectedComponents(graph: ReadonlyMap<string, ReadonlySet<string>>): string[][] {
  let nextIndex = 0;
  const indices = new Map<string, number>();
  const lowLinks = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const components: string[][] = [];

  const visit = (node: string) => {
    indices.set(node, nextIndex);
    lowLinks.set(node, nextIndex);
    nextIndex += 1;
    stack.push(node);
    onStack.add(node);

    for (const dependency of graph.get(node) ?? []) {
      if (!indices.has(dependency)) {
        visit(dependency);
        lowLinks.set(node, Math.min(lowLinks.get(node)!, lowLinks.get(dependency)!));
      } else if (onStack.has(dependency)) {
        lowLinks.set(node, Math.min(lowLinks.get(node)!, indices.get(dependency)!));
      }
    }

    if (lowLinks.get(node) !== indices.get(node)) return;
    const component: string[] = [];
    while (stack.length > 0) {
      const member = stack.pop()!;
      onStack.delete(member);
      component.push(member);
      if (member === node) break;
    }
    components.push(component);
  };

  for (const node of graph.keys()) {
    if (!indices.has(node)) visit(node);
  }
  return components;
}

function toRelative(path: string): string {
  return normalize(path).slice(`${normalize(ROOT)}/`.length);
}
