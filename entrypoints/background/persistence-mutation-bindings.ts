import type {
  LocalStateMutationRunner,
  LocalStateMutationStage,
} from '../../core/persistence/local-state-mutation';
import type {
  GitHubSkillImportRequest,
  GitHubSkillImportResult,
  LocalSkillImportRequest,
  LocalSkillImportResponse,
  ToolCall,
  ToolResult,
} from '../../core/types';

export interface PersistenceMutationBindingDependencies {
  runLocalStateMutation<T>(stage: LocalStateMutationStage<T>): Promise<T>;
  stageDeleteSkillAlreadyLocked(name: string): Promise<() => Promise<void>>;
  stageDeleteSkillSourceAlreadyLocked(sourceId: string): Promise<() => Promise<void>>;
  stageDeletePresetAlreadyLocked(id: string): Promise<() => Promise<void>>;
  stageDeleteProjectContextAndMemoriesAlreadyLocked(
    projectId: string,
  ): Promise<() => Promise<number>>;
  importGitHubSkillSource(
    request: GitHubSkillImportRequest,
    runner: LocalStateMutationRunner,
  ): Promise<GitHubSkillImportResult>;
  importLocalSkillSource(
    request: LocalSkillImportRequest,
    dependencies: LocalStateMutationRunner & {
      executeToolCall(call: ToolCall): Promise<ToolResult>;
    },
  ): Promise<LocalSkillImportResponse>;
  updateGitHubSkillSource(
    sourceId: string,
    runner: LocalStateMutationRunner,
  ): Promise<GitHubSkillImportResult>;
  executeLocalSkillImporterToolCall(call: ToolCall): Promise<ToolResult>;
}

export interface PersistenceMutationBindings {
  deleteSkill(name: string): Promise<void>;
  importGitHubSkillSource(request: GitHubSkillImportRequest): Promise<GitHubSkillImportResult>;
  importLocalSkillSource(request: LocalSkillImportRequest): Promise<LocalSkillImportResponse>;
  updateGitHubSkillSource(sourceId: string): Promise<GitHubSkillImportResult>;
  deleteGitHubSkillSource(sourceId: string): Promise<void>;
  deletePreset(id: string): Promise<void>;
  deleteProjectContext(projectId: string): Promise<number>;
}

export function createPersistenceMutationBindings(
  dependencies: PersistenceMutationBindingDependencies,
): PersistenceMutationBindings {
  const runner: LocalStateMutationRunner = {
    runLocalStateMutation: dependencies.runLocalStateMutation,
  };

  return Object.freeze({
    deleteSkill: (name: string) => dependencies.runLocalStateMutation(
      () => dependencies.stageDeleteSkillAlreadyLocked(name),
    ),
    importGitHubSkillSource: (request: GitHubSkillImportRequest) => dependencies.importGitHubSkillSource(
      request,
      runner,
    ),
    importLocalSkillSource: (request: LocalSkillImportRequest) => dependencies.importLocalSkillSource(request, {
      ...runner,
      executeToolCall: dependencies.executeLocalSkillImporterToolCall,
    }),
    updateGitHubSkillSource: (sourceId: string) => dependencies.updateGitHubSkillSource(
      sourceId,
      runner,
    ),
    deleteGitHubSkillSource: (sourceId: string) => dependencies.runLocalStateMutation(
      () => dependencies.stageDeleteSkillSourceAlreadyLocked(sourceId),
    ),
    deletePreset: (id: string) => dependencies.runLocalStateMutation(
      () => dependencies.stageDeletePresetAlreadyLocked(id),
    ),
    deleteProjectContext: (projectId: string) => dependencies.runLocalStateMutation(
      () => dependencies.stageDeleteProjectContextAndMemoriesAlreadyLocked(projectId),
    ),
  });
}
