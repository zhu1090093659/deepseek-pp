import type { ScenarioConfig } from '../types';
import { withSyncLocalStateLock } from '../persistence/local-state-lock';
import {
  createChromeStorageSlot,
  createVersionedRepository,
} from '../persistence/versioned-repository';
import { scenarioCodec } from './codec';

export const SCENARIO_STORAGE_KEY = 'scenarioConfigs';

const BUILT_IN_SCENARIOS: ScenarioConfig[] = [
  { id: 'summarize', label: '总结', template: '请用简洁的语言总结以下内容：\n\n{text}', builtIn: true, enabled: true },
  { id: 'explain', label: '解释', template: '请解释以下内容：\n\n{text}', builtIn: true, enabled: true },
  { id: 'translate', label: '翻译', template: '请将以下内容翻译成中文：\n\n{text}', builtIn: true, enabled: true },
];

const scenarioRepository = createVersionedRepository({
  label: 'scenarios',
  createDefault: getDefaultScenarios,
  codec: scenarioCodec,
  storage: createChromeStorageSlot(SCENARIO_STORAGE_KEY),
});

export function getDefaultScenarios(): ScenarioConfig[] {
  return BUILT_IN_SCENARIOS.map((s) => ({ ...s }));
}

export async function getAllScenarios(): Promise<ScenarioConfig[]> {
  return mergeSavedScenarios(await scenarioRepository.read());
}

export async function saveScenario(config: ScenarioConfig): Promise<void> {
  await withSyncLocalStateLock(async () => {
    const all = mergeSavedScenarios(await scenarioRepository.readAlreadyLocked());
    const idx = all.findIndex((s) => s.id === config.id);
    if (idx >= 0) all[idx] = { ...all[idx], ...config };
    else all.push(config);
    await scenarioRepository.writeAfterReadAlreadyLocked(all);
  });
}

export async function deleteScenario(id: string): Promise<void> {
  if (BUILT_IN_SCENARIOS.some((s) => s.id === id)) return; // cannot delete built-in
  await withSyncLocalStateLock(async () => {
    const all = mergeSavedScenarios(await scenarioRepository.readAlreadyLocked());
    await scenarioRepository.writeAfterReadAlreadyLocked(all.filter((s) => s.id !== id));
  });
}

export async function addCustomScenario(label: string, template: string): Promise<ScenarioConfig> {
  return withSyncLocalStateLock(async () => {
    const all = mergeSavedScenarios(await scenarioRepository.readAlreadyLocked());
    const config: ScenarioConfig = {
      id: `custom_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      label,
      template,
      builtIn: false,
      enabled: true,
    };
    all.push(config);
    await scenarioRepository.writeAfterReadAlreadyLocked(all);
    return config;
  });
}

export function buildContextMenuLabel(scenario: ScenarioConfig): string {
  return scenario.label;
}

export function applyScenarioTemplate(template: string, selectedText: string): string {
  return template.replace('{text}', selectedText);
}

function mergeSavedScenarios(savedScenarios: readonly ScenarioConfig[]): ScenarioConfig[] {
  return [
    ...BUILT_IN_SCENARIOS.map((scenario) => {
      const saved = savedScenarios.find((candidate) => candidate.id === scenario.id);
      return saved
        ? {
            ...saved,
            ...scenario,
            enabled: saved.enabled,
            template: saved.template,
          }
        : { ...scenario };
    }),
    ...savedScenarios.filter((scenario) => (
      !BUILT_IN_SCENARIOS.some((builtIn) => builtIn.id === scenario.id)
    )),
  ];
}
