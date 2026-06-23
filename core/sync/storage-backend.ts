import type { SyncConfig } from '../types';
import type { WebdavSyncConfig } from '../types';
import { webdavGet, webdavMkcol, webdavPut, webdavTest } from './webdav-client';
import { createGDriveBackend } from './gdrive-client';
import { createOneDriveBackend } from './onedrive-client';

/**
 * Provider-agnostic key/value storage used by the sync pipeline.
 *
 * Each logical sync file (memories.json, skills.json, ...) is addressed by a
 * fixed string key. Every backend maps that key to its own physical location
 * (WebDAV path / Drive appDataFolder file id / OneDrive app-root item) and
 * owns auth concerns. The sync flow only sees get/put/test/ensureStore.
 */
export interface StorageBackend {
  /** Verify credentials / connectivity. Throws on auth or network failure. */
  test(): Promise<void>;

  /**
   * Ensure the remote store exists (WebDAV: MKCOL the remote dir;
   * Drive/OneDrive: appDataFolder / app-root are implicit, so no-op).
   */
  ensureStore(): Promise<void>;

  /** Read a key. Returns null when absent (404), never throws on missing. */
  get(key: string): Promise<string | null>;

  /** Write a key, overwriting if present. */
  put(key: string, content: string): Promise<void>;
}

export function createStorageBackend(config: SyncConfig): StorageBackend {
  switch (config.provider) {
    case 'webdav':
      return new WebdavBackend(config);
    case 'gdrive':
      return createGDriveBackend(config);
    case 'onedrive':
      return createOneDriveBackend(config);
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
