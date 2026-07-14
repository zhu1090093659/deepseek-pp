import {
  definePayloadlessRuntimeCommandHandler,
  type RuntimeCommandHandler,
} from '../../core/messaging/runtime-command-registry';
import type {
  HostPermissionResponse,
  WebSearchDiagnostics,
} from '../../core/messaging/tool-runtime-contracts';
import type {
  BrowserControlSettings,
  BrowserControlState,
  BrowserControlTarget,
} from '../../core/browser-control/types';
import type { WebSearchToolName } from '../../core/tool/web-search';
import type { WebToolSettings } from '../../core/tool/web-settings';
import { defineToolPayloadRuntimeCommandHandler } from './runtime-handler';

const WEB_SEARCH_DIAGNOSTIC_DOMAINS = ['cn.bing.com', 'www.bing.com'] as const;
const WEB_SEARCH_DIAGNOSTIC_TIMEOUT_MS = 10_000;
const WEB_SEARCH_DIAGNOSTIC_PREVIEW_LENGTH = 200;
const WEB_SEARCH_DIAGNOSTIC_ERROR_LENGTH = 150;

export interface BrowserToolRuntimeHandlerDependencies {
  getWebToolSettings(): Promise<WebToolSettings>;
  setWebToolEnabled(name: WebSearchToolName, enabled: boolean): Promise<void>;
  getBrowserControlSettings(): Promise<BrowserControlSettings>;
  saveBrowserControlSettings(
    patch: Partial<BrowserControlSettings>,
  ): Promise<BrowserControlSettings>;
  setBrowserControlEnabled(enabled: boolean): Promise<BrowserControlSettings>;
  getBrowserControlState(): Promise<BrowserControlState>;
  setBrowserControlTarget(tabId: number): Promise<BrowserControlTarget>;
  detachBrowserControl(): Promise<void>;
  requestHostPermission(origins: string[]): Promise<boolean>;
  fetch(input: string, init: RequestInit): Promise<Pick<Response, 'status' | 'text'>>;
  broadcastToolDescriptorsUpdate(excludeTabId?: number): Promise<void>;
  broadcastBrowserControlUpdate(excludeTabId?: number): Promise<void>;
}

export function createBrowserToolRuntimeHandlers(
  dependencies: BrowserToolRuntimeHandlerDependencies,
): readonly RuntimeCommandHandler[] {
  return Object.freeze([
    definePayloadlessRuntimeCommandHandler('GET_WEB_TOOL_SETTINGS', () => (
      dependencies.getWebToolSettings()
    )),
    defineToolPayloadRuntimeCommandHandler('SET_WEB_TOOL_SETTING', async (payload, context) => {
      await dependencies.setWebToolEnabled(payload.name, payload.enabled);
      await dependencies.broadcastToolDescriptorsUpdate(context.tabId);
      return { ok: true as const };
    }),
    definePayloadlessRuntimeCommandHandler('GET_BROWSER_CONTROL_SETTINGS', () => (
      dependencies.getBrowserControlSettings()
    )),
    defineToolPayloadRuntimeCommandHandler('SAVE_BROWSER_CONTROL_SETTINGS', async (payload, context) => {
      const settings = await dependencies.saveBrowserControlSettings(payload ?? {});
      await dependencies.broadcastToolDescriptorsUpdate(context.tabId);
      await dependencies.broadcastBrowserControlUpdate(context.tabId);
      return settings;
    }),
    defineToolPayloadRuntimeCommandHandler('SET_BROWSER_CONTROL_ENABLED', async (payload, context) => {
      const settings = await dependencies.setBrowserControlEnabled(payload.enabled);
      if (!payload.enabled) await dependencies.detachBrowserControl();
      await dependencies.broadcastToolDescriptorsUpdate(context.tabId);
      await dependencies.broadcastBrowserControlUpdate(context.tabId);
      return settings;
    }),
    definePayloadlessRuntimeCommandHandler('GET_BROWSER_CONTROL_STATE', () => (
      dependencies.getBrowserControlState()
    )),
    defineToolPayloadRuntimeCommandHandler('SET_BROWSER_CONTROL_TARGET', async (payload, context) => {
      const target = await dependencies.setBrowserControlTarget(payload.tabId);
      await dependencies.broadcastBrowserControlUpdate(context.tabId);
      return { ok: true as const, target };
    }),
    definePayloadlessRuntimeCommandHandler('DETACH_BROWSER_CONTROL', async (context) => {
      await dependencies.detachBrowserControl();
      await dependencies.broadcastBrowserControlUpdate(context.tabId);
      return { ok: true as const };
    }),
    defineToolPayloadRuntimeCommandHandler('DIAGNOSE_WEB_SEARCH', (payload) => (
      diagnoseWebSearch(payload?.query ?? 'test', dependencies.fetch)
    )),
    defineToolPayloadRuntimeCommandHandler('REQUEST_HOST_PERMISSION', async (payload) => {
      if (payload.origins.length === 0) {
        return { ok: false as const, error: 'no_origins' };
      }
      let permissionRequest: Promise<boolean>;
      try {
        permissionRequest = dependencies.requestHostPermission(payload.origins);
      } catch (error) {
        return hostPermissionFailure(error);
      }
      // Released behavior treats a rejected permissions Promise exactly like a
      // user denial. A synchronous API invocation failure remains explicit.
      const granted = await permissionRequest.catch(() => false);
      return { ok: granted, origins: payload.origins };
    }),
  ]);
}

async function diagnoseWebSearch(
  query: string,
  fetchDiagnostic: BrowserToolRuntimeHandlerDependencies['fetch'],
): Promise<WebSearchDiagnostics> {
  const diagnostics: WebSearchDiagnostics = {};
  for (const domain of WEB_SEARCH_DIAGNOSTIC_DOMAINS) {
    const url = `https://${domain}/search?q=${encodeURIComponent(query)}`;
    try {
      const response = await fetchDiagnostic(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept-Language': 'zh-CN,zh;q=0.9',
        },
        signal: AbortSignal.timeout(WEB_SEARCH_DIAGNOSTIC_TIMEOUT_MS),
      });
      const text = await response.text();
      diagnostics[domain] = {
        status: response.status,
        length: text.length,
        preview: text
          .replace(/<[^>]+>/g, '')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, WEB_SEARCH_DIAGNOSTIC_PREVIEW_LENGTH),
      };
    } catch (error) {
      diagnostics[domain] = {
        status: 0,
        length: 0,
        error: (error instanceof Error ? error.message : String(error))
          .slice(0, WEB_SEARCH_DIAGNOSTIC_ERROR_LENGTH),
      };
    }
  }
  return diagnostics;
}

function hostPermissionFailure(error: unknown): HostPermissionResponse {
  return {
    ok: false,
    error: error instanceof Error ? error.message : String(error),
  };
}
