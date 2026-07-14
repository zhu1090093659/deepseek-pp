import { describe, expect, it, vi } from 'vitest';
import {
  createBundledSkillResourceLoader,
  resolveBundledSkillNames,
  type BundledSkillRegistration,
} from '../core/skill/bundled-loader';
import type { Skill } from '../core/types';

const registrations: readonly BundledSkillRegistration[] = [
  { name: 'office-a', group: 'officecli', enabled: false },
  { name: 'spec-a', group: 'spec-driven-develop', enabled: true },
  { name: 'spec-b', group: 'spec-driven-develop', enabled: false },
];

function skill(name: string): Skill {
  return {
    name,
    description: `${name} description`,
    instructions: `${name} instructions`,
    source: 'third-party',
    memoryEnabled: false,
  };
}

describe('bundled Skill on-demand loader', () => {
  it('selects only active resources until the full library is requested', () => {
    expect(resolveBundledSkillNames({}, false)).toEqual(['deep-discuss']);
    expect(resolveBundledSkillNames({ 'deep-discuss': false, officecli: true }, false))
      .toEqual(['officecli']);
    expect(resolveBundledSkillNames({}, true)).toContain('officecli-styles');
    expect(resolveBundledSkillNames({}, true)).toContain('review-spd');
  });

  it('loads only the requested group and reuses one concurrent materialization', async () => {
    const officecli = vi.fn(async (names: readonly string[]) => names.map(skill));
    const specDrivenDevelop = vi.fn(async (names: readonly string[]) => names.map(skill));
    const load = createBundledSkillResourceLoader({
      officecli,
      'spec-driven-develop': specDrivenDevelop,
    }, registrations);

    const [first, second] = await Promise.all([
      load(['spec-a']),
      load(['spec-a']),
    ]);

    expect(first).toEqual([skill('spec-a')]);
    expect(second).toEqual(first);
    expect(specDrivenDevelop).toHaveBeenCalledOnce();
    expect(specDrivenDevelop).toHaveBeenCalledWith(['spec-a']);
    expect(officecli).not.toHaveBeenCalled();

    await load(['spec-a']);
    expect(specDrivenDevelop).toHaveBeenCalledOnce();
  });

  it('evicts a failed materialization so an explicit retry can succeed', async () => {
    const officecli = vi.fn(async (names: readonly string[]) => names.map(skill));
    const specDrivenDevelop = vi.fn()
      .mockRejectedValueOnce(new Error('resource load failed'))
      .mockImplementationOnce(async (names: readonly string[]) => names.map(skill));
    const load = createBundledSkillResourceLoader({
      officecli,
      'spec-driven-develop': specDrivenDevelop,
    }, registrations);

    await expect(load(['spec-b'])).rejects.toThrow('resource load failed');
    await expect(load(['spec-b'])).resolves.toEqual([skill('spec-b')]);
    expect(specDrivenDevelop).toHaveBeenCalledTimes(2);
  });

  it('rejects incomplete and over-broad group loader results', async () => {
    const missing = createBundledSkillResourceLoader({
      officecli: async () => [],
      'spec-driven-develop': async () => [],
    }, registrations);
    await expect(missing(['office-a']))
      .rejects.toThrow('did not return requested Skill: office-a');

    const overBroad = createBundledSkillResourceLoader({
      officecli: async () => [skill('office-a'), skill('spec-a')],
      'spec-driven-develop': async () => [],
    }, registrations);
    await expect(overBroad(['office-a']))
      .rejects.toThrow('returned an unrequested Skill: spec-a');
  });
});
