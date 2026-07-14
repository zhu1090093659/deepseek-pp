import { describe, expect, it } from 'vitest';
import {
  createEmptyHistoryOrganizerState,
  decodeHistoryOrganizerState,
} from '../core/history-organizer/codec';
import {
  decodeActivePresetId,
  decodePresetCollection,
} from '../core/preset/codec';
import {
  decodeSkillSourceCollection,
  decodeUserSkillCollection,
} from '../core/skill/codec';
import { parseValidatedJson } from '../core/sync/schema';
import {
  LEGACY_CUSTOM_SKILL,
  LEGACY_GITHUB_SKILL_SOURCE,
  LEGACY_PRESET,
  LEGACY_REMOTE_SKILL,
  REMAINING_LOCAL_STATE_REJECTED_VALUES,
  VERSIONLESS_HISTORY_STATE,
} from './fixtures/persistence-contract/skill-preset-history';

describe('remaining local-state codecs', () => {
  it('preserves released Skill records, additive fields, duplicate names, and missing enabled', () => {
    const decoded = decodeUserSkillCollection([
      LEGACY_CUSTOM_SKILL,
      LEGACY_REMOTE_SKILL,
      { ...LEGACY_CUSTOM_SKILL },
    ]);

    expect(decoded[0]).toEqual({ ...LEGACY_CUSTOM_SKILL, enabled: true });
    expect(decoded[1]).toEqual(LEGACY_REMOTE_SKILL);
    expect(decoded[1].remote).toMatchObject({ additiveRemoteField: 'preserve' });
    expect(decoded[2].name).toBe(decoded[0].name);
  });

  it('uses the same Skill and source collection decoders for local and sync JSON', () => {
    const skills = [LEGACY_CUSTOM_SKILL, LEGACY_REMOTE_SKILL];
    const sources = [LEGACY_GITHUB_SKILL_SOURCE];

    expect(parseValidatedJson('skills.json', JSON.stringify(skills), decodeUserSkillCollection))
      .toEqual(decodeUserSkillCollection(skills));
    expect(parseValidatedJson('skill-sources.json', JSON.stringify(sources), decodeSkillSourceCollection))
      .toEqual(decodeSkillSourceCollection(sources));
  });

  it('preserves released Preset records including empty imported text and additive fields', () => {
    expect(decodePresetCollection([LEGACY_PRESET, { ...LEGACY_PRESET }]))
      .toEqual([LEGACY_PRESET, LEGACY_PRESET]);
    expect(decodeActivePresetId('')).toBe('');
  });

  it('accepts versionless History state, normalizes released tags, and preserves additive fields', () => {
    expect(decodeHistoryOrganizerState(VERSIONLESS_HISTORY_STATE)).toEqual({
      ...VERSIONLESS_HISTORY_STATE,
      schemaVersion: 1,
      tagsBySessionId: {
        'session-one': ['release', 'writing', 'research'],
      },
    });
    expect(createEmptyHistoryOrganizerState()).toEqual({ schemaVersion: 1, tagsBySessionId: {} });
  });

  it('preserves prototype-named History session ids as ordinary data keys', () => {
    const decoded = decodeHistoryOrganizerState(JSON.parse(
      '{"tagsBySessionId":{"__proto__":["release"]}}',
    ));

    expect(Object.keys(decoded.tagsBySessionId)).toEqual(['__proto__']);
    expect(decoded.tagsBySessionId['__proto__']).toEqual(['release']);
    expect(Object.getPrototypeOf(decoded.tagsBySessionId)).toBe(Object.prototype);
  });

  it('rejects corrupt, future-envelope, and future-record state explicitly', () => {
    for (const value of REMAINING_LOCAL_STATE_REJECTED_VALUES) {
      expect(() => decodeUserSkillCollection(value)).toThrow();
      expect(() => decodeSkillSourceCollection(value)).toThrow();
      expect(() => decodePresetCollection(value)).toThrow();
      expect(() => decodeHistoryOrganizerState(value)).toThrow();
    }

    expect(() => decodeUserSkillCollection([{ ...LEGACY_CUSTOM_SKILL, schemaVersion: 2 }]))
      .toThrow('schemaVersion');
    expect(() => decodeSkillSourceCollection([{ ...LEGACY_GITHUB_SKILL_SOURCE, schemaVersion: 2 }]))
      .toThrow('schemaVersion');
    expect(() => decodePresetCollection([{ ...LEGACY_PRESET, schemaVersion: 2 }]))
      .toThrow('schemaVersion');
    expect(() => decodeHistoryOrganizerState({ schemaVersion: 2, tagsBySessionId: {} }))
      .toThrow('schemaVersion');
  });
});
