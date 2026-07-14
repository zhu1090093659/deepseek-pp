import Dexie from 'dexie';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ARTIFACT_PERSISTENCE_CONTRACT } from '../core/artifact/schema';
import type { ToolCall } from '../core/tool/types';

let storage: Record<string, unknown>;
let artifact: typeof import('../core/artifact');
let artifactStore: typeof import('../core/artifact/store');
let indexedDbFactory: IDBFactory;
const originalIndexedDb = Dexie.dependencies.indexedDB;
const originalIdbKeyRange = Dexie.dependencies.IDBKeyRange;

beforeEach(async () => {
  vi.resetModules();
  storage = {};
  indexedDbFactory = new IDBFactory();
  Dexie.dependencies.indexedDB = indexedDbFactory;
  Dexie.dependencies.IDBKeyRange = IDBKeyRange;
  vi.stubGlobal('indexedDB', indexedDbFactory);
  vi.stubGlobal('IDBKeyRange', IDBKeyRange);
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: vi.fn(async (key: string) => (
          Object.prototype.hasOwnProperty.call(storage, key)
            ? { [key]: storage[key] }
            : {}
        )),
        set: vi.fn(async (values: Record<string, unknown>) => {
          storage = { ...storage, ...values };
        }),
        remove: vi.fn(async (key: string) => {
          delete storage[key];
        }),
      },
    },
  });
  artifact = await import('../core/artifact');
  artifactStore = await import('../core/artifact/store');
});

afterEach(async () => {
  artifactStore.db.close();
  await Dexie.delete(ARTIFACT_PERSISTENCE_CONTRACT.databaseName);
  Dexie.dependencies.indexedDB = originalIndexedDb;
  Dexie.dependencies.IDBKeyRange = originalIdbKeyRange;
  vi.unstubAllGlobals();
});

describe('artifact tool provider', () => {
  it('exposes single-file and bundle descriptors through stable tool names', () => {
    expect(artifact.createArtifactToolDescriptors().map((tool) => tool.name)).toEqual([
      'artifact_create',
      'artifact_bundle_create',
    ]);
  });

  it('creates a sanitized downloadable single-file artifact', async () => {
    const result = await artifact.executeArtifactToolCall(toolCall('artifact_create', {
      filename: '../reports/summary.md',
      content: '# Summary',
      mimeType: 'text/markdown',
    }), 'en');

    expect(result.ok).toBe(true);
    expect(result.summary).toBe('File ready');
    const output = result.output as { artifactId: string; filename: string; artifactKind: string; view?: { previewMode: string; language: string } };
    expect(output.filename).toBe('reports/summary.md');
    expect(output.artifactKind).toBe('file');
    expect(output.view).toEqual({ previewMode: 'none', language: 'text' });

    const record = await artifact.getArtifact(output.artifactId);
    expect(record?.content).toBe('# Summary');
    expect(record?.mimeType).toBe('text/markdown');
  });

  it('marks HTML and Python artifacts as previewable or runnable files', async () => {
    const html = await artifact.executeArtifactToolCall(toolCall('artifact_create', {
      filename: 'demo.html',
      content: '<!doctype html><h1>Hello</h1>',
    }), 'en');
    const python = await artifact.executeArtifactToolCall(toolCall('artifact_create', {
      filename: 'calc.py',
      content: 'print(21 * 2)',
    }), 'en');

    expect(html.output).toMatchObject({
      filename: 'demo.html',
      mimeType: 'text/html',
      view: { previewMode: 'html', language: 'html' },
    });
    expect(python.output).toMatchObject({
      filename: 'calc.py',
      mimeType: 'text/x-python',
      view: { previewMode: 'code', language: 'python' },
    });
  });

  it('reconstructs historical HTML artifact tool calls as transient previewable outputs', () => {
    const result = artifact.createRestoredArtifactToolResult(toolCall('artifact_create', {
      filename: 'demo.html',
      content: '<!doctype html><h1>Restored</h1>',
    }), 'en');

    expect(result?.ok).toBe(true);
    expect(result?.summary).toBe('File ready');
    expect(result?.detail).toBe('demo.html (32 bytes)');
    expect(result?.output).toMatchObject({
      kind: 'artifact',
      artifactKind: 'file',
      filename: 'demo.html',
      mimeType: 'text/html',
      view: { previewMode: 'html', language: 'html' },
      transientContent: '<!doctype html><h1>Restored</h1>',
    });
  });

  it('creates a stored zip bundle for multi-file project output', async () => {
    const result = await artifact.executeArtifactToolCall(toolCall('artifact_bundle_create', {
      filename: 'demo',
      files: [
        { path: 'src/index.ts', content: 'export const ok = true;' },
        { path: '../README.md', content: '# Demo' },
      ],
    }));

    expect(result.ok).toBe(true);
    const output = result.output as { artifactId: string; filename: string; fileCount: number };
    expect(output.filename).toBe('demo.zip');
    expect(output.fileCount).toBe(2);

    const record = await artifact.getArtifact(output.artifactId);
    expect(record?.kind).toBe('bundle');
    expect(record?.content.slice(0, 4)).toBe('UEsD');
    expect(record?.files?.map((file) => file.path)).toEqual(['src/index.ts', 'README.md']);
  });

  it('fails visibly on malformed bundle payloads', async () => {
    const result = await artifact.executeArtifactToolCall(toolCall('artifact_bundle_create', {
      filename: 'empty.zip',
      files: [],
    }));

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('artifact_failed');
    expect(result.detail).toContain('files must be a non-empty array');
  });
});

function toolCall(name: string, payload: Record<string, unknown>): ToolCall {
  return {
    name,
    payload,
    raw: `<${name}>`,
  };
}
