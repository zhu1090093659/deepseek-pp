#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const failures = [];

const requiredFiles = [
  'core/automation/types.ts',
  'core/automation/store.ts',
  'core/automation/scheduler.ts',
  'core/automation/runner.ts',
  'core/inline-agent/types.ts',
  'core/inline-agent/loop.ts',
  'core/inline-agent/prompt.ts',
  'core/inline-agent/renderer.ts',
  'core/deepseek/adapter.ts',
  'core/messaging/schema.ts',
  'core/shell/index.ts',
  'core/shell/contracts.ts',
  'core/shell/policy.ts',
  'entrypoints/sidepanel/pages/AutomationPage.tsx',
  'scripts/shell-mcp-host.mjs',
  'scripts/install-shell-host.mjs',
  'packages/shell-host/package.json',
  'packages/shell-host/lib/installer.mjs',
  'packages/shell-host/native/shell-mcp-host.mjs',
];

const removedPaths = [
  'entrypoints/sidepanel/pages/AgentPage.tsx',
  ['assets/screenshot-sidepanel', 'agent.svg'].join('-'),
];

for (const file of requiredFiles) {
  if (!fs.existsSync(path.join(root, file))) {
    failures.push(`missing required automation file: ${file}`);
  }
}

for (const removed of removedPaths) {
  if (fs.existsSync(path.join(root, removed))) {
    failures.push(`obsolete Agent-named path still exists: ${removed}`);
  }
}

assertContains('entrypoints/sidepanel/App.tsx', "labelKey: 'app.tabs.capabilities'");
assertContains('entrypoints/sidepanel/App.tsx', "import('./pages/CapabilitiesPage')");
assertContains('entrypoints/sidepanel/pages/CapabilitiesPage.tsx', "labelKey: 'sidepanel.capabilitiesPage.tabs.automation'");
assertContains('entrypoints/sidepanel/pages/CapabilitiesPage.tsx', "import AutomationPage from './AutomationPage'");
assertContains('entrypoints/sidepanel/pages/CapabilitiesPage.tsx', "sub === 'automation' && <AutomationPage />");
assertContains('entrypoints/sidepanel/pages/AutomationPage.tsx', 'export default function AutomationPage');
assertContains('core/automation/runner.ts', 'runDeepSeekAutomation');
assertContains('core/automation/scheduler.ts', 'runAutomation');
assertContains('wxt.config.ts', "'alarms'");
assertContains('entrypoints/background.ts', 'chrome.alarms.create');
assertContains('entrypoints/background.ts', 'chrome.alarms.onAlarm.addListener');
assertContains('entrypoints/background.ts', 'scanDueAutomations');
assertContains('entrypoints/background.ts', "case 'CREATE_AUTOMATION'");
assertContains('entrypoints/background.ts', "case 'RUN_AUTOMATION_NOW'");
assertContains('entrypoints/content.ts', 'runInlineAgentLoop');
assertContains('entrypoints/content.ts', 'const BRIDGE_INIT_TYPE = BRIDGE_HANDSHAKE_TYPES.init');
assertContains('entrypoints/content.ts', 'restorePersistedInlineAgentTraces');
assertContains('entrypoints/main-world.content.ts', 'requestAugmentedBody');
assertContains('entrypoints/main-world.content.ts', 'const BRIDGE_REQUEST_TYPE = BRIDGE_HANDSHAKE_TYPES.request');
assertNotContains('entrypoints/main-world.content.ts', 'EXECUTE_TOOL_CALL');
assertContains('core/messaging/schema.ts', "request: 'DPP_BRIDGE_REQUEST'");
assertContains('core/messaging/schema.ts', "init: 'DPP_BRIDGE_INIT'");
assertContains('core/inline-agent/loop.ts', 'INLINE_AGENT_MAX_STEPS');
assertContains('core/inline-agent/prompt.ts', 'buildContinuationPrompt');
assertContains('core/inline-agent/renderer.ts', 'createAgentStepElement');
assertContains('core/deepseek/adapter.ts', 'BYPASS_HOOK_HEADER');
assertContains('core/shell/index.ts', 'createShellMcpPresetInput');
assertContains('scripts/shell-mcp-host.mjs', '../packages/shell-host/native/shell-mcp-host.mjs');
assertContains('scripts/install-shell-host.mjs', '../packages/shell-host/lib/installer.mjs');
assertContains('packages/shell-host/package.json', 'deepseek-pp-shell-host');
assertContains('packages/shell-host/native/shell-mcp-host.mjs', 'shell_exec');
assertContains('packages/shell-host/native/shell-mcp-host.mjs', 'readWindowsUserMachinePathDirs');
assertContains('packages/shell-host/native/shell-mcp-host.mjs', 'WINDOWS_POWERSHELL_UTF8_PREAMBLE');
assertContains('packages/shell-host/native/shell-mcp-host.mjs', 'getExplicitPathOverride');
assertContains('packages/shell-host/native/shell-mcp-host.mjs', 'windowsVersion');
assertContains('packages/shell-host/lib/installer.mjs', 'OFFICECLI_REQUIRED_HELP_PATTERNS');
assertContains('.github/workflows/release.yml', 'npm publish --workspace packages/shell-host --access public');
assertContains('.github/workflows/release.yml', 'NPM_TOKEN secret is required');
assertNotContains('README.md', ['Agent', '任务'].join(' '));
assertNotContains('README.md', ['screenshot-sidepanel', 'agent.svg'].join('-'));

if (failures.length > 0) {
  console.error('Automation contract smoke failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('Automation contract smoke passed');

function assertContains(file, fragment) {
  if (!readText(file).includes(fragment)) {
    failures.push(`${file} does not contain required fragment: ${fragment}`);
  }
}

function assertNotContains(file, fragment) {
  if (readText(file).includes(fragment)) {
    failures.push(`${file} contains forbidden fragment: ${fragment}`);
  }
}

function readText(file) {
  const absolute = path.join(root, file);
  return fs.existsSync(absolute) ? fs.readFileSync(absolute, 'utf8') : '';
}
