export const PROJECT_V1_STATE = {
  schemaVersion: 1,
  projects: [{
    id: 'project-v1',
    name: 'Historical project',
    description: 'Released project v1 data',
    instructions: 'Preserve the original project instructions.',
    source: {
      kind: 'github',
      label: 'example/project',
      url: 'https://github.com/example/project',
      owner: 'example',
      repo: 'project',
      ref: 'main',
      importedAt: 300,
    },
    createdAt: 300,
    updatedAt: 310,
  }],
  files: [{
    id: 'file-v1',
    projectId: 'project-v1',
    path: 'README.md',
    content: '# Historical project',
    sizeBytes: 20,
    sourceKind: 'github',
    createdAt: 305,
  }],
  activeProjectId: 'project-v1',
  activeFileIds: ['file-v1'],
} as const;

export const PROJECT_V2_STATE = {
  schemaVersion: 2,
  projects: [{
    id: 'project-v2',
    name: 'Conversation project',
    description: 'Released project v2 data',
    instructions: 'Keep this conversation bound to the project.',
    createdAt: 400,
    updatedAt: 410,
  }],
  conversations: [{
    conversationId: 'conversation-v2',
    projectId: 'project-v2',
    title: 'Compatibility discussion',
    url: 'https://chat.deepseek.com/a/chat/s/conversation-v2',
    addedAt: 420,
    lastSeenAt: 430,
  }],
  pendingProjectId: 'project-v2',
} as const;

export const PROJECT_V1_MIGRATION_REQUIREMENT = {
  name: 'released project v1 state is silently reset to empty v2 state',
  input: PROJECT_V1_STATE,
  currentOutput: {
    schemaVersion: 2,
    projects: [],
    conversations: [],
    pendingProjectId: null,
  },
  classification: 'current-data-loss-gap',
  target: 'migrate-v1-without-overwrite-after-T3.3',
} as const;
