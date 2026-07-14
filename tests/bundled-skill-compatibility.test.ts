import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  BUNDLED_SKILL_REGISTRATIONS,
  loadBundledSkills,
} from '../core/skill/bundled-loader';
import packagePolicy from '../scripts/bundled-skill-package-policy.json';
import {
  fetchBundledSkillAsset,
  getBundledSkillAssetUrl,
} from './helpers/bundled-skill-assets';

beforeAll(() => {
  vi.stubGlobal('fetch', fetchBundledSkillAsset);
  vi.stubGlobal('chrome', { runtime: { getURL: getBundledSkillAssetUrl } });
});

afterAll(() => {
  vi.unstubAllGlobals();
});

describe('bundled Skill compatibility', () => {
  it('materializes every official Skill at its pre-lazy-load byte identity', async () => {
    const skills = await loadBundledSkills(
      BUNDLED_SKILL_REGISTRATIONS.map(({ name }) => name),
    );
    const hashes = Object.fromEntries(skills.map((skill) => [
      skill.name,
      createHash('sha256').update(JSON.stringify(skill)).digest('hex'),
    ]));
    const defaultEnabled = Object.fromEntries(skills.map((skill) => [
      skill.name,
      skill.enabled !== false,
    ]));
    const registeredDefaults = Object.fromEntries(BUNDLED_SKILL_REGISTRATIONS.map((skill) => [
      skill.name,
      skill.enabled,
    ]));

    expect(hashes).toEqual(packagePolicy.skillSha256);
    expect(defaultEnabled).toEqual(registeredDefaults);
  });
});
