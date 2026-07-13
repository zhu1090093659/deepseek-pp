import type { ScenarioConfig } from '../types';

export const SCENARIO_STORAGE_KEY = 'scenarioConfigs';

const BUILT_IN_SCENARIOS: ScenarioConfig[] = [
  { id: 'summarize', label: '总结', template: '请用简洁的语言总结以下内容：\n\n{text}', builtIn: true, enabled: true },
  { id: 'explain', label: '解释', template: '请解释以下内容：\n\n{text}', builtIn: true, enabled: true },
  { id: 'translate', label: '翻译', template: '请将以下内容翻译成中文：\n\n{text}', builtIn: true, enabled: true },
];

export function getDefaultScenarios(): ScenarioConfig[] {
  return BUILT_IN_SCENARIOS.map((s) => ({ ...s }));
}

export async function getAllScenarios(): Promise<ScenarioConfig[]> {
  try {
    const data = await chrome.storage.local.get(SCENARIO_STORAGE_KEY);
    const custom = (data[SCENARIO_STORAGE_KEY] as ScenarioConfig[] | undefined) ?? [];
    return [
      ...BUILT_IN_SCENARIOS.map((s) => {
        const saved = custom.find((c) => c.id === s.id);
        if (saved) return { ...s, enabled: saved.enabled, template: saved.template };
        return { ...s };
      }),
      ...custom.filter((c) => !BUILT_IN_SCENARIOS.some((b) => b.id === c.id)),
    ];
  } catch {
    return getDefaultScenarios();
  }
}

export async function saveScenario(config: ScenarioConfig): Promise<void> {
  const all = await getAllScenarios();
  const idx = all.findIndex((s) => s.id === config.id);
  if (idx >= 0) {
    all[idx] = config;
  } else {
    all.push(config);
  }
  await saveAllScenarios(all);
}

export async function deleteScenario(id: string): Promise<void> {
  if (BUILT_IN_SCENARIOS.some((s) => s.id === id)) return; // cannot delete built-in
  const all = await getAllScenarios();
  await saveAllScenarios(all.filter((s) => s.id !== id));
}

export async function addCustomScenario(label: string, template: string): Promise<ScenarioConfig> {
  const config: ScenarioConfig = {
    id: `custom_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    label,
    template,
    builtIn: false,
    enabled: true,
  };
  const all = await getAllScenarios();
  all.push(config);
  await saveAllScenarios(all);
  return config;
}

export function buildContextMenuLabel(scenario: ScenarioConfig): string {
  return scenario.label;
}

async function saveAllScenarios(scenarios: ScenarioConfig[]): Promise<void> {
  await chrome.storage.local.set({ [SCENARIO_STORAGE_KEY]: scenarios });
}

export function applyScenarioTemplate(template: string, selectedText: string): string {
  return template.replace('{text}', selectedText);
}
