import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BUILTIN_SKILLS, getLocalizedBuiltinSkills } from '../core/skill/builtin';
import { loadBundledSkills } from '../core/skill/bundled-loader';
import { getAllSkills, setSkillEnabled, setSkillsEnabled } from '../core/skill/registry';
import type { Skill } from '../core/types';
import {
  fetchBundledSkillAsset,
  getBundledSkillAssetUrl,
} from './helpers/bundled-skill-assets';

const SKILL_STORAGE_KEY = 'deepseek_pp_skills';
const BUNDLED_ENABLED_STORAGE_KEY = 'deepseek_pp_bundled_skill_enabled';

let storage: Record<string, unknown>;

function findSkill(skills: Skill[], name: string): Skill {
  const skill = skills.find((item) => item.name === name);
  if (!skill) throw new Error(`Missing skill: ${name}`);
  return skill;
}

beforeEach(() => {
  storage = {};
  vi.stubGlobal('fetch', fetchBundledSkillAsset);
  vi.stubGlobal('chrome', {
    runtime: {
      getURL: getBundledSkillAssetUrl,
    },
    storage: {
      local: {
        get: vi.fn(async (key: string) => ({ [key]: storage[key] })),
        set: vi.fn(async (values: Record<string, unknown>) => {
          storage = { ...storage, ...values };
        }),
        remove: vi.fn(async (key: string) => {
          delete storage[key];
        }),
      },
      onChanged: {
        addListener: vi.fn(),
        removeListener: vi.fn(),
      },
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('builtin skill localization', () => {
  it('selects English builtin display and model instructions without changing names', () => {
    const skills = getLocalizedBuiltinSkills('en');
    const shell = findSkill(skills, 'shell');
    const memory = findSkill(skills, 'memory');

    expect(shell.source).toBe('builtin');
    expect(shell.name).toBe('shell');
    expect(shell.description).toContain('Local command-line assistant');
    expect(shell.instructions).toContain('You are executing local shell commands');
    expect(shell.instructions).toContain('<shell_exec>{"command":"..."}</shell_exec>');
    expect(shell.instructions).not.toContain('你正在通过');

    expect(memory.name).toBe('memory');
    expect(memory.description).toContain('Memory management');
    expect(memory.instructions).toContain('The user is asking to manage memories');
    expect(memory.instructions).toContain('"name":"memory_update"');
    expect(memory.instructions).toContain('"description":"Update an existing memory"');
  });

  it('keeps Chinese builtin skills as the default resource', () => {
    const skills = getLocalizedBuiltinSkills('zh-CN');
    const shell = findSkill(skills, 'shell');
    const memory = findSkill(skills, 'memory');

    expect(shell.description).toContain('本地命令行助手');
    expect(shell.instructions).toContain('你正在通过 DeepSeek++ Shell MCP 执行本地命令');
    expect(memory.instructions).toContain('"description":"更新已有记忆"');
  });

  it('does not mutate the canonical default builtin skill objects', () => {
    const canonicalShell = findSkill(BUILTIN_SKILLS, 'shell');
    const englishShell = findSkill(getLocalizedBuiltinSkills('en'), 'shell');

    expect(canonicalShell.description).toContain('本地命令行助手');
    expect(englishShell.description).toContain('Local command-line assistant');
  });

  it('leaves OfficeCLI third-party skills out of builtin translation scope and disabled by default', async () => {
    const english = findSkill(await loadBundledSkills(['officecli-styles']), 'officecli-styles');
    const chinese = findSkill(await loadBundledSkills(['officecli-styles']), 'officecli-styles');

    expect(english.source).toBe('third-party');
    expect(english.enabled).toBe(false);
    expect(english.description).toBe(chinese.description);
    expect(english.instructions).toBe(chinese.instructions);
  });

  it('keeps bundled third-party skills out of the active list until explicitly enabled', async () => {
    expect((await getAllSkills()).some((skill) => skill.name === 'officecli')).toBe(false);

    const libraryOfficeCli = findSkill(await getAllSkills({ includeDisabled: true }), 'officecli');
    expect(libraryOfficeCli.source).toBe('third-party');
    expect(libraryOfficeCli.enabled).toBe(false);

    await setSkillEnabled('officecli', true);

    const activeOfficeCli = findSkill(await getAllSkills(), 'officecli');
    expect(activeOfficeCli.source).toBe('third-party');
    expect(activeOfficeCli.enabled).toBe(true);
  });

  it('does not treat first-party builtin skills as locally toggleable', async () => {
    await expect(setSkillEnabled('shell', false)).rejects.toThrow('Skill cannot be enabled or disabled');
  });

  it('toggles multiple custom and remote skills with one storage write', async () => {
    storage[SKILL_STORAGE_KEY] = [
      {
        name: 'custom-note',
        description: 'Custom',
        instructions: 'Custom instructions',
        source: 'custom',
        memoryEnabled: false,
        enabled: false,
      },
      {
        name: 'remote-skill',
        description: 'Remote',
        instructions: 'Remote instructions',
        source: 'remote',
        memoryEnabled: false,
        enabled: false,
      },
    ];

    await setSkillsEnabled([
      { name: 'custom-note', enabled: true },
      { name: 'remote-skill', enabled: true },
    ]);

    const saved = storage[SKILL_STORAGE_KEY] as Skill[];
    expect(saved.map((skill) => [skill.name, skill.enabled])).toEqual([
      ['custom-note', true],
      ['remote-skill', true],
    ]);
    expect(chrome.storage.local.set).toHaveBeenCalledTimes(1);
  });

  it('toggles multiple bundled third-party skills in one override write', async () => {
    await setSkillsEnabled([
      { name: 'officecli', enabled: true },
      { name: 'officecli-styles', enabled: true },
    ]);

    expect(storage[BUNDLED_ENABLED_STORAGE_KEY]).toMatchObject({
      officecli: true,
      'officecli-styles': true,
    });
    expect(chrome.storage.local.set).toHaveBeenCalledTimes(1);
  });

  it('keeps custom and remote skills exactly as authored while localizing builtins', async () => {
    storage[SKILL_STORAGE_KEY] = [
      {
        name: 'custom-note',
        description: '自定义描述',
        instructions: '保持我的原始指令',
        source: 'custom',
        memoryEnabled: false,
        enabled: true,
      },
      {
        name: 'remote-skill',
        description: 'Remote original description',
        instructions: 'Remote original instructions',
        source: 'remote',
        memoryEnabled: false,
        enabled: false,
      },
    ];

    const skills = await getAllSkills({ includeDisabled: true, locale: 'en' });
    const shell = findSkill(skills, 'shell');
    const custom = findSkill(skills, 'custom-note');
    const remote = findSkill(skills, 'remote-skill');

    expect(shell.description).toContain('Local command-line assistant');
    expect(custom.description).toBe('自定义描述');
    expect(custom.instructions).toBe('保持我的原始指令');
    expect(remote.description).toBe('Remote original description');
    expect(remote.instructions).toBe('Remote original instructions');
    expect(remote.enabled).toBe(false);
  });

  describe('Spec-Driven Develop bundled skills', () => {
    const SDD_SKILL_NAMES = ['spec-driven-develop', 'deep-discuss', 'review-spd'];

    it('registers all three skills as third-party with spec-driven-develop provider and homepage', async () => {
      const bundledSkills = await loadBundledSkills(SDD_SKILL_NAMES);
      for (const name of SDD_SKILL_NAMES) {
        const skill = findSkill(bundledSkills, name);
        expect(skill.source).toBe('third-party');
        expect(skill.metadata?.provider).toBe('spec-driven-develop');
        expect(skill.metadata?.homepage).toBe('https://github.com/zhu1090093659/spec_driven_develop');
      }
    });

    it('enables deep-discuss by default but disables spec-driven-develop and review-spd', async () => {
      const bundledSkills = await loadBundledSkills(SDD_SKILL_NAMES);
      expect(findSkill(bundledSkills, 'deep-discuss').enabled).toBe(true);
      expect(findSkill(bundledSkills, 'spec-driven-develop').enabled).toBe(false);
      expect(findSkill(bundledSkills, 'review-spd').enabled).toBe(false);
    });

    it('inlines references and scripts into spec-driven-develop instructions', async () => {
      const skill = findSkill(
        await loadBundledSkills(['spec-driven-develop']),
        'spec-driven-develop',
      );
      expect(skill.instructions).toContain('Bundled Reference: references/behavioral-rules.md');
      expect(skill.instructions).toContain('Bundled Reference: references/super-philosophy.md');
      expect(skill.instructions).toContain('Bundled Reference: references/templates/plan.md');
      expect(skill.instructions).toContain('S.U.P.E.R');
      expect(skill.instructions).toContain('DeepSeek++ 执行边界');
    });

    it('inlines review-context.py script into review-spd instructions', async () => {
      const skill = findSkill(await loadBundledSkills(['review-spd']), 'review-spd');
      expect(skill.instructions).toContain('Bundled Script: scripts/review-context.py');
      expect(skill.instructions).toContain('def run_git');
      expect(skill.instructions).toContain('Bundled Reference: references/output-format.md');
    });

    it('deep-discuss has no references and only contains the skill body', async () => {
      const skill = findSkill(await loadBundledSkills(['deep-discuss']), 'deep-discuss');
      expect(skill.instructions).toContain('Deep Discuss');
      expect(skill.instructions).not.toContain('Bundled Reference:');
      expect(skill.instructions).not.toContain('Bundled Script:');
    });

    it('respects bundled toggle off via setSkillEnabled', async () => {
      await setSkillEnabled('deep-discuss', false);
      const skills = await getAllSkills({ includeDisabled: true });
      const skill = findSkill(skills, 'deep-discuss');
      expect(skill.enabled).toBe(false);
    });
  });
});
