/**
 * Raw IndexedDB helpers for tests that seed or inspect historical databases
 * without going through the production store modules. They speak only the
 * IndexedDB specification so fixtures stay independent of the wrapper's
 * schema translation.
 */

export function deleteIndexedDb(name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error(`Failed to delete ${name}`));
    request.onblocked = () => {
      // A lingering connection is closing; deletion resumes afterwards.
    };
  });
}

export interface IndexedDbSeedStoreSpec {
  keyPath: string;
  autoIncrement: boolean;
  indexes?: readonly string[];
}

/**
 * Opens `name` at exactly `version` (creating it if needed), applies
 * `upgrade` in the versionchange transaction, and closes the connection.
 * The upgrade callback receives the IDBDatabase (which owns
 * createObjectStore) and the active versionchange transaction.
 */
export function createIndexedDbAtVersion(
  name: string,
  version: number,
  upgrade: (db: IDBDatabase, tx: IDBTransaction) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, version);
    request.onupgradeneeded = () => {
      const tx = request.transaction;
      const db = request.result;
      if (!tx || !db) return;
      try {
        upgrade(db, tx);
      } catch (error) {
        try {
          tx.abort();
        } catch {
          // Abort is authoritative.
        }
        reject(error);
      }
    };
    request.onsuccess = () => {
      request.result.close();
      resolve();
    };
    request.onerror = () => reject(request.error ?? new Error(`Failed to open ${name}`));
    request.onblocked = () => {
      // A lingering connection is closing; the version change resumes.
    };
  });
}

export function createStore(
  db: IDBDatabase,
  storeName: string,
  spec: IndexedDbSeedStoreSpec,
): IDBObjectStore {
  const store = db.createObjectStore(storeName, {
    keyPath: spec.keyPath,
    autoIncrement: spec.autoIncrement,
  });
  for (const indexName of spec.indexes ?? []) {
    store.createIndex(indexName, indexName);
  }
  return store;
}

/** Adds `records` to `storeName` inside a fresh readwrite transaction. */
export function addIndexedDbRecords(
  name: string,
  storeName: string,
  records: readonly unknown[],
): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction([storeName], 'readwrite');
      const store = tx.objectStore(storeName);
      for (const record of records) store.add(record);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onabort = () => {
        db.close();
        reject(tx.error ?? new Error(`Failed to add records to ${storeName}`));
      };
      tx.onerror = () => {
        // The failing request aborts the transaction; onabort rejects.
      };
    };
    request.onerror = () => reject(request.error ?? new Error(`Failed to open ${name}`));
  });
}

/** Reads every row of `storeName` (primary-key order). */
export function readIndexedDbRecords(name: string, storeName: string): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction([storeName], 'readonly');
      const store = tx.objectStore(storeName);
      const records: unknown[] = [];
      const cursor = store.openCursor();
      cursor.onsuccess = () => {
        const current = cursor.result;
        if (!current) {
          resolve(records);
          db.close();
          return;
        }
        records.push(current.value);
        current.continue();
      };
      cursor.onerror = () => reject(cursor.error);
    };
    request.onerror = () => reject(request.error ?? new Error(`Failed to open ${name}`));
  });
}
