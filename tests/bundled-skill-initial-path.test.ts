import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getAllSkills,
  getSkillCollisionCandidates,
} from '../core/skill/registry';
import {
  fetchBundledSkillAsset,
  getBundledSkillAssetUrl,
} from './helpers/bundled-skill-assets';

const fetchAsset = vi.fn(fetchBundledSkillAsset);

beforeEach(() => {
  fetchAsset.mockClear();
  vi.stubGlobal('fetch', fetchAsset);
  vi.stubGlobal('chrome', {
    runtime: { getURL: getBundledSkillAssetUrl },
    storage: {
      local: {
        get: vi.fn(async () => ({})),
        set: vi.fn(async () => undefined),
      },
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('bundled Skill initial path', () => {
  it('loads only the default-enabled Skill and keeps collision checks metadata-only', async () => {
    const activeSkills = await getAllSkills();
    expect(activeSkills.some(({ name }) => name === 'deep-discuss')).toBe(true);
    expect(activeSkills.some(({ name }) => name === 'officecli')).toBe(false);
    expect(fetchAsset.mock.calls.map(([url]) => String(url))).toEqual([
      getBundledSkillAssetUrl('bundled-skills/manifest.json'),
      getBundledSkillAssetUrl(
        'bundled-skills/spec-driven-develop/deep-discuss/SKILL.md',
      ),
    ]);

    const requestsBeforeCollisionCheck = fetchAsset.mock.calls.length;
    const collisionCandidates = await getSkillCollisionCandidates();
    expect(collisionCandidates.some(({ name }) => name === 'officecli')).toBe(true);
    expect(fetchAsset).toHaveBeenCalledTimes(requestsBeforeCollisionCheck);
  });
});
