import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import {
  createDeepSeekConversationExportTransport,
  fetchDeepSeekSessionHistory,
  listDeepSeekSessions,
} from '../core/deepseek/conversation-export';
import { DEEPSEEK_BODY_BUDGETS } from '../core/deepseek/contracts';
import {
  buildConversationExportArtifactsCancellable,
  buildConversationExportArtifacts,
  runConversationExport,
} from '../core/export/service';
import {
  ConversationExportValidationError,
  normalizeConversationExportRequest,
} from '../core/export/schema';
import { normalizeDeepSeekHistory } from '../core/export/normalize';
import { applyConversationExportContentScope } from '../core/export/scope';
import { createConversationExportArchiveArtifact } from '../core/export/zip';
import type { ConversationExport } from '../core/export/types';

const fixtureDir = resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures/deepseek-export');

describe('conversation export request schema', () => {
  it('defaults to sanitized HTML with attachment metadata', () => {
    expect(normalizeConversationExportRequest({})).toMatchObject({
      mode: 'sanitized',
      contentScope: 'full',
      formats: ['html'],
      includeAttachmentMetadata: true,
      includeFileBodies: false,
      pageSize: 50,
    });
  });

  it('normalizes and validates content scope', () => {
    expect(normalizeConversationExportRequest({ contentScope: 'input-output' }).contentScope)
      .toBe('input-output');
    expect(normalizeConversationExportRequest({ contentScope: '' }).contentScope)
      .toBe('full');
    expect(() => normalizeConversationExportRequest({ contentScope: 'summary' }))
      .toThrow(ConversationExportValidationError);
  });

  it('rejects file body export until official download behavior is verified', () => {
    expect(() => normalizeConversationExportRequest({ includeFileBodies: true }))
      .toThrow(ConversationExportValidationError);
  });

  it('fails closed for invalid explicit modes and formats', () => {
    expect(() => normalizeConversationExportRequest({ mode: 'readable' }))
      .toThrow(ConversationExportValidationError);
    expect(() => normalizeConversationExportRequest({ formats: ['json'] }))
      .toThrow(ConversationExportValidationError);
    expect(() => normalizeConversationExportRequest({ formats: ['xml'] }))
      .toThrow(ConversationExportValidationError);
  });

  it('normalizes explicit session ids for current-conversation export', () => {
    expect(normalizeConversationExportRequest({ sessionIds: [' session-alpha ', 'session-alpha'] }))
      .toMatchObject({ sessionIds: ['session-alpha'] });
    expect(() => normalizeConversationExportRequest({ sessionIds: [''] }))
      .toThrow(ConversationExportValidationError);
  });

  it('rejects sparse arrays instead of widening export scope', () => {
    expect(() => normalizeConversationExportRequest({ formats: new Array(1) }))
      .toThrow(ConversationExportValidationError);
    expect(() => normalizeConversationExportRequest({ sessionIds: new Array(1) }))
      .toThrow(ConversationExportValidationError);
  });
});

describe('DeepSeek conversation export adapter and service', () => {
  it('reads message text from DeepSeek history fragments and nested content objects', () => {
    const session = normalizeDeepSeekHistory({
      id: 'session-fragments',
      title: 'Nested content',
      pinned: false,
      titleType: null,
      modelType: null,
      createdAt: null,
      updatedAt: null,
    }, {
      data: {
        biz_data: {
          chat_messages: [
            {
              id: 1,
              message_role: 'user',
              created_at: 1760000001,
              fragments: [{ type: 'REQUEST', content: '早' }],
            },
            {
              id: 2,
              parent_id: 1,
              message_role: 'assistant',
              created_at: 1760000002,
              fragments: [
                { type: 'THINK', content: '先礼貌回应。' },
                { type: 'RESPONSE', content: '早上好！新的一天开始了。' },
              ],
            },
          ],
        },
      },
    }, { includeRaw: false });

    expect(session.messages[0].content).toBe('早');
    expect(session.messages[0].contentFragments).toEqual([{ kind: 'text', text: '早' }]);
    expect(session.messages[1].content).toContain('早上好！');
    expect(session.messages[1].content).toContain('新的一天开始了。');
    expect(session.messages[1].contentFragments).toEqual([
      { kind: 'reasoning', text: '先礼貌回应。' },
      { kind: 'text', text: '早上好！新的一天开始了。' },
    ]);
  });

  it('renders the input-output projection into HTML with nonzero message stats', async () => {
    const exportData = await runConversationExport({
      exportId: 'real-fragment-scope',
      extensionVersion: '0.0.0-test',
      baseUrl: 'https://chat.deepseek.com',
      request: {
        mode: 'sanitized',
        contentScope: 'input-output',
        formats: ['html', 'markdown'],
        includeAttachmentMetadata: false,
        includeFileBodies: false,
        sessionIds: ['session-real'],
      },
      transport: {
        listSessions: vi.fn(async () => []),
        fetchFiles: vi.fn(async () => []),
        fetchHistory: vi.fn(async () => ({
          data: {
            biz_data: {
              chat_session: { id: 'session-real', title: 'Real fragment types' },
              chat_messages: [
                { message_id: 1, role: 'USER', fragments: [{ type: 'REQUEST', content: '初始输入' }] },
                { message_id: 2, role: 'ASSISTANT', fragments: [{ type: 'THINK', content: '思考' }] },
                {
                  message_id: 3,
                  role: 'USER',
                  fragments: [{
                    type: 'REQUEST',
                    content: '<original_task>初始输入</original_task><tool_results>[]</tool_results>',
                  }],
                },
                { message_id: 4, role: 'ASSISTANT', fragments: [{ type: 'RESPONSE', content: '最终产出' }] },
              ],
            },
          },
        })),
      },
    });

    expect(exportData.stats.messageCount).toBe(2);
    expect(exportData.sessions[0].messages.map((message) => message.content)).toEqual(['初始输入', '最终产出']);
    const artifacts = buildConversationExportArtifacts(exportData);
    const html = artifacts.find((artifact) => artifact.format === 'html');
    const markdown = artifacts.find((artifact) => artifact.format === 'markdown');

    expect(html?.content).toContain('<strong>2</strong>Messages');
    expect(html?.content).toContain('初始输入');
    expect(html?.content).toContain('最终产出');
    expect(html?.content).not.toContain('&lt;tool_results&gt;');
    expect(html?.content).not.toContain('思考');
    expect(markdown?.content).toContain('Messages: 2');
    expect(markdown?.content).not.toContain('<tool_results>');
    expect(markdown?.content).not.toContain('思考');
  });

  it('paginates sessions and exports sanitized artifacts with attachment metadata', async () => {
    const fetchImpl = createFixtureFetch();
    const transport = createDeepSeekConversationExportTransport({
      baseUrl: 'https://chat.deepseek.com',
      clientHeaders: { Authorization: 'Bearer synthetic' },
      fetchImpl,
    });

    const exportData = await runConversationExport({
      exportId: 'export-test',
      extensionVersion: '0.0.0-test',
      baseUrl: 'https://chat.deepseek.com',
      request: {
        mode: 'sanitized',
        formats: ['markdown', 'html', 'pdf', 'image_manifest'],
        includeAttachmentMetadata: true,
        includeFileBodies: false,
        pageSize: 1,
      },
      transport,
      now: createClock([
        '2026-06-06T00:00:00.000Z',
        '2026-06-06T00:00:01.000Z',
      ]),
    });

    expect(exportData.sessions).toHaveLength(1);
    expect(exportData.failures).toHaveLength(1);
    expect(exportData.failures[0].sessionId).toBe('session-beta');
    expect(exportData.attachments[0]).toMatchObject({
      id: 'file-1',
      fileName: 'memo.txt',
      sizeBytes: 2048,
      status: 'metadata_available',
      sourceMessageIds: ['1001'],
    });
    expect(exportData.attachments[0].signedPath).toBeUndefined();
    expect(exportData.sessions[0].raw).toBeUndefined();
    expect(exportData.sessions[0].messages[0].content).toBe('Please summarize the attached memo.');
    expect(exportData.sessions[0].messages[1].content).not.toContain('memory_save');
    expect(exportData.sessions[0].messages[1].id).toBe('session-alpha:message:1');
    expect(exportData.sessions[0].failures[0].code).toBe('message_id_missing');

    const artifacts = buildConversationExportArtifacts(exportData);
    expect(artifacts.map((artifact) => artifact.format)).toEqual(['markdown', 'html', 'pdf', 'image_manifest']);
    expect(artifacts.find((artifact) => artifact.format === 'markdown')?.content).toContain('Synthetic Alpha');
    expect(artifacts.find((artifact) => artifact.format === 'html')?.content).toContain('<!doctype html>');
    expect(artifacts.find((artifact) => artifact.format === 'pdf')).toMatchObject({
      filename: 'deepseek-conversations-sanitized-2026-06-06T00-00-01.pdf',
      mimeType: 'application/pdf',
    });
    expect(artifacts.find((artifact) => artifact.format === 'pdf')?.content.startsWith('%PDF-1.4')).toBe(true);
    expect(artifacts.find((artifact) => artifact.format === 'image_manifest')).toMatchObject({
      filename: 'deepseek-image-manifest-2026-06-06.html',
      mimeType: 'text/html;charset=utf-8',
    });
    expect(artifacts.find((artifact) => artifact.format === 'image_manifest')?.content).toContain('0 image attachments');
  });

  it('derives the official pagination cursor from the last session', async () => {
    const fetchImpl = createFixtureFetch();
    const sessions = await listDeepSeekSessions({
      baseUrl: 'https://chat.deepseek.com',
      clientHeaders: { Authorization: 'Bearer synthetic' },
      fetchImpl,
      pageSize: 1,
      includeRaw: true,
    });

    expect(sessions.map((session) => session.id)).toEqual(['session-alpha', 'session-beta']);
    expect(fetchImpl.calls.some((url) => url.includes('lte_cursor.updated_at=1760000000'))).toBe(true);
    expect(fetchImpl.calls.some((url) => url.includes('lte_cursor.pinned=false'))).toBe(true);
  });

  it('keeps large per-session history compatible with the export-specific body budget', async () => {
    const largeText = 'x'.repeat(DEEPSEEK_BODY_BUDGETS.activeJson + 1);
    const history = await fetchDeepSeekSessionHistory({
      baseUrl: 'https://chat.deepseek.com',
      clientHeaders: { Authorization: 'Bearer synthetic' },
      fetchImpl: vi.fn(async () => jsonResponse({ data: { biz_data: { largeText } } })),
      session: {
        id: 'large-session',
        title: 'Large session',
        pinned: false,
        titleType: null,
        modelType: null,
        createdAt: null,
        updatedAt: null,
      },
      includeRaw: true,
    });

    expect((history as { data: { biz_data: { largeText: string } } }).data.biz_data.largeText)
      .toHaveLength(largeText.length);
  });

  it('keeps official raw payloads only in raw mode', async () => {
    const transport = createDeepSeekConversationExportTransport({
      baseUrl: 'https://chat.deepseek.com',
      clientHeaders: { Authorization: 'Bearer synthetic' },
      fetchImpl: createFixtureFetch(),
    });

    const exportData = await runConversationExport({
      exportId: 'export-raw-test',
      extensionVersion: '0.0.0-test',
      baseUrl: 'https://chat.deepseek.com',
      request: {
        mode: 'raw',
        formats: ['html'],
        includeAttachmentMetadata: true,
        includeFileBodies: false,
        pageSize: 1,
        sessionLimit: 1,
      },
      transport,
    });

    expect(exportData.sessions[0].raw).toBeTruthy();
    expect(exportData.sessions[0].messages[0].content).toContain('deepseek-pp-visible-user-prompt');
    expect(exportData.sessions[0].messages[1].content).toContain('memory_save');
    expect(exportData.attachments[0].signedPath).toBe('https://example.invalid/signed/memo.txt');
    expect(exportData.attachments[0].raw).toBeTruthy();
  });

  it('exports explicit sessions without reading the session list', async () => {
    let listedSessions = false;
    const exportData = await runConversationExport({
      exportId: 'export-current-session-test',
      extensionVersion: '0.0.0-test',
      baseUrl: 'https://chat.deepseek.com',
      request: {
        mode: 'sanitized',
        formats: ['markdown'],
        includeAttachmentMetadata: false,
        includeFileBodies: false,
        sessionIds: ['session-alpha'],
      },
      transport: {
        async listSessions() {
          listedSessions = true;
          return [];
        },
        async fetchHistory({ session }) {
          expect(session.id).toBe('session-alpha');
          return readFixture('history-alpha.json');
        },
        async fetchFiles() {
          throw new Error('fetchFiles should not run when attachment metadata is disabled.');
        },
      },
    });

    expect(listedSessions).toBe(false);
    expect(exportData.sessions).toHaveLength(1);
    expect(exportData.sessions[0].id).toBe('session-alpha');
    expect(exportData.sessions[0].title).toBe('Synthetic Alpha');
  });

  it('does not return artifacts after formatting is cancelled', async () => {
    const transport = createDeepSeekConversationExportTransport({
      baseUrl: 'https://chat.deepseek.com',
      clientHeaders: { Authorization: 'Bearer synthetic' },
      fetchImpl: createFixtureFetch(),
    });
    const exportData = await runConversationExport({
      exportId: 'export-cancel-test',
      extensionVersion: '0.0.0-test',
      baseUrl: 'https://chat.deepseek.com',
      request: {
        mode: 'sanitized',
        formats: ['html'],
        includeAttachmentMetadata: false,
        includeFileBodies: false,
        pageSize: 1,
        sessionLimit: 1,
      },
      transport,
    });

    const controller = new AbortController();
    controller.abort();
    await expect(buildConversationExportArtifactsCancellable(exportData, controller.signal))
      .rejects.toThrow('Conversation export was cancelled.');
  });

  it('rethrows history cancellation instead of converting it to a partial success', async () => {
    const progress: string[] = [];
    await expect(runConversationExport({
      exportId: 'export-history-cancel',
      extensionVersion: '0.0.0-test',
      baseUrl: 'https://chat.deepseek.com',
      request: {
        mode: 'sanitized',
        formats: ['html'],
        includeAttachmentMetadata: false,
        includeFileBodies: false,
      },
      transport: {
        async listSessions() {
          return [sessionSummary('session-cancel')];
        },
        async fetchHistory() {
          throw new DOMException('cancelled', 'AbortError');
        },
        async fetchFiles() {
          return [];
        },
      },
      onProgress(update) {
        progress.push(update.phase);
      },
    })).rejects.toMatchObject({ name: 'AbortError' });
    expect(progress).not.toContain('completed');
  });

  it('rethrows attachment cancellation before completed progress', async () => {
    const progress: string[] = [];
    await expect(runConversationExport({
      exportId: 'export-attachment-cancel',
      extensionVersion: '0.0.0-test',
      baseUrl: 'https://chat.deepseek.com',
      request: {
        mode: 'sanitized',
        formats: ['html'],
        includeAttachmentMetadata: true,
        includeFileBodies: false,
      },
      transport: {
        async listSessions() {
          return [sessionSummary('session-alpha')];
        },
        async fetchHistory() {
          return readFixture('history-alpha.json');
        },
        async fetchFiles() {
          throw new DOMException('cancelled', 'AbortError');
        },
      },
      onProgress(update) {
        progress.push(update.phase);
      },
    })).rejects.toMatchObject({ name: 'AbortError' });
    expect(progress).not.toContain('completed');
  });
});

function sessionSummary(id: string) {
  return {
    id,
    title: 'Synthetic session',
    pinned: false,
    titleType: null,
    modelType: null,
    createdAt: null,
    updatedAt: null,
  };
}

function createFixtureFetch() {
  const calls: string[] = [];
  const fetchImpl = (async (url: RequestInfo | URL) => {
    const href = String(url);
    calls.push(href);
    const parsed = new URL(href);

    if (parsed.pathname === '/api/v0/chat_session/fetch_page') {
      return jsonResponse(parsed.searchParams.has('lte_cursor.updated_at')
        ? readFixture('session-page-2.json')
        : readFixture('session-page-1.json'));
    }

    if (parsed.pathname === '/api/v0/chat/history_messages') {
      const sessionId = parsed.searchParams.get('chat_session_id');
      if (sessionId === 'session-alpha') return jsonResponse(readFixture('history-alpha.json'));
      return jsonResponse({ data: { biz_code: 50001, biz_data: {} } }, 500);
    }

    if (parsed.pathname === '/api/v0/file/fetch_files') {
      return jsonResponse(readFixture('file-metadata.json'));
    }

    return jsonResponse({ data: { biz_code: 404, biz_data: {} } }, 404);
  }) as typeof fetch & { calls: string[] };
  fetchImpl.calls = calls;
  return fetchImpl;
}

function readFixture(name: string) {
  return JSON.parse(readFileSync(resolve(fixtureDir, name), 'utf8'));
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function createClock(values: string[]) {
  let index = 0;
  return () => new Date(values[Math.min(index++, values.length - 1)]);
}


describe('conversation export content scope projection', () => {
  function buildExportData() {
    const base: ConversationExport = {
      schemaVersion: 'deepseek-pp.conversation-export.v1',
      exportId: 'scope-test',
      createdAt: '2026-08-04T00:00:00.000Z',
      source: { provider: 'deepseek-official-web', baseUrl: 'https://chat.deepseek.com', endpointVerification: 'static-bundle-and-browser-session', fileBodies: 'unsupported-unverified' },
      generatedBy: { name: 'DeepSeek++', version: '0.0.0-test' },
      request: { mode: 'sanitized', contentScope: 'full', formats: ['markdown'], includeAttachmentMetadata: true, includeFileBodies: false, pageSize: 50, sessionIds: ['s1'] },
      stats: { sessionCount: 1, messageCount: 6, attachmentCount: 3, failedSessionCount: 0, startedAt: '2026-08-04T00:00:00.000Z', completedAt: '2026-08-04T00:00:00.000Z' },
      sessions: [{
        id: 's1',
        title: '测试会话',
        pinned: false,
        titleType: null,
        modelType: null,
        createdAt: null,
        updatedAt: null,
        messages: [
          { id: 'm1', parentId: null, role: 'user', content: '输入一', contentFragments: [{ kind: 'text', text: '输入一' }], createdAt: null, updatedAt: null, modelType: null, searchEnabled: null, thinkingEnabled: null, attachmentRefs: [{ id: 'file-input', role: 'referenced' }] },
          { id: 'm2', parentId: 'm1', role: 'assistant', content: '思考中工具调用', contentFragments: [{ kind: 'reasoning', text: '思考' }, { kind: 'tool', text: '<shell_exec>…' }], createdAt: null, updatedAt: null, modelType: null, searchEnabled: null, thinkingEnabled: null, attachmentRefs: [{ id: 'file-internal', role: 'generated' }] },
          { id: 'm3', parentId: 'm2', role: 'user', content: '内部续跑输入', contentFragments: [{ kind: 'text', text: '内部续跑输入' }], createdAt: null, updatedAt: null, modelType: null, searchEnabled: null, thinkingEnabled: null, attachmentRefs: [] },
          { id: 'm4', parentId: 'm3', role: 'tool', content: '工具结果', contentFragments: [{ kind: 'tool', text: '工具结果' }], createdAt: null, updatedAt: null, modelType: null, searchEnabled: null, thinkingEnabled: null, attachmentRefs: [] },
          { id: 'm5', parentId: 'm4', role: 'assistant', content: '最终产出A（含思考）', contentFragments: [{ kind: 'reasoning', text: '不该出现' }, { kind: 'text', text: '最终产出A' }], createdAt: null, updatedAt: null, modelType: null, searchEnabled: null, thinkingEnabled: null, attachmentRefs: [] },
          { id: 'm6', parentId: 'm5', role: 'assistant', content: '最终产出B', contentFragments: [{ kind: 'text', text: '最终产出B' }], createdAt: null, updatedAt: null, modelType: null, searchEnabled: null, thinkingEnabled: null, attachmentRefs: [{ id: 'file-output', role: 'generated' }] },
        ],
        failures: [],
      }],
      attachments: [
        { id: 'file-input', fileName: 'input.txt', mimeType: 'text/plain', sizeBytes: 1, status: 'metadata_available', sourceMessageIds: ['m1'] },
        { id: 'file-internal', fileName: 'internal.txt', mimeType: 'text/plain', sizeBytes: 2, status: 'metadata_available', sourceMessageIds: ['m2'] },
        { id: 'file-output', fileName: 'output.txt', mimeType: 'text/plain', sizeBytes: 3, status: 'metadata_available', sourceMessageIds: ['m6', 'missing-message'] },
      ],
      failures: [],
    };
    return base;
  }

  it('keeps everything for the full scope', async () => {
    const artifacts = await buildConversationExportArtifactsCancellable(buildExportData());
    const markdown = artifacts.find((artifact) => artifact.format === 'markdown');
    expect(markdown?.content).toContain('输入一');
    expect(markdown?.content).toContain('工具结果');
    expect(markdown?.content).toContain('最终产出B');
  });

  it('projects to the initial input plus final output and scopes attachments', async () => {
    const base = buildExportData();
    const source = {
      ...base,
      request: { ...base.request, contentScope: 'input-output' as const },
    };
    const scoped = applyConversationExportContentScope(source, 'input-output');
    const artifacts = await buildConversationExportArtifactsCancellable(source);
    const markdown = artifacts.find((artifact) => artifact.format === 'markdown');

    expect(scoped.sessions[0].messages.map((message) => message.id)).toEqual(['m1', 'm6']);
    expect(scoped.attachments.map((attachment) => attachment.id)).toEqual(['file-input', 'file-output']);
    expect(scoped.attachments[1].sourceMessageIds).toEqual(['m6']);
    expect(scoped.stats).toMatchObject({ messageCount: 2, attachmentCount: 2 });
    expect(markdown?.content).toContain('输入一');
    expect(markdown?.content).toContain('最终产出B');
    expect(markdown?.content).not.toContain('内部续跑输入');
    expect(markdown?.content).not.toContain('工具结果');
    expect(markdown?.content).not.toContain('不该出现');
    expect(markdown?.content).not.toContain('最终产出A');
    expect(markdown?.content).not.toContain('<shell_exec>');
    expect(markdown?.content).not.toContain('internal.txt');
    expect(markdown?.content).toContain('Messages: 2');
    expect(markdown?.content).toContain('Attachments: 2');
  });
});

describe('conversation export multi-format archive', () => {
  it('packs selected formats into one UTF-8 ZIP download', () => {
    const archive = createConversationExportArchiveArtifact([
      {
        format: 'html',
        filename: 'deepseek-conversations-sanitized-2026-08-06T10-00-00.html',
        mimeType: 'text/html;charset=utf-8',
        content: '<h1>你好</h1>',
      },
      {
        format: 'markdown',
        filename: 'deepseek-conversations-sanitized-2026-08-06T10-00-00.md',
        mimeType: 'text/markdown;charset=utf-8',
        content: '# 你好',
      },
    ], new Date('2026-08-06T10:00:00.000Z'));

    expect(archive.filename).toBe('deepseek-conversations-sanitized-2026-08-06T10-00-00.zip');
    expect(archive.mimeType).toBe('application/zip');
    expect(Array.from(archive.content.slice(0, 4))).toEqual([0x50, 0x4b, 0x03, 0x04]);
    const decoded = new TextDecoder().decode(archive.content);
    expect(decoded).toContain('deepseek-conversations-sanitized-2026-08-06T10-00-00.html');
    expect(decoded).toContain('deepseek-conversations-sanitized-2026-08-06T10-00-00.md');
    expect(decoded).toContain('<h1>你好</h1>');
    expect(decoded).toContain('# 你好');
  });
});
