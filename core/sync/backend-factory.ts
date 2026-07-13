import type { SyncConfig, WebdavSyncConfig } from '../types';
import { createGDriveBackend } from './gdrive-client';
import { createOneDriveBackend } from './onedrive-client';
import {
  defaultSyncErrorTranslator,
  type SyncErrorTranslator,
} from './oauth-client';
import type { StorageBackend } from './storage-backend';
import { webdavGet, webdavMkcol, webdavPut, webdavTest } from './webdav-client';

export function createStorageBackend(
  config: SyncConfig,
  t: SyncErrorTranslator = defaultSyncErrorTranslator,
): StorageBackend {
  switch (config.provider) {
    case 'webdav':
      return new WebdavBackend(config);
    case 'gdrive':
      return createGDriveBackend(config, t);
    case 'onedrive':
      return createOneDriveBackend(config, t);
  }
}

class WebdavBackend implements StorageBackend {
  constructor(private readonly config: WebdavSyncConfig) {}

  async test(): Promise<void> {
    await webdavTest(this.config);
  }

  async ensureStore(): Promise<void> {
    await webdavMkcol(this.config);
  }

  async get(key: string): Promise<string | null> {
    return webdavGet(this.config, key);
  }

  async put(key: string, content: string): Promise<void> {
    await webdavPut(this.config, key, content);
  }
}
