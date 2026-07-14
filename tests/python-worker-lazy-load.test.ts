import { beforeEach, describe, expect, it, vi } from 'vitest';

const pyodide = vi.hoisted(() => ({
  load: vi.fn(),
  runtime: {
    setStdin: vi.fn(),
    setStdout: vi.fn(),
    setStderr: vi.fn(),
    globals: { set: vi.fn() },
    runPythonAsync: vi.fn(async () => 42),
  },
}));

vi.mock('pyodide', () => ({
  loadPyodide: pyodide.load,
}));

import '../core/sandbox/python-worker';

describe('Python worker lazy loading', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pyodide.load.mockResolvedValue(pyodide.runtime);
    vi.stubGlobal('postMessage', vi.fn());
  });

  it('does not initialize Pyodide before the first Python request and reuses it afterwards', async () => {
    expect(pyodide.load).not.toHaveBeenCalled();

    await dispatchPython('print(21)');

    expect(pyodide.load).toHaveBeenCalledTimes(1);
    expect(pyodide.load).toHaveBeenCalledWith({
      indexURL: 'chrome-extension://contract/pyodide/',
      packageBaseUrl: 'chrome-extension://contract/pyodide/',
    });
    expect(postMessage).toHaveBeenLastCalledWith({
      ok: true,
      stdout: '',
      stderr: '',
      result: '42',
      truncated: false,
    });

    await dispatchPython('print(42)');

    expect(pyodide.load).toHaveBeenCalledTimes(1);
    expect(pyodide.runtime.runPythonAsync).toHaveBeenCalledTimes(2);
  });
});

async function dispatchPython(code: string): Promise<void> {
  if (!self.onmessage) throw new Error('Python worker message handler is unavailable');
  await self.onmessage.call(self, new MessageEvent('message', {
    data: {
      code,
      outputLimit: 12_000,
      pyodideBaseUrl: 'chrome-extension://contract/pyodide/',
    },
  }));
}
