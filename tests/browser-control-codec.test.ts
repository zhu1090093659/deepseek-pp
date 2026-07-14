import { describe, expect, it } from 'vitest';
import {
  decodeBrowserControlSettings,
  decodeBrowserControlState,
} from '../core/browser-control';

describe('browser control response codec', () => {
  it('decodes the released settings and state shapes without dropping additive fields', () => {
    const settings = {
      enabled: true,
      targetTabId: 7,
      includeSnapshotAfterActions: true,
      maxSnapshotNodes: 400,
      maxSnapshotTextBytes: 24_000,
      additive: 'kept',
    };
    const target = {
      id: 7,
      windowId: 1,
      groupId: -1,
      active: true,
      currentWindow: true,
      title: 'DeepSeek',
      url: 'https://chat.deepseek.com/',
      controllable: true,
    };

    expect(decodeBrowserControlSettings(settings)).toEqual(settings);
    expect(decodeBrowserControlState({
      supported: true,
      enabled: true,
      attached: true,
      targetTabId: 7,
      target,
      targets: [target],
      error: null,
      additive: 'kept',
    })).toMatchObject({ target, targets: [target], additive: 'kept' });
  });

  it('rejects malformed response fields instead of normalizing them into defaults', () => {
    expect(() => decodeBrowserControlSettings({ enabled: 'yes' }))
      .toThrow('browserControlSettings.enabled must be a boolean');
    expect(() => decodeBrowserControlState({
      supported: true,
      enabled: false,
      attached: false,
      targetTabId: null,
      target: null,
      targets: {},
      error: null,
    })).toThrow('browserControlState.targets must be an array');
  });
});
