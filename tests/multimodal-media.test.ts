import { describe, expect, it } from 'vitest';
import {
  MULTIMODAL_MEDIA_IMAGE_MAX_BYTES,
  MULTIMODAL_MEDIA_PREFLIGHT_PROMPT_END,
  MULTIMODAL_MEDIA_PREFLIGHT_PROMPT_START,
  MULTIMODAL_MEDIA_VIDEO_INLINE_MAX_BYTES,
  assertSupportedMultimodalMedia,
  buildMultimodalAnalysisPrompt,
  hasDeepSeekChatSessionRoute,
  selectMultimodalMediaRouteKeyForRequest,
  normalizeMultimodalMediaAnalyzeRequest,
  shouldPreserveInitialMultimodalMediaRoute,
  type MultimodalMediaAnalysisItem,
} from '../core/multimodal/media';

describe('multimodal media request helpers', () => {
  it('rejects oversized image and inline video inputs before provider calls', () => {
    expect(() => assertSupportedMultimodalMedia({
      kind: 'image',
      name: 'large.png',
      mimeType: 'image/png',
      sizeBytes: MULTIMODAL_MEDIA_IMAGE_MAX_BYTES + 1,
    })).toThrow(/image limit/);

    expect(() => assertSupportedMultimodalMedia({
      kind: 'video',
      name: 'large.mp4',
      mimeType: 'video/mp4',
      sizeBytes: MULTIMODAL_MEDIA_VIDEO_INLINE_MAX_BYTES + 1,
    })).toThrow(/inline video limit/);
  });

  it('rejects sparse media arrays at the receiving boundary', () => {
    expect(() => normalizeMultimodalMediaAnalyzeRequest({
      prompt: 'inspect',
      media: new Array(1),
    })).toThrow('media[0] must be provided');
  });

  it('injects MCP media analysis results before the user prompt', () => {
    const prompt = buildMultimodalAnalysisPrompt('Compare the uploaded media.', [
      createAnalysis('images:a,b', 'image', ['first.png', 'second.png'], 'The two screenshots show different states.'),
      createAnalysis('video-1', 'video', ['demo.mp4'], 'The video shows a loading sequence.'),
    ]);

    expect(prompt).toContain(MULTIMODAL_MEDIA_PREFLIGHT_PROMPT_START);
    expect(prompt).toContain(MULTIMODAL_MEDIA_PREFLIGHT_PROMPT_END);
    expect(prompt).toContain('- first.png (image/png, 1024 bytes)');
    expect(prompt).toContain('- second.png (image/png, 1024 bytes)');
    expect(prompt).toContain('The two screenshots show different states.');
    expect(prompt).toContain('- demo.mp4 (video/mp4, 2048 bytes)');
    expect(prompt.endsWith('Compare the uploaded media.')).toBe(true);
  });

  it('preserves first-turn media across the new-chat to session route change', () => {
    expect(hasDeepSeekChatSessionRoute('/a/chat/s/session-1')).toBe(true);
    expect(hasDeepSeekChatSessionRoute('/a/chat/new')).toBe(false);
    expect(shouldPreserveInitialMultimodalMediaRoute('/a/chat/new', '/a/chat/s/session-1')).toBe(true);
    expect(shouldPreserveInitialMultimodalMediaRoute('/a/chat/s/old', '/a/chat/s/new')).toBe(false);
  });

  it('selects new-chat media for the first request after DeepSeek changes routes', () => {
    const pending = [
      { id: 'old', routeKey: '/a/chat/s/old', createdAt: 1 },
      { id: 'image', routeKey: '/a/chat/new', createdAt: 2 },
    ];

    expect(selectMultimodalMediaRouteKeyForRequest(
      pending,
      '/a/chat/s/new-session',
      { parentMessageId: null },
    )).toBe('/a/chat/new');

    expect(selectMultimodalMediaRouteKeyForRequest(
      pending,
      '/a/chat/s/new-session',
      { parentMessageId: 42 },
    )).toBeNull();
  });

  it('prefers media already attached to the current request route', () => {
    const pending = [
      { id: 'new-chat', routeKey: '/a/chat/new', createdAt: 2 },
      { id: 'current', routeKey: '/a/chat/s/current', createdAt: 1 },
    ];

    expect(selectMultimodalMediaRouteKeyForRequest(
      pending,
      '/a/chat/s/current',
      { parentMessageId: null },
    )).toBe('/a/chat/s/current');
  });
});

function createAnalysis(
  id: string,
  kind: 'image' | 'video',
  names: string[],
  text: string,
): MultimodalMediaAnalysisItem {
  return {
    id,
    kind,
    media: names.map((name, index) => ({
      id: `${id}:${index}`,
      kind,
      name,
      mimeType: kind === 'image' ? 'image/png' : 'video/mp4',
      sizeBytes: kind === 'image' ? 1024 : 2048,
    })),
    result: {
      ok: true,
      summary: 'ok',
      output: { text },
    },
  };
}
