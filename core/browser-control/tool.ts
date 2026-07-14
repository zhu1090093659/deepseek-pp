import { translate, type LocaleMessageKey, type SupportedLocale } from '../i18n';
import type { ToolCall, ToolDescriptor, ToolProviderIdentity, ToolResult } from '../tool/types';
import { getCurrentPlatformEnvironment, isCapabilitySupported } from '../platform';
import { getBrowserControlSettings } from './settings';
import { browserControlService } from './service';
import {
  BROWSER_CONTROL_PROVIDER,
  BROWSER_CONTROL_TOOL_NAMES,
  BROWSER_CONTROL_TOOL_SET,
  type BrowserControlState,
  type BrowserControlToolName,
} from './types';

export { browserControlService };
export {
  BROWSER_CONTROL_PROVIDER,
  BROWSER_CONTROL_TOOL_NAMES,
  type BrowserControlToolName,
} from './types';

const COPY_KEYS: Record<BrowserControlToolName, {
  title: LocaleMessageKey;
  description: LocaleMessageKey;
}> = {
  browser_navigate: {
    title: 'tool.browser.navigateTitle',
    description: 'tool.browser.navigateDescription',
  },
  browser_go_back: {
    title: 'tool.browser.goBackTitle',
    description: 'tool.browser.goBackDescription',
  },
  browser_go_forward: {
    title: 'tool.browser.goForwardTitle',
    description: 'tool.browser.goForwardDescription',
  },
  browser_refresh: {
    title: 'tool.browser.refreshTitle',
    description: 'tool.browser.refreshDescription',
  },
  browser_list_tabs: {
    title: 'tool.browser.listTabsTitle',
    description: 'tool.browser.listTabsDescription',
  },
  browser_select_tab: {
    title: 'tool.browser.selectTabTitle',
    description: 'tool.browser.selectTabDescription',
  },
  browser_close_tab: {
    title: 'tool.browser.closeTabTitle',
    description: 'tool.browser.closeTabDescription',
  },
  browser_snapshot: {
    title: 'tool.browser.snapshotTitle',
    description: 'tool.browser.snapshotDescription',
  },
  browser_click: {
    title: 'tool.browser.clickTitle',
    description: 'tool.browser.clickDescription',
  },
  browser_hover: {
    title: 'tool.browser.hoverTitle',
    description: 'tool.browser.hoverDescription',
  },
  browser_fill: {
    title: 'tool.browser.fillTitle',
    description: 'tool.browser.fillDescription',
  },
  browser_fill_form: {
    title: 'tool.browser.fillFormTitle',
    description: 'tool.browser.fillFormDescription',
  },
  browser_key: {
    title: 'tool.browser.keyTitle',
    description: 'tool.browser.keyDescription',
  },
  browser_type: {
    title: 'tool.browser.typeTitle',
    description: 'tool.browser.typeDescription',
  },
  browser_attach_file: {
    title: 'tool.browser.attachFileTitle',
    description: 'tool.browser.attachFileDescription',
  },
  browser_wait_for: {
    title: 'tool.browser.waitForTitle',
    description: 'tool.browser.waitForDescription',
  },
  browser_handle_dialog: {
    title: 'tool.browser.handleDialogTitle',
    description: 'tool.browser.handleDialogDescription',
  },
  browser_evaluate_script: {
    title: 'tool.browser.evaluateScriptTitle',
    description: 'tool.browser.evaluateScriptDescription',
  },
};

export function isBrowserControlToolName(name: string): name is BrowserControlToolName {
  return BROWSER_CONTROL_TOOL_SET.has(name);
}

export function createBrowserControlToolProviderIdentity(
  locale: SupportedLocale,
): ToolProviderIdentity {
  return {
    ...BROWSER_CONTROL_PROVIDER,
    displayName: translate(locale, 'tool.browser.providerName'),
  };
}

export function createBrowserControlToolDescriptors(
  locale: SupportedLocale,
): ToolDescriptor[] {
  const provider = createBrowserControlToolProviderIdentity(locale);
  return BROWSER_CONTROL_TOOL_NAMES.map((name) => ({
    id: `local:${BROWSER_CONTROL_PROVIDER.id}:${name}`,
    provider,
    name,
    invocationName: name,
    title: translate(locale, COPY_KEYS[name].title),
    description: translate(locale, COPY_KEYS[name].description),
    inputSchema: schemaForTool(name),
    execution: {
      mode: riskForTool(name) === 'high' ? 'manual' : 'auto',
      enabled: true,
      risk: riskForTool(name),
      timeoutMs: timeoutForTool(name),
      maxResultBytes: name === 'browser_snapshot' ? 40_000 : 60_000,
    },
    annotations: {
      requires: 'chrome.debugger,tabs',
      output: 'Text Accessibility Tree snapshot; tab group names are included only when the browser exposes them.',
    },
  }));
}

export async function shouldExposeBrowserControlTools(): Promise<boolean> {
  const environment = getCurrentPlatformEnvironment();
  if (!isCapabilitySupported(environment, 'browserControl')) return false;
  const settings = await getBrowserControlSettings();
  return settings.enabled;
}

export async function getBrowserControlState(): Promise<BrowserControlState> {
  return browserControlService.getState();
}

export async function executeBrowserControlToolCall(
  call: ToolCall,
  locale: SupportedLocale,
): Promise<ToolResult> {
  if (!isBrowserControlToolName(call.name)) {
    return {
      ok: false,
      name: call.name,
      provider: call.provider ?? createBrowserControlToolProviderIdentity(locale),
      summary: `Unsupported browser tool: ${call.name}`,
      error: {
        code: 'browser_tool_unsupported',
        message: `Unsupported browser tool: ${call.name}`,
        retryable: false,
      },
    };
  }

  const startedAt = Date.now();
  const result = await browserControlService.execute(call.name, call.payload);
  const completedAt = Date.now();
  return {
    ok: result.ok,
    name: call.name,
    provider: call.provider ?? createBrowserControlToolProviderIdentity(locale),
    descriptorId: call.descriptorId,
    summary: result.summary,
    detail: result.detail,
    output: toToolJson(result.output),
    error: result.error,
    startedAt,
    completedAt,
    durationMs: completedAt - startedAt,
    truncated: result.snapshot?.truncated,
  };
}

function schemaForTool(name: BrowserControlToolName): ToolDescriptor['inputSchema'] {
  switch (name) {
    case 'browser_navigate':
      return objectSchema({
        url: { type: 'string', description: 'Absolute http(s) or file URL.' },
        newTab: {
          type: 'boolean',
          default: true,
          description: 'Open in a new tab by default. Set false only when intentionally replacing the current controlled tab.',
        },
      }, ['url']);
    case 'browser_select_tab':
      return objectSchema({
        tabId: { type: 'integer', description: 'Chrome tab id from browser_list_tabs.' },
      }, ['tabId']);
    case 'browser_close_tab':
      return objectSchema({
        tabId: { type: 'integer', description: 'Optional Chrome tab id. Defaults to current target.' },
      });
    case 'browser_click':
    case 'browser_hover':
      return objectSchema({
        uid: { type: 'string', description: 'Element id from browser_snapshot, e.g. e12.' },
        selector: { type: 'string', description: 'CSS selector alternative when uid is unavailable.' },
        button: { type: 'string', description: 'Mouse button: left, middle, or right.' },
        clickCount: { type: 'integer', description: 'Click count, usually 1.' },
      });
    case 'browser_fill':
      return objectSchema({
        uid: { type: 'string', description: 'Element id from browser_snapshot.' },
        selector: { type: 'string', description: 'CSS selector alternative.' },
        value: { type: 'string', description: 'Value to place in the field.' },
      }, ['value']);
    case 'browser_fill_form':
      return objectSchema({
        fields: {
          type: 'array',
          description: 'Array of { uid? or selector?, value } field updates.',
        },
      }, ['fields']);
    case 'browser_key':
      return objectSchema({
        uid: { type: 'string', description: 'Optional element id to focus first.' },
        selector: { type: 'string', description: 'Optional CSS selector to focus first.' },
        key: { type: 'string', description: 'Key name such as Enter, Escape, Tab, ArrowDown, or a character.' },
      }, ['key']);
    case 'browser_type':
      return objectSchema({
        uid: { type: 'string', description: 'Optional element id to focus first.' },
        selector: { type: 'string', description: 'Optional CSS selector to focus first.' },
        text: { type: 'string', description: 'Text to insert.' },
      }, ['text']);
    case 'browser_attach_file':
      return objectSchema({
        uid: { type: 'string', description: 'File input id from browser_snapshot.' },
        selector: { type: 'string', description: 'CSS selector for a file input.' },
        files: { type: 'array', description: 'Absolute local file paths.' },
      }, ['files']);
    case 'browser_wait_for':
      return objectSchema({
        selector: { type: 'string', description: 'Wait until this selector exists.' },
        text: { type: 'string', description: 'Wait until page text includes this value.' },
        expression: { type: 'string', description: 'Wait until this JavaScript expression is truthy.' },
        timeoutMs: { type: 'integer', description: 'Timeout in milliseconds.' },
      });
    case 'browser_handle_dialog':
      return objectSchema({
        accept: { type: 'boolean', description: 'Accept when true, dismiss when false.' },
        promptText: { type: 'string', description: 'Prompt text for prompt dialogs.' },
      });
    case 'browser_evaluate_script':
      return objectSchema({
        script: { type: 'string', description: 'JavaScript expression to evaluate.' },
        expression: { type: 'string', description: 'Alias for script.' },
        awaitPromise: { type: 'boolean', description: 'Await promise results. Defaults to true.' },
      });
    case 'browser_go_back':
    case 'browser_go_forward':
    case 'browser_refresh':
    case 'browser_list_tabs':
    case 'browser_snapshot':
      return objectSchema({});
  }
}

function objectSchema(
  properties: NonNullable<ToolDescriptor['inputSchema']['properties']>,
  required: string[] = [],
): ToolDescriptor['inputSchema'] {
  return {
    type: 'object',
    properties,
    required,
    additionalProperties: false,
  };
}

function riskForTool(name: BrowserControlToolName): ToolDescriptor['execution']['risk'] {
  if (name === 'browser_evaluate_script' || name === 'browser_close_tab' || name === 'browser_attach_file') {
    return 'high';
  }
  if (
    name === 'browser_navigate' ||
    name === 'browser_click' ||
    name === 'browser_fill' ||
    name === 'browser_fill_form' ||
    name === 'browser_key' ||
    name === 'browser_type' ||
    name === 'browser_handle_dialog'
  ) {
    return 'medium';
  }
  return 'low';
}

function timeoutForTool(name: BrowserControlToolName): number {
  if (name === 'browser_wait_for') return 65_000;
  if (name === 'browser_snapshot') return 15_000;
  if (name === 'browser_navigate') return 20_000;
  return 10_000;
}

function toToolJson(value: Record<string, unknown> | undefined): ToolResult['output'] {
  if (!value) return undefined;
  return JSON.parse(JSON.stringify(value)) as ToolResult['output'];
}
