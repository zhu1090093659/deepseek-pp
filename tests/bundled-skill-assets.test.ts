import { describe, expect, it, vi } from 'vitest';
import { createBundledSkillAssetStore } from '../core/skill/bundled-assets';

const manifest = JSON.stringify({
  schemaVersion: 1,
  groups: {
    officecli: ['skills/officecli/SKILL.md'],
    'spec-driven-develop': ['deep-discuss/SKILL.md'],
  },
});

function response(body: string, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => body,
  };
}

describe('bundled Skill asset boundary', () => {
  it('validates the manifest and caches each requested asset exactly once', async () => {
    const fetch = vi.fn(async (url: string) => {
      if (url.endsWith('/manifest.json')) return response(manifest);
      if (url.endsWith('/deep-discuss/SKILL.md')) return response('Deep Discuss');
      return response('', 404);
    });
    const store = createBundledSkillAssetStore({
      getUrl: (path) => `chrome-extension://test/${path}`,
      fetch,
    });

    await expect(Promise.all([
      store.read('spec-driven-develop', 'deep-discuss/SKILL.md'),
      store.read('spec-driven-develop', 'deep-discuss/SKILL.md'),
    ])).resolves.toEqual(['Deep Discuss', 'Deep Discuss']);
    expect(fetch).toHaveBeenCalledTimes(2);
    await store.read('spec-driven-develop', 'deep-discuss/SKILL.md');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('rejects unregistered and traversal paths before resource access', async () => {
    const fetch = vi.fn(async () => response(manifest));
    const store = createBundledSkillAssetStore({
      getUrl: (path) => `chrome-extension://test/${path}`,
      fetch,
    });

    await expect(store.read('officecli', '../secret'))
      .rejects.toThrow('Invalid bundled Skill asset path');
    await expect(store.read('officecli', 'skills/missing/SKILL.md'))
      .rejects.toThrow('Bundled Skill asset is not registered');
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('fails visibly on corrupt manifests and retries after transient fetch failure', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(response('', 503))
      .mockResolvedValueOnce(response('{"schemaVersion":2,"groups":{}}'))
      .mockResolvedValueOnce(response(manifest));
    const store = createBundledSkillAssetStore({
      getUrl: (path) => `chrome-extension://test/${path}`,
      fetch,
    });

    await expect(store.list('officecli')).rejects.toThrow('request failed (503)');
    await expect(store.list('officecli')).rejects.toThrow('must use schemaVersion 1');
    await expect(store.list('officecli')).resolves.toEqual(['skills/officecli/SKILL.md']);
  });
});
