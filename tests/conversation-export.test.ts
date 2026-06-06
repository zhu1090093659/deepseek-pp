import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  createDeepSeekConversationExportTransport,
  listDeepSeekSessions,
} from '../core/deepseek/conversation-export';
import {
  buildConversationExportArtifactsCancellable,
  buildConversationExportArtifacts,
  runConversationExport,
} from '../core/export/service';
import {
  ConversationExportValidationError,
  normalizeConversationExportRequest,
} from '../core/export/schema';

const fixtureDir = resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures/deepseek-export');

describe('conversation export request schema', () => {
  it('defaults to sanitized JSON and Markdown with attachment metadata', () => {
    expect(normalizeConversationExportRequest({})).toMatchObject({
      mode: 'sanitized',
      formats: ['json', 'markdown'],
      includeAttachmentMetadata: true,
      includeFileBodies: false,
      pageSize: 50,
    });
  });

  it('rejects file body export until official download behavior is verified', () => {
    expect(() => normalizeConversationExportRequest({ includeFileBodies: true }))
      .toThrow(ConversationExportValidationError);
  });

  it('fails closed for invalid explicit modes and formats', () => {
    expect(() => normalizeConversationExportRequest({ mode: 'readable' }))
      .toThrow(ConversationExportValidationError);
    expect(() => normalizeConversationExportRequest({ formats: ['json', 'pdf'] }))
      .toThrow(ConversationExportValidationError);
  });
});

describe('DeepSeek conversation export adapter and service', () => {
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
        formats: ['json', 'markdown', 'html'],
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
    expect(artifacts.map((artifact) => artifact.format)).toEqual(['json', 'markdown', 'html']);
    expect(artifacts.find((artifact) => artifact.format === 'markdown')?.content).toContain('Synthetic Alpha');
    expect(artifacts.find((artifact) => artifact.format === 'html')?.content).toContain('<!doctype html>');
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
        formats: ['json'],
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
        formats: ['json'],
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
});

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
