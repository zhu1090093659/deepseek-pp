import {
  FLOATING_CHAT_HOST_ORIGINS,
  resolveFloatingChatRuntimeState,
  type FloatingChatRuntimeState,
} from '../../../core/floating-chat/runtime-state';
import { getFloatingChatEnabled, setFloatingChatEnabled } from '../../../core/floating-chat/store';
import type { SyncCommandTarget } from '../../../core/types';
import {
  sidepanelRuntimeClient,
  type SidepanelRuntimeClient,
} from '../runtime-client';

export interface FloatingChatPermissionPort {
  contains(origins: readonly string[]): Promise<boolean>;
  request(origins: readonly string[]): Promise<boolean>;
}

export interface FloatingChatSettingsController {
  load(): Promise<FloatingChatRuntimeState>;
  setEnabled(enabled: boolean): Promise<FloatingChatRuntimeState>;
}

export function createFloatingChatSettingsController(dependencies: {
  readEnabled(): Promise<boolean>;
  writeEnabled(enabled: boolean): Promise<void>;
  permissions: FloatingChatPermissionPort;
  isContextInvalidated(error: unknown): boolean;
}): FloatingChatSettingsController {
  const load = () => resolveFloatingChatRuntimeState({
    readEnabled: dependencies.readEnabled,
    hasHostPermission: () => dependencies.permissions.contains(FLOATING_CHAT_HOST_ORIGINS),
    isContextInvalidated: dependencies.isContextInvalidated,
  });

  const controller: FloatingChatSettingsController = {
    load,
    async setEnabled(enabled) {
      if (!enabled) {
        try {
          await dependencies.writeEnabled(false);
          return { kind: 'disabled' };
        } catch (error) {
          if (dependencies.isContextInvalidated(error)) return { kind: 'invalidated' };
          throw error;
        }
      }

      try {
        const alreadyGranted = await dependencies.permissions.contains(FLOATING_CHAT_HOST_ORIGINS);
        const granted = alreadyGranted
          || await dependencies.permissions.request(FLOATING_CHAT_HOST_ORIGINS);
        if (!granted) return { kind: 'missing-permission' };
        await dependencies.writeEnabled(true);
        return { kind: 'ready' };
      } catch (error) {
        if (dependencies.isContextInvalidated(error)) return { kind: 'invalidated' };
        throw error;
      }
    },
  };
  return Object.freeze(controller);
}

export const floatingChatSettingsController = createFloatingChatSettingsController({
  readEnabled: getFloatingChatEnabled,
  writeEnabled: setFloatingChatEnabled,
  permissions: {
    async contains(origins) {
      if (!chrome.permissions?.contains) {
        throw new Error('Browser host permission checks are unavailable.');
      }
      return chrome.permissions.contains({ origins: [...origins] });
    },
    async request(origins) {
      if (!chrome.permissions?.request) {
        throw new Error('Browser host permission requests are unavailable.');
      }
      return chrome.permissions.request({ origins: [...origins] });
    },
  },
  isContextInvalidated: isExtensionContextInvalidated,
});

export type SyncRuntimeCommandType =
  | 'WEBDAV_TEST'
  | 'SYNC_AUTHORIZE'
  | 'WEBDAV_UPLOAD_LOCAL'
  | 'WEBDAV_DOWNLOAD_REMOTE';

export interface SettingsSyncRuntimeController {
  execute(type: SyncRuntimeCommandType, target: SyncCommandTarget): Promise<unknown>;
  getConfig(): Promise<unknown>;
}

export function createSettingsSyncRuntimeController(
  runtimeClient: SidepanelRuntimeClient = sidepanelRuntimeClient,
): SettingsSyncRuntimeController {
  const controller: SettingsSyncRuntimeController = {
    execute(type, target) {
      if (type === 'WEBDAV_TEST') {
        return runtimeClient.request(
          { type, payload: target },
          { acceptFailure: true, decode: (value) => value },
        );
      }
      if (type === 'SYNC_AUTHORIZE') {
        return runtimeClient.request(
          { type, payload: target },
          { acceptFailure: true, decode: (value) => value },
        );
      }
      if (type === 'WEBDAV_UPLOAD_LOCAL') {
        return runtimeClient.request(
          { type, payload: target },
          { acceptFailure: true, decode: (value) => value },
        );
      }
      return runtimeClient.request(
        { type: 'WEBDAV_DOWNLOAD_REMOTE', payload: target },
        { acceptFailure: true, decode: (value) => value },
      );
    },
    getConfig: () => runtimeClient.request({ type: 'GET_SYNC_CONFIG' }),
  };
  return Object.freeze(controller);
}

export const settingsSyncRuntimeController = createSettingsSyncRuntimeController();

export function isExtensionContextInvalidated(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /extension context invalidated|context invalidated/i.test(message);
}
