import Dexie, { type EntityTable } from 'dexie';
import type { Memory, NewMemory } from '../types';

const db = new Dexie('DeepSeekPP') as Dexie & {
  memories: EntityTable<Memory, 'id'>;
};

db.version(1).stores({
  memories: '++id, type, name, pinned, createdAt, updatedAt, lastAccessedAt',
});

db.version(2)
  .stores({
    memories: '++id, type, name, pinned, createdAt, updatedAt, lastAccessedAt, syncId',
  })
  .upgrade((tx) => {
    return tx
      .table('memories')
      .toCollection()
      .modify((memory: Record<string, unknown>) => {
        memory.syncId = crypto.randomUUID();
      });
  });

db.version(3)
  .stores({
    memories: '++id, type, name, pinned, createdAt, updatedAt, lastAccessedAt, syncId, scope, projectId',
  })
  .upgrade((tx) => {
    return tx
      .table('memories')
      .toCollection()
      .modify((memory: Record<string, unknown>) => {
        memory.scope = 'global';
        delete memory.projectId;
      });
  });

export async function getAllMemories(): Promise<Memory[]> {
  return (await db.memories.toArray()).map(normalizeMemory);
}

export async function getMemoryById(id: number): Promise<Memory | undefined> {
  const memory = await db.memories.get(id);
  return memory ? normalizeMemory(memory) : undefined;
}

export async function saveMemory(
  mem: NewMemory,
): Promise<number> {
  const now = Date.now();
  const id = await db.memories.add({
    ...mem,
    ...normalizeMemoryScope(mem),
    syncId: mem.syncId ?? crypto.randomUUID(),
    createdAt: now,
    updatedAt: now,
    accessCount: 0,
    lastAccessedAt: now,
  } as Memory);
  return id as number;
}

export async function updateMemory(mem: Memory): Promise<void> {
  if (mem.id == null) return;
  await db.memories.update(mem.id, { ...mem, ...normalizeMemoryScope(mem), updatedAt: Date.now() });
}

export async function deleteMemory(id: number): Promise<void> {
  await db.memories.delete(id);
}

export async function touchMemories(ids: number[]): Promise<void> {
  const now = Date.now();
  await db.memories
    .where('id')
    .anyOf(ids)
    .modify((m) => {
      m.accessCount++;
      m.lastAccessedAt = now;
    });
}

export async function replaceAllMemories(memories: Omit<Memory, 'id'>[]): Promise<void> {
  await db.transaction('rw', db.memories, async () => {
    await db.memories.clear();
    await db.memories.bulkAdd(memories.map((memory) => ({
      ...memory,
      ...normalizeMemoryScope(memory),
    })) as Memory[]);
  });
}

const STALE_THRESHOLD_DAYS = 90;
const MIN_ACCESS_FOR_RETENTION = 3;

export async function archiveStaleMemories(): Promise<number> {
  const threshold = Date.now() - STALE_THRESHOLD_DAYS * 86_400_000;
  const stale = await db.memories
    .where('lastAccessedAt')
    .below(threshold)
    .filter((m) => !m.pinned && m.accessCount < MIN_ACCESS_FOR_RETENTION)
    .toArray();

  if (stale.length === 0) return 0;

  const ids = stale.map((m) => m.id).filter((id): id is number => id != null);
  await db.memories.bulkDelete(ids);
  return ids.length;
}

export { db };

function normalizeMemory(memory: Memory): Memory {
  return {
    ...memory,
    ...normalizeMemoryScope(memory),
  };
}

function normalizeMemoryScope(memory: Pick<NewMemory, 'scope' | 'projectId'>): Pick<Memory, 'scope' | 'projectId'> {
  if (memory.scope === 'project') {
    const projectId = typeof memory.projectId === 'string' ? memory.projectId.trim() : '';
    if (projectId) return { scope: 'project', projectId };
  }
  return { scope: 'global', projectId: undefined };
}
