import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToolProviderRegistry } from '../core/tool/provider-registry';
import { getMcpToolDescriptors, refreshMcpServerDiscovery } from '../core/mcp/discovery';
import {
  createMcpServer,
  getAllMcpServers,
  getMcpServerById,
  updateMcpServer,
} from '../core/mcp/store';
import {
  decodeMcpStorageState,
  encodeMcpStorageState,
  MCP_STORAGE_KEY,
  McpStorageContractError,
} from '../core/mcp/storage-codec';
import {
  MCP_SERVER_IDS,
  MCP_STORAGE_FORGED_CACHE_ANNOTATION,
  MCP_STORAGE_FORGED_CACHE_TRANSPORT,
  MCP_STORAGE_CORRUPT_SERVER,
  MCP_STORAGE_DUPLICATE_SERVER,
  MCP_STORAGE_FUTURE_ROOT,
  MCP_STORAGE_FUTURE_SERVER,
  MCP_STORAGE_FUTURE_TRANSPORT,
  MCP_STORAGE_ORPHAN_CACHE,
  MCP_STORAGE_V1,
  MCP_STORAGE_V1_ADDITIVE_ROOT,
  MCP_STORAGE_V1_COLLIDING_CACHE,
} from './fixtures/persistence-contract/mcp';

let storage: Record<string, unknown>;
let storageSet: ReturnType<typeof vi.fn>;
let storageRemove: ReturnType<typeof vi.fn>;
let randomUUID: ReturnType<typeof vi.fn>;
let fetchMock: ReturnType<typeof vi.fn>;
let connectNative: ReturnType<typeof vi.fn>;
let permissionContains: ReturnType<typeof vi.fn>;
let permissionRequest: ReturnType<typeof vi.fn>;

beforeEach(() => {
  storage = {};
  storageSet = vi.fn(async (values: Record<string, unknown>) => {
    storage = { ...storage, ...values };
  });
  storageRemove = vi.fn();
  randomUUID = vi.fn(() => 'new-contract-id');
  fetchMock = vi.fn();
  connectNative = vi.fn();
  permissionContains = vi.fn();
  permissionRequest = vi.fn();
  vi.stubGlobal('crypto', { randomUUID });
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: vi.fn(async (key: string) => Object.prototype.hasOwnProperty.call(storage, key)
          ? { [key]: storage[key] }
          : {}),
        set: storageSet,
        remove: storageRemove,
      },
    },
    permissions: {
      contains: permissionContains,
      request: permissionRequest,
    },
    runtime: { connectNative },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('MCP persisted-config contract', () => {
  it('decodes and encodes every released v1 transport without changing the record', () => {
    const raw = structuredClone(MCP_STORAGE_V1);

    expect(encodeMcpStorageState(decodeMcpStorageState(raw))).toEqual(raw);
    expect(raw).toEqual(MCP_STORAGE_V1);
  });

  it('accepts historical v1 cache collisions so the user can clear or refresh them', () => {
    const raw = structuredClone(MCP_STORAGE_V1_COLLIDING_CACHE);

    expect(encodeMcpStorageState(decodeMcpStorageState(raw))).toEqual(raw);
  });

  it('rejects a historical cache collision when it becomes an active catalog', async () => {
    const state = decodeMcpStorageState(structuredClone(MCP_STORAGE_V1_COLLIDING_CACHE));
    const registry = new ToolProviderRegistry([{
      registration: { kind: 'mcp' },
      async listTools() {
        return state.toolCaches[0].descriptors;
      },
      execute: vi.fn(),
    }]);

    await expect(registry.listTools({ locale: 'en', includeDisabled: true })).rejects.toMatchObject({
      code: 'tool_invocation_duplicate',
    });
  });

  it('preserves additive top-level fields through codec and store mutations', async () => {
    const raw = structuredClone(MCP_STORAGE_V1_ADDITIVE_ROOT);
    expect(encodeMcpStorageState(decodeMcpStorageState(raw))).toEqual(raw);
    storage[MCP_STORAGE_KEY] = raw;

    await updateMcpServer(MCP_SERVER_IDS.shell, { displayName: 'Additive field preserved' });

    expect(storage[MCP_STORAGE_KEY]).toMatchObject({
      additiveField: { preserve: true },
    });
  });

  it('treats a missing key as empty v1 without writing storage', async () => {
    await expect(getAllMcpServers()).resolves.toEqual([]);
    expect(storageSet).not.toHaveBeenCalled();
    expect(randomUUID).not.toHaveBeenCalled();
  });

  it.each([
    ['future root', MCP_STORAGE_FUTURE_ROOT, 'mcp_storage_version_unsupported'],
    ['future server', MCP_STORAGE_FUTURE_SERVER, 'mcp_storage_version_unsupported'],
    ['future transport', MCP_STORAGE_FUTURE_TRANSPORT, 'mcp_storage_transport_unsupported'],
    ['corrupt server', MCP_STORAGE_CORRUPT_SERVER, 'mcp_storage_corrupt'],
    ['duplicate server', MCP_STORAGE_DUPLICATE_SERVER, 'mcp_storage_corrupt'],
    ['orphan cache', MCP_STORAGE_ORPHAN_CACHE, 'mcp_storage_corrupt'],
    ['forged cache annotation', MCP_STORAGE_FORGED_CACHE_ANNOTATION, 'mcp_storage_corrupt'],
    ['forged cache transport', MCP_STORAGE_FORGED_CACHE_TRANSPORT, 'mcp_storage_corrupt'],
  ])('rejects %s before mutation and preserves the raw record', async (_name, fixture, code) => {
    const raw = structuredClone(fixture);
    const originalJson = JSON.stringify(raw);
    storage[MCP_STORAGE_KEY] = raw;

    const first = createMcpServer({
      displayName: 'Must not be created',
      transport: { kind: 'native_messaging', nativeHost: 'com.example.must_not_run' },
    });
    await expect(first).rejects.toEqual(expect.objectContaining({
      name: 'McpStorageContractError',
      code,
    }));
    await expect(getAllMcpServers()).rejects.toBeInstanceOf(McpStorageContractError);

    expect(JSON.stringify(storage[MCP_STORAGE_KEY])).toBe(originalJson);
    expect(storageSet).not.toHaveBeenCalled();
    expect(storageRemove).not.toHaveBeenCalled();
    expect(randomUUID).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(connectNative).not.toHaveBeenCalled();
    expect(permissionContains).not.toHaveBeenCalled();
    expect(permissionRequest).not.toHaveBeenCalled();
  });

  it('rejects corrupt persisted state before discovery or descriptor reads can perform provider I/O', async () => {
    storage[MCP_STORAGE_KEY] = structuredClone(MCP_STORAGE_FUTURE_TRANSPORT);

    await expect(getMcpToolDescriptors()).rejects.toMatchObject({
      code: 'mcp_storage_transport_unsupported',
    });
    await expect(refreshMcpServerDiscovery(MCP_SERVER_IDS.http)).rejects.toMatchObject({
      code: 'mcp_storage_transport_unsupported',
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(connectNative).not.toHaveBeenCalled();
    expect(permissionContains).not.toHaveBeenCalled();
    expect(permissionRequest).not.toHaveBeenCalled();
    expect(storageSet).not.toHaveBeenCalled();
  });

  it('preserves server and secret identities through redacted updates', async () => {
    storage[MCP_STORAGE_KEY] = structuredClone(MCP_STORAGE_V1);
    const before = await getMcpServerById(MCP_SERVER_IDS.shell, { includeSecrets: true });
    const redacted = await getMcpServerById(MCP_SERVER_IDS.shell);

    expect(redacted?.secrets).toEqual([
      expect.objectContaining({ id: 'secret-contract-shell', value: '********' }),
    ]);
    await updateMcpServer(MCP_SERVER_IDS.shell, {
      displayName: 'Renamed Shell',
      secrets: redacted?.secrets,
    });
    const after = await getMcpServerById(MCP_SERVER_IDS.shell, { includeSecrets: true });

    expect(after).toMatchObject({
      id: before?.id,
      displayName: 'Renamed Shell',
      secrets: [{ id: 'secret-contract-shell', value: 'contract-secret-value' }],
    });
    expect(randomUUID).not.toHaveBeenCalled();
    expect(decodeMcpStorageState(storage[MCP_STORAGE_KEY])).toEqual(storage[MCP_STORAGE_KEY]);
  });
});
