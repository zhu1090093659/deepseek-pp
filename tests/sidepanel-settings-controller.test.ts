import { describe, expect, it, vi } from 'vitest';
import {
  createFloatingChatSettingsController,
  createSettingsSyncRuntimeController,
} from '../entrypoints/sidepanel/controllers/settings-controller';
import { createSidepanelRuntimeClient } from '../entrypoints/sidepanel/runtime-client';

describe('floating-chat settings controller', () => {
  it('reports missing permission without committing enabled state', async () => {
    const writeEnabled = vi.fn(async () => undefined);
    const permissions = {
      contains: vi.fn(async () => false),
      request: vi.fn(async () => false),
    };
    const controller = createFloatingChatSettingsController({
      readEnabled: async () => false,
      writeEnabled,
      permissions,
      isContextInvalidated: () => false,
    });

    await expect(controller.setEnabled(true)).resolves.toEqual({ kind: 'missing-permission' });
    expect(permissions.contains).toHaveBeenCalledWith(['http://*/*', 'https://*/*']);
    expect(permissions.request).toHaveBeenCalledWith(['http://*/*', 'https://*/*']);
    expect(writeEnabled).not.toHaveBeenCalled();
  });

  it('disables without removing shared optional origins and classifies invalidation', async () => {
    const writeEnabled = vi.fn(async (enabled: boolean) => {
      if (enabled) throw new Error('Extension context invalidated');
    });
    const permissions = {
      contains: vi.fn(async () => true),
      request: vi.fn(async () => true),
    };
    const controller = createFloatingChatSettingsController({
      readEnabled: async () => true,
      writeEnabled,
      permissions,
      isContextInvalidated: (error) => String(error).includes('invalidated'),
    });

    await expect(controller.setEnabled(false)).resolves.toEqual({ kind: 'disabled' });
    expect(writeEnabled).toHaveBeenCalledWith(false);
    expect(permissions.request).not.toHaveBeenCalled();
    await expect(controller.setEnabled(true)).resolves.toEqual({ kind: 'invalidated' });
  });
});

describe('settings sync runtime controller', () => {
  it('preserves typed target-bearing failure responses for controller classification', async () => {
    const sendMessage = vi.fn(async () => ({
      ok: false,
      error: 'bookkeeping unknown',
      code: 'sync_operation_effect_completed_config_persist_failed',
      reloadConfig: true,
      effectCompleted: true,
    }));
    const controller = createSettingsSyncRuntimeController(
      createSidepanelRuntimeClient(sendMessage),
    );
    const target = {
      config: {
        provider: 'webdav' as const,
        url: 'https://dav.example.test',
        username: '',
        password: '',
        remotePath: 'DeepSeekPP',
        lastSyncAt: null,
      },
      expectedRevision: null,
    };

    await expect(controller.execute('WEBDAV_UPLOAD_LOCAL', target)).resolves.toMatchObject({
      ok: false,
      effectCompleted: true,
    });
    expect(sendMessage).toHaveBeenCalledWith({
      type: 'WEBDAV_UPLOAD_LOCAL',
      payload: target,
    });
  });
});
