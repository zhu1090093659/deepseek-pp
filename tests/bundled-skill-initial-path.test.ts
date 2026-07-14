import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getAllSkills,
  getSkillCollisionCandidates,
  getSkillLibrary,
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
    expect(activeSkills.map(({ name }) => name)).toEqual([
      'shell',
      'deep-discuss',
      'memory',
      'ultra-think',
      'frontend-design',
      'doc-coauthoring',
      'brand-guidelines',
      'skill-creator',
      'algorithmic-art',
      'canvas-design',
    ]);
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

    const library = await getSkillLibrary();
    expect(library.map(({ name }) => name)).toEqual([
      'shell',
      'officecli',
      'officecli-docx',
      'officecli-xlsx',
      'officecli-pptx',
      'officecli-academic-paper',
      'officecli-word-form',
      'officecli-data-dashboard',
      'officecli-financial-model',
      'officecli-pitch-deck',
      'morph-ppt',
      'morph-ppt-3d',
      'officecli-styles',
      'spec-driven-develop',
      'deep-discuss',
      'review-spd',
      'memory',
      'ultra-think',
      'frontend-design',
      'doc-coauthoring',
      'brand-guidelines',
      'skill-creator',
      'algorithmic-art',
      'canvas-design',
    ]);
  });
});
