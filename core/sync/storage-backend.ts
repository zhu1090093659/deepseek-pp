/**
 * Provider-agnostic key/value storage used by the sync pipeline.
 *
 * Each remote sync object is addressed by an opaque string key. Every backend
 * maps that key to its own physical location
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
