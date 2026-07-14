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

export const PROJECT_V1_MIGRATED_STATE = {
  ...PROJECT_V1_STATE,
  schemaVersion: 2,
  conversations: [],
  pendingProjectId: null,
} as const;

export const PROJECT_V1_EMPTY_OPTIONAL_SOURCE_STATE = {
  schemaVersion: 1,
  projects: [{
    id: 'project-empty-source',
    name: 'Manual project',
    description: '',
    instructions: '',
    source: {
      kind: 'manual',
      label: 'Manual project',
      url: '',
      owner: '',
      repo: '',
      ref: '',
      importedAt: 320,
    },
    createdAt: 320,
    updatedAt: 320,
  }],
  files: [],
  activeProjectId: 'project-empty-source',
  activeFileIds: [],
} as const;

export const PROJECT_REJECTED_STATES = {
  future: {
    schemaVersion: 3,
    projects: PROJECT_V2_STATE.projects,
    conversations: PROJECT_V2_STATE.conversations,
    pendingProjectId: PROJECT_V2_STATE.pendingProjectId,
    futureField: 'preserve-me',
  },
  corrupt: {
    schemaVersion: 2,
    projects: 'not-an-array',
    conversations: [],
    pendingProjectId: null,
  },
} as const;
