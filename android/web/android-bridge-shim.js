(function () {
  const bridge = window.AndroidBridge;
  if (!bridge || typeof bridge.postMessage !== "function") return;

  const PROTOCOL = "deepseek-pp-android-bridge";
  const VERSION = 1;
  const INSTALLED_MARKER = "__deepseekPlusPlusAndroidBridgeV1";
  const RESPONSE_TIMEOUT_MS = 10_000;
  if (bridge[INSTALLED_MARKER] === true) return;
  const pending = new Map();
  let nextRequestId = 0;

  function failPending(error) {
    for (const entry of pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(error);
    }
    pending.clear();
  }

  function parseResponse(event) {
    let response;
    try {
      response = JSON.parse(String(event && event.data));
    } catch (_error) {
      failPending(new Error("android_bridge_invalid_response"));
      return;
    }
    if (!response ||
      response.protocol !== PROTOCOL ||
      response.version !== VERSION ||
      typeof response.id !== "string" ||
      typeof response.ok !== "boolean"
    ) {
      failPending(new Error("android_bridge_invalid_response"));
      return;
    }

    const entry = pending.get(response.id);
    if (!entry) return;
    pending.delete(response.id);
    clearTimeout(entry.timer);
    if (response.ok) {
      if (!Object.prototype.hasOwnProperty.call(response, "result")) {
        entry.reject(new Error("android_bridge_invalid_response"));
        return;
      }
      entry.resolve(response.result);
      return;
    }
    const code = response.error && typeof response.error.code === "string"
      ? response.error.code
      : "android_bridge_request_failed";
    entry.reject(new Error(code));
  }

  bridge.onmessage = parseResponse;

  function invoke(command, payload) {
    const id = `android:${++nextRequestId}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error("android_bridge_response_timeout"));
      }, RESPONSE_TIMEOUT_MS);
      pending.set(id, { resolve, reject, timer });
      try {
        bridge.postMessage(JSON.stringify({
          protocol: PROTOCOL,
          version: VERSION,
          id,
          command,
          payload,
        }));
      } catch (_error) {
        clearTimeout(timer);
        pending.delete(id);
        reject(new Error("android_bridge_transport_failed"));
      }
    });
  }

  function normalizeAssetPath(path) {
    return String(path || "")
      .replace(/\\/g, "/")
      .split("/")
      .filter((segment) => segment && segment !== "." && segment !== "..")
      .join("/");
  }

  const runtimeListeners = new Set();
  const runtime = {
    id: "deepseek-pp-android",
    getURL(path) {
      return `file:///android_asset/dpp/${normalizeAssetPath(path)}`;
    },
    async sendMessage(message) {
      return invoke("runtime.sendMessage", { message: message || {} });
    },
    onMessage: {
      addListener(listener) {
        runtimeListeners.add(listener);
      },
      removeListener(listener) {
        runtimeListeners.delete(listener);
      },
    },
  };

  function normalizeStorageKeys(input) {
    if (typeof input === "string") return [input];
    if (Array.isArray(input)) return input.map(String);
    if (input && typeof input === "object") return Object.keys(input);
    return [];
  }

  const storage = {
    local: {
      async get(input) {
        const keys = normalizeStorageKeys(input);
        const result = await invoke("storage.get", { keys });
        const values = result && typeof result.values === "object" && result.values
          ? result.values
          : {};
        if (!input || Array.isArray(input) || typeof input === "string") return values;
        return Object.fromEntries(Object.entries(input).map(([key, fallback]) => [
          key,
          Object.prototype.hasOwnProperty.call(values, key) ? values[key] : fallback,
        ]));
      },
      async set(values) {
        await invoke("storage.set", { values: values || {} });
      },
      async remove(input) {
        await invoke("storage.remove", { keys: normalizeStorageKeys(input) });
      },
    },
    onChanged: {
      addListener() {},
      removeListener() {},
    },
  };

  window.chrome = window.chrome || {};
  window.chrome.runtime = window.chrome.runtime || runtime;
  window.chrome.storage = window.chrome.storage || storage;
  bridge[INSTALLED_MARKER] = true;
})();
