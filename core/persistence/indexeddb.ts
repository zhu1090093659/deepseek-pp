/**
 * Native IndexedDB thin wrapper for the background persistence layer.
 *
 * Replaces the dexie dependency (removed in the #506 background slim-down)
 * with the exact API surface the three production stores use, translated
 * 1:1 onto the IndexedDB specification:
 *
 * - Dexie schema strings (e.g. `'++id, type, name'`) are translated at
 *   construction time: the first token is the in-line primary key (`++`
 *   means auto-increment, `&` means unique — IDB primary keys are unique by
 *   definition), every following token is a non-unique single-field index.
 * - The database version convention is preserved: callers pass IDB versions
 *   that are exactly 10x their logical schema version (dexie multiplied
 *   versions by 10 internally), so `backendDB().version === logical * 10`
 *   assertions in the stores keep holding.
 * - Upgrades are applied per declared step inside the single versionchange
 *   transaction IDB opens when a database is older than the target version:
 *   each step first reconciles the object-store schema (create missing
 *   stores/indexes, drop stale indexes) and then runs its row migration via
 *   cursor updates, which preserve every unknown/additive field. A fresh
 *   database is created directly at the target version (dexie behavior:
 *   intermediate upgrade callbacks never run against empty data).
 * - A database at a HIGHER version than the target is opened without a
 *   version (dexie behavior: open() succeeds and the store-level version
 *   assertion reports the unsupported version). Its raw rows are never
 *   touched, and any upgrade attempt that fails aborts the versionchange
 *   transaction so the original state survives visibly.
 *
 * Transaction liveness: callbacks passed to `transaction()` may only await
 * operations issued through this wrapper (the same constraint dexie
 * documented for its own transactions). Awaiting a foreign promise (timer,
 * fetch, another connection's open request) lets the event loop commit the
 * underlying IDB transaction, and later requests then fail visibly with
 * TransactionInactiveError. All production call sites comply: every awaited
 * value inside a transaction callback is a wrapper operation, and the
 * cached `open()` promise resolves within one microtask hop before the next
 * request is issued.
 *
 * Table operations used outside `transaction()` (or on a table not bound to
 * one) run in their own implicit auto-commit transaction, matching the
 * previous dexie call style.
 */
import { parseDexieSchema, type ParsedDexieSchema } from './indexeddb-schema';

export interface IndexedDbIndexSpec {
  name: string;
  keyPath: string;
  unique: boolean;
  multiEntry: boolean;
}

export interface IndexedDbPrimaryKeySpec {
  name: string;
  keyPath: string;
  auto: boolean;
  unique: boolean;
}

export interface IndexedDbTableSchema {
  primKey: IndexedDbPrimaryKeySpec;
  indexes: IndexedDbIndexSpec[];
}

export interface IndexedDbUpgradeTable {
  /**
   * Runs `mutator` over every row, persisting each mutated copy. Resolves
   * when the whole table has been visited; a throw inside `mutator` or a
   * failed write aborts the versionchange transaction and rejects.
   */
  modifyAll(mutator: (record: Record<string, unknown>) => void): Promise<void>;
}

export interface IndexedDbUpgradeTx {
  table(name: string): IndexedDbUpgradeTable;
}

export interface IndexedDbUpgradeStep {
  /** IDB version this step upgrades the database to (logical version x10). */
  version: number;
  /** Table name -> dexie schema string at this version. */
  stores: Record<string, string>;
  /**
   * Deterministic row migration for databases passing through this step.
   * Runs inside the versionchange transaction and is awaited before the
   * next step: cursor-driven migrations are asynchronous, so a step may
   * only return its `modifyAll` promise once the whole table is migrated.
   * A throw or rejection aborts the upgrade and leaves the original
   * database untouched.
   */
  migrate?(tx: IndexedDbUpgradeTx): void | Promise<void>;
}

export interface IndexedDbTransaction {
  /** Returns the table bound to this transaction. */
  table(name: string): IndexedDbTable;
}

export interface IndexedDbQuery {
  toArray(): Promise<Record<string, unknown>[]>;
  primaryKeys(): Promise<IDBValidKey[]>;
  reverse(): IndexedDbQuery;
}

export interface IndexedDbWhereQuery {
  equals(value: IDBValidKey): {
    delete(): Promise<number>;
  };
}

export type IndexedDbCreatingHook = (
  primKey: IDBValidKey | undefined,
  obj: unknown,
  tx: IDBTransaction | undefined,
) => void;

export interface IndexedDbTable {
  readonly name: string;
  readonly schema: IndexedDbTableSchema;
  get(key: IDBValidKey): Promise<unknown>;
  put(record: unknown): Promise<IDBValidKey>;
  add(record: unknown): Promise<IDBValidKey>;
  /** Merges `changes` into the stored record; resolves 0 when absent. */
  update(key: IDBValidKey, changes: Record<string, unknown>): Promise<number>;
  delete(key: IDBValidKey): Promise<void>;
  clear(): Promise<void>;
  toArray(): Promise<unknown[]>;
  bulkPut(records: readonly unknown[]): Promise<void>;
  bulkAdd(records: readonly unknown[]): Promise<void>;
  bulkDelete(keys: readonly IDBValidKey[]): Promise<void>;
  count(): Promise<number>;
  orderBy(indexName: string): IndexedDbQuery;
  where(indexName: string): IndexedDbWhereQuery;
  hook(
    event: 'creating',
    fn?: IndexedDbCreatingHook,
  ): { unsubscribe(fn?: IndexedDbCreatingHook): void };
}

export class IndexedDb {
  readonly name: string;
  readonly targetVersion: number;

  private readonly upgrades: IndexedDbUpgradeStep[];
  private readonly schemas = new Map<string, IndexedDbTableSchema>();
  private readonly tables = new Map<string, IndexedDbTableImpl>();
  private readonly creatingHooks = new Map<string, Set<IndexedDbCreatingHook>>();
  private db: IDBDatabase | null = null;
  private openPromise: Promise<void> | null = null;

  constructor(
    name: string,
    upgrades: readonly IndexedDbUpgradeStep[],
  ) {
    if (upgrades.length === 0) {
      throw new Error(`IndexedDb ${name} requires at least one upgrade step`);
    }
    const sorted = [...upgrades].sort((left, right) => left.version - right.version);
    for (let index = 1; index < sorted.length; index += 1) {
      if (sorted[index].version === sorted[index - 1].version) {
        throw new Error(`IndexedDb ${name} upgrade steps must have distinct versions`);
      }
    }
    this.name = name;
    this.upgrades = sorted;
    this.targetVersion = sorted[sorted.length - 1].version;
    for (const step of sorted) {
      for (const [tableName, schemaString] of Object.entries(step.stores)) {
        this.schemas.set(tableName, toTableSchema(parseDexieSchema(schemaString)));
      }
    }
  }

  async open(): Promise<void> {
    if (!this.openPromise) {
      this.openPromise = this.openDatabase().catch((error) => {
        this.openPromise = null;
        throw error;
      });
    }
    return this.openPromise;
  }

  close(): void {
    this.db?.close();
    this.db = null;
    this.openPromise = null;
  }

  isOpen(): boolean {
    return this.db !== null;
  }

  backendDB(): IDBDatabase {
    if (!this.db) throw new Error(`IndexedDB database ${this.name} is not open`);
    return this.db;
  }

  table(name: string): IndexedDbTable {
    let table = this.tables.get(name);
    if (!table) {
      const schema = this.schemas.get(name);
      if (!schema) throw new Error(`IndexedDB database ${this.name} has no table ${name}`);
      table = new IndexedDbTableImpl(this, name, schema);
      this.tables.set(name, table);
    }
    return table;
  }

  async transaction<T>(
    mode: 'r' | 'rw',
    table: IndexedDbTable,
    operation: (tx: IndexedDbTransaction) => Promise<T>,
  ): Promise<T> {
    await this.open();
    const idbMode = mode === 'rw' ? 'readwrite' : 'readonly';
    const idbTx = this.backendDB().transaction([table.name], idbMode);
    const boundTx: IndexedDbTransaction = {
      table: (name) => this.bindTable(name, idbTx),
    };
    const completion = transactionCompletion(idbTx);
    try {
      const result = await operation(boundTx);
      await completion;
      return result;
    } catch (error) {
      try {
        idbTx.abort();
      } catch {
        // Already finished; the original error is what matters.
      }
      completion.catch(() => undefined);
      throw error;
    }
  }

  /**
   * Runs a single operation in its own auto-commit transaction. Internal:
   * table operations call this when they are not bound to an explicit
   * `transaction()`.
   */
  async implicit<T>(
    mode: IDBTransactionMode,
    tableName: string,
    operation: (store: IDBObjectStore) => Promise<T>,
  ): Promise<T> {
    await this.open();
    const tx = this.backendDB().transaction([tableName], mode);
    const completion = transactionCompletion(tx);
    let result: Promise<T>;
    try {
      result = operation(tx.objectStore(tableName));
    } catch (error) {
      completion.catch(() => undefined);
      throw error;
    }
    try {
      const value = await result;
      await completion;
      return value;
    } catch (error) {
      await completion.catch(() => undefined);
      throw error;
    }
  }

  private bindTable(name: string, idbTx: IDBTransaction): IndexedDbTable {
    const schema = this.schemas.get(name);
    if (!schema) throw new Error(`IndexedDB database ${this.name} has no table ${name}`);
    return new IndexedDbTableImpl(this, name, schema, idbTx);
  }

  /** Internal: fires the table's `creating` hooks. */
  fireCreating(
    tableName: string,
    primKey: IDBValidKey | undefined,
    obj: unknown,
    tx: IDBTransaction | undefined,
  ): void {
    const hooks = this.creatingHooks.get(tableName);
    if (!hooks || hooks.size === 0) return;
    for (const hook of [...hooks]) hook(primKey, obj, tx);
  }

  /** Internal: registers a table's `creating` hook. */
  addCreatingHook(tableName: string, hook: IndexedDbCreatingHook): void {
    let hooks = this.creatingHooks.get(tableName);
    if (!hooks) {
      hooks = new Set();
      this.creatingHooks.set(tableName, hooks);
    }
    hooks.add(hook);
  }

  /** Internal: unregisters a table's `creating` hook. */
  removeCreatingHook(tableName: string, hook: IndexedDbCreatingHook): void {
    this.creatingHooks.get(tableName)?.delete(hook);
  }

  private openDatabase(): Promise<void> {
    return new Promise((resolve, reject) => {
      const factory = globalThis.indexedDB;
      if (!factory) {
        reject(new Error(`IndexedDB is unavailable for ${this.name}`));
        return;
      }
      const request = factory.open(this.name, this.targetVersion);
      request.onupgradeneeded = async (event) => {
        const upgradeTx = request.transaction;
        const upgradeDb = request.result;
        if (!upgradeTx || !upgradeDb) return;
        const oldVersion = (event as IDBVersionChangeEvent).oldVersion;
        try {
          await this.applyUpgrades(upgradeDb, upgradeTx, oldVersion, this.targetVersion);
        } catch (error) {
          try {
            upgradeTx.abort();
          } catch {
            // Abort is authoritative; the open request rejects below.
          }
          reject(error);
        }
      };
      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };
      request.onerror = () => {
        const failure = request.error;
        if (failure && failure.name === 'VersionError') {
          // The database is newer than this runtime. Dexie opened future
          // databases without a version so the store-level version assertion
          // could report the unsupported version; raw rows stay untouched.
          this.openFutureDatabase(factory, resolve, reject);
          return;
        }
        reject(failure ?? new Error(`Failed to open IndexedDB database ${this.name}`));
      };
      request.onblocked = () => {
        // Another connection holds the database; the version change waits.
        // Extension pages never open these databases, so this only delays
        // while a stale connection drains.
      };
    });
  }

  private openFutureDatabase(
    factory: IDBFactory,
    resolve: () => void,
    reject: (error: unknown) => void,
  ): void {
    const request = factory.open(this.name);
    request.onsuccess = () => {
      this.db = request.result;
      resolve();
    };
    request.onerror = () => {
      reject(request.error ?? new Error(`Failed to open IndexedDB database ${this.name}`));
    };
  }

  private async applyUpgrades(
    db: IDBDatabase,
    tx: IDBTransaction,
    oldVersion: number,
    newVersion: number,
  ): Promise<void> {
    if (oldVersion !== 0 && oldVersion % 10 !== 0) {
      throw new Error(
        `IndexedDB database ${this.name} version ${oldVersion} is not on a supported upgrade step`,
      );
    }
    for (const step of this.upgrades) {
      if (step.version <= oldVersion || step.version > newVersion) continue;
      for (const [tableName, schemaString] of Object.entries(step.stores)) {
        this.applyTableSchema(db, tx, tableName, parseDexieSchema(schemaString));
      }
      if (step.migrate) {
        // Await the step's row migration before the next step runs so
        // concurrent cursors cannot interleave writes (each step must see
        // the previous step's committed rows).
        await step.migrate({
          table: (name) => ({
            modifyAll: (mutator) => modifyAllRows(tx, name, mutator),
          }),
        });
      }
    }
  }

  private applyTableSchema(
    db: IDBDatabase,
    tx: IDBTransaction,
    tableName: string,
    schema: ParsedDexieSchema,
  ): void {
    // createObjectStore/deleteObjectStore are IDBDatabase methods, valid only
    // while the versionchange transaction is active.
    const store = tx.objectStoreNames.contains(tableName)
      ? tx.objectStore(tableName)
      : db.createObjectStore(tableName, {
        keyPath: schema.keyPath,
        autoIncrement: schema.autoIncrement,
      });
    if (store.keyPath !== schema.keyPath || store.autoIncrement !== schema.autoIncrement) {
      throw new Error(
        `IndexedDB table ${tableName} primary key does not match the released schema`,
      );
    }
    const declared = new Set(schema.indexes.map((index) => index.name));
    for (const indexName of Array.from(store.indexNames)) {
      if (!declared.has(indexName)) store.deleteIndex(indexName);
    }
    for (const index of schema.indexes) {
      if (!store.indexNames.contains(index.name)) {
        store.createIndex(index.name, index.keyPath, {
          unique: index.unique,
          multiEntry: index.multiEntry,
        });
      }
    }
  }
}

function modifyAllRows(
  tx: IDBTransaction,
  tableName: string,
  mutator: (record: Record<string, unknown>) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const store = tx.objectStore(tableName);
    const request = store.openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        resolve();
        return;
      }
      try {
        const record = { ...(cursor.value as Record<string, unknown>) };
        mutator(record);
        const update = cursor.update(record);
        update.onsuccess = () => cursor.continue();
        update.onerror = () => {
          // The request error aborts the versionchange transaction.
          reject(update.error);
        };
      } catch (error) {
        // Aborting the versionchange transaction fails the open visibly and
        // preserves the original database.
        try {
          tx.abort();
        } catch {
          // Already finished.
        }
        reject(error);
      }
    };
    request.onerror = () => {
      // The request error aborts the versionchange transaction.
      reject(request.error);
    };
  });
}

class IndexedDbTableImpl implements IndexedDbTable {
  readonly name: string;
  readonly schema: IndexedDbTableSchema;

  constructor(
    private readonly database: IndexedDb,
    name: string,
    schema: IndexedDbTableSchema,
    private readonly boundTx: IDBTransaction | null = null,
  ) {
    this.name = name;
    this.schema = schema;
  }

  get(key: IDBValidKey): Promise<unknown> {
    return this.run('readonly', (store) => new Promise((resolve, reject) => {
      const request = store.get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    }));
  }

  put(record: unknown): Promise<IDBValidKey> {
    return this.run('readwrite', (store) => new Promise((resolve, reject) => {
      const key = primaryKeyOf(record, this.schema);
      const put = () => {
        const request = store.put(record);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      };
      if (key !== undefined) {
        const probe = store.get(key);
        probe.onsuccess = () => {
          if (probe.result === undefined) this.fireCreating(record);
          put();
        };
        probe.onerror = () => reject(probe.error);
      } else {
        this.fireCreating(record);
        put();
      }
    }));
  }

  add(record: unknown): Promise<IDBValidKey> {
    return this.run('readwrite', (store) => new Promise((resolve, reject) => {
      this.fireCreating(record);
      const request = store.add(record);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    }));
  }

  update(key: IDBValidKey, changes: Record<string, unknown>): Promise<number> {
    return this.run('readwrite', (store) => new Promise((resolve, reject) => {
      const request = store.get(key);
      request.onsuccess = () => {
        const existing = request.result;
        if (existing === undefined) {
          resolve(0);
          return;
        }
        const merged = { ...(existing as Record<string, unknown>), ...changes };
        const update = store.put(merged);
        update.onsuccess = () => resolve(1);
        update.onerror = () => reject(update.error);
      };
      request.onerror = () => reject(request.error);
    }));
  }

  delete(key: IDBValidKey): Promise<void> {
    return this.run('readwrite', (store) => new Promise((resolve, reject) => {
      const request = store.delete(key);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    }));
  }

  clear(): Promise<void> {
    return this.run('readwrite', (store) => new Promise((resolve, reject) => {
      const request = store.clear();
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    }));
  }

  toArray(): Promise<unknown[]> {
    return this.run('readonly', (store) => new Promise((resolve, reject) => {
      const records: unknown[] = [];
      const request = store.openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) {
          resolve(records);
          return;
        }
        records.push(cursor.value);
        cursor.continue();
      };
      request.onerror = () => reject(request.error);
    }));
  }

  bulkPut(records: readonly unknown[]): Promise<void> {
    return this.run('readwrite', (store) => putAll(store, records));
  }

  bulkAdd(records: readonly unknown[]): Promise<void> {
    return this.run('readwrite', (store) => new Promise((resolve, reject) => {
      let index = 0;
      const next = () => {
        if (index >= records.length) {
          resolve();
          return;
        }
        const record = records[index];
        index += 1;
        this.fireCreating(record);
        const request = store.add(record);
        request.onsuccess = () => next();
        request.onerror = () => reject(request.error);
      };
      next();
    }));
  }

  bulkDelete(keys: readonly IDBValidKey[]): Promise<void> {
    return this.run('readwrite', (store) => new Promise((resolve, reject) => {
      let index = 0;
      const next = () => {
        if (index >= keys.length) {
          resolve();
          return;
        }
        const key = keys[index];
        index += 1;
        const request = store.delete(key);
        request.onsuccess = () => next();
        request.onerror = () => reject(request.error);
      };
      next();
    }));
  }

  count(): Promise<number> {
    return this.run('readonly', (store) => new Promise((resolve, reject) => {
      const request = store.count();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    }));
  }

  orderBy(indexName: string): IndexedDbQuery {
    const query = (direction: IDBCursorDirection): IndexedDbQuery => ({
      toArray: () => this.run('readonly', (store) => (
        readOrdered(store, indexName, direction, false) as Promise<Record<string, unknown>[]>
      )),
      primaryKeys: () => this.run('readonly', (store) => (
        readOrdered(store, indexName, direction, true) as Promise<IDBValidKey[]>
      )),
      reverse: () => query(direction === 'next' ? 'prev' : 'next'),
    });
    return query('next');
  }

  where(indexName: string): IndexedDbWhereQuery {
    return {
      equals: (value) => ({
        delete: () => this.run('readwrite', (store) => deleteWhere(store, indexName, value)),
      }),
    };
  }

  hook(event: 'creating', fn?: IndexedDbCreatingHook): { unsubscribe(fn?: IndexedDbCreatingHook): void } {
    if (event !== 'creating') {
      throw new Error(`Unsupported IndexedDb hook: ${event}`);
    }
    if (fn) this.database.addCreatingHook(this.name, fn);
    return {
      unsubscribe: (removed?: IndexedDbCreatingHook) => {
        if (removed) this.database.removeCreatingHook(this.name, removed);
        else if (fn) this.database.removeCreatingHook(this.name, fn);
      },
    };
  }

  private fireCreating(record: unknown): void {
    this.database.fireCreating(
      this.name,
      primaryKeyOf(record, this.schema),
      record,
      this.boundTx ?? undefined,
    );
  }

  private run<T>(
    mode: IDBTransactionMode,
    operation: (store: IDBObjectStore) => Promise<T>,
  ): Promise<T> {
    if (this.boundTx) {
      if (mode === 'readwrite' && this.boundTx.mode !== 'readwrite') {
        return Promise.reject(
          new Error(`IndexedDB table ${this.name} requires a readwrite transaction`),
        );
      }
      return operation(this.boundTx.objectStore(this.name));
    }
    return this.database.implicit(mode, this.name, operation);
  }
}

function putAll(store: IDBObjectStore, records: readonly unknown[]): Promise<void> {
  return new Promise((resolve, reject) => {
    let index = 0;
    const next = () => {
      if (index >= records.length) {
        resolve();
        return;
      }
      const record = records[index];
      index += 1;
      const request = store.put(record);
      request.onsuccess = () => next();
      request.onerror = () => reject(request.error);
    };
    next();
  });
}

function readOrdered(
  store: IDBObjectStore,
  indexName: string,
  direction: IDBCursorDirection,
  keysOnly: boolean,
): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    const results: unknown[] = [];
    const source = indexName === store.keyPath ? store : store.index(indexName);
    const request = source.openCursor(undefined, direction);
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        resolve(results);
        return;
      }
      // Index cursors expose the index key as `key` and the row's primary
      // key as `primaryKey`; object-store cursors use `key` for both.
      results.push(keysOnly
        ? (source === store ? cursor.key : cursor.primaryKey)
        : cursor.value);
      cursor.continue();
    };
    request.onerror = () => reject(request.error);
  });
}

function deleteWhere(
  store: IDBObjectStore,
  indexName: string,
  value: IDBValidKey,
): Promise<number> {
  return new Promise((resolve, reject) => {
    const range = IDBKeyRange.only(value);
    const keys: IDBValidKey[] = [];
    const request = store.index(indexName).openKeyCursor(range);
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        deleteKeys(store, keys, resolve, reject);
        return;
      }
      keys.push(cursor.primaryKey);
      cursor.continue();
    };
    request.onerror = () => reject(request.error);
  });
}

function deleteKeys(
  store: IDBObjectStore,
  keys: readonly IDBValidKey[],
  resolve: (deleted: number) => void,
  reject: (error: unknown) => void,
): void {
  let index = 0;
  const next = () => {
    if (index >= keys.length) {
      resolve(keys.length);
      return;
    }
    const key = keys[index];
    index += 1;
    const request = store.delete(key);
    request.onsuccess = () => next();
    request.onerror = () => reject(request.error);
  };
  next();
}

function transactionCompletion(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
    tx.onerror = () => {
      // Individual request failures reject their own operations; the
      // transaction-level error only matters when it aborts (onabort).
    };
  });
}

function primaryKeyOf(record: unknown, schema: IndexedDbTableSchema): IDBValidKey | undefined {
  if (!record || typeof record !== 'object') return undefined;
  const key = (record as Record<string, unknown>)[schema.primKey.keyPath];
  return key as IDBValidKey | undefined;
}

function toTableSchema(schema: ParsedDexieSchema): IndexedDbTableSchema {
  return {
    primKey: {
      name: schema.keyPath,
      keyPath: schema.keyPath,
      auto: schema.autoIncrement,
      unique: true,
    },
    indexes: schema.indexes.map((index) => ({
      name: index.name,
      keyPath: index.keyPath,
      unique: index.unique,
      multiEntry: index.multiEntry,
    })),
  };
}
