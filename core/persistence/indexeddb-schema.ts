/**
 * Translation of dexie schema strings onto IndexedDB object-store terms.
 *
 * A dexie schema string declares the in-line primary key first, then
 * single-field indexes: `'++id, type, name'` (auto-increment primary key
 * `id` plus `type`/`name` indexes), `'&id'` (unique in-line primary key),
 * `'id, createdAt'` (plain in-line primary key — IDB primary keys are
 * unique by definition — plus a `createdAt` index). `&` and `*` prefixes
 * on index tokens mean unique and multi-entry respectively.
 */
export interface ParsedDexieIndex {
  name: string;
  keyPath: string;
  unique: boolean;
  multiEntry: boolean;
}

export interface ParsedDexieSchema {
  keyPath: string;
  autoIncrement: boolean;
  indexes: ParsedDexieIndex[];
}

export function parseDexieSchema(schema: string): ParsedDexieSchema {
  const tokens = schema
    .split(',')
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
  if (tokens.length === 0) throw new Error('Empty IndexedDB schema string');
  const [first, ...rest] = tokens;

  let keyPath: string;
  let autoIncrement: boolean;
  if (first.startsWith('++')) {
    keyPath = first.slice(2);
    autoIncrement = true;
  } else if (first.startsWith('&')) {
    keyPath = first.slice(1);
    autoIncrement = false;
  } else {
    keyPath = first;
    autoIncrement = false;
  }
  if (keyPath.length === 0) throw new Error('IndexedDB schema primary key is empty');

  const indexes: ParsedDexieIndex[] = rest.map((token) => {
    let name = token;
    let unique = false;
    let multiEntry = false;
    if (name.startsWith('&')) {
      unique = true;
      name = name.slice(1);
    }
    if (name.startsWith('*')) {
      multiEntry = true;
      name = name.slice(1);
    }
    if (name.length === 0) throw new Error('IndexedDB schema index name is empty');
    return { name, keyPath: name, unique, multiEntry };
  });

  return { keyPath, autoIncrement, indexes };
}
