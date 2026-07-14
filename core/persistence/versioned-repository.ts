import { withSyncLocalStateLock } from './local-state-lock';

export type RawStorageSlot =
  | { readonly present: false }
  | { readonly present: true; readonly value: unknown };

export interface StorageSlotPort {
  read(): Promise<RawStorageSlot>;
  write(value: unknown): Promise<void>;
  remove(): Promise<void>;
}

export interface VersionedValueCodec<T> {
  decode(value: unknown, path: string): T;
  encode(value: T): unknown;
}

export interface VersionedRepository<T> {
  read(): Promise<T>;
  readAlreadyLocked(): Promise<T>;
  replaceAlreadyLocked(value: T): Promise<void>;
  writeAfterReadAlreadyLocked(value: T): Promise<void>;
}

export interface VersionedRepositoryOptions<T> {
  label: string;
  createDefault(): T;
  codec: VersionedValueCodec<T>;
  storage: StorageSlotPort;
}

export function createChromeStorageSlot(key: string): StorageSlotPort {
  return {
    async read() {
      const values = await chrome.storage.local.get(key) as Record<string, unknown>;
      if (!Object.prototype.hasOwnProperty.call(values, key) || values[key] === undefined) {
        return { present: false };
      }
      return { present: true, value: values[key] };
    },
    async write(value) {
      await chrome.storage.local.set({ [key]: value });
    },
    async remove() {
      await chrome.storage.local.remove(key);
    },
  };
}

export function createVersionedRepository<T>(
  options: VersionedRepositoryOptions<T>,
): VersionedRepository<T> {
  const readAlreadyLocked = async (): Promise<T> => {
    const raw = await options.storage.read();
    return raw.present
      ? options.codec.decode(raw.value, options.label)
      : options.createDefault();
  };

  const writeAfterReadAlreadyLocked = async (value: T): Promise<void> => {
    await options.storage.write(options.codec.encode(value));
  };

  return {
    read() {
      return withSyncLocalStateLock(readAlreadyLocked);
    },
    readAlreadyLocked,
    async replaceAlreadyLocked(value) {
      // A replacement is allowed only after the current raw value has been
      // decoded successfully. Sync apply can therefore replace legal legacy
      // state, but never overwrite an unsupported future/corrupt value.
      await readAlreadyLocked();
      await writeAfterReadAlreadyLocked(value);
    },
    writeAfterReadAlreadyLocked,
  };
}
