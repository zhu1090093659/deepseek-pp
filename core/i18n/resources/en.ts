import type { LocaleMessages } from './zh-CN';

export const en = {
  common: {
    add: 'Add',
    all: 'All',
    auto: 'Auto',
    cancel: 'Cancel',
    clear: 'Clear',
    close: 'Close',
    confirm: 'Confirm',
    delete: 'Delete',
    deactivate: 'Disable',
    disabled: 'Disabled',
    edit: 'Edit',
    enable: 'Enable',
    enabled: 'Enabled',
    error: 'Error',
    loading: 'Loading...',
    manual: 'Manual',
    none: 'None',
    open: 'Open',
    preview: 'Preview',
    refresh: 'Refresh',
    remove: 'Remove',
    save: 'Save',
    saveChanges: 'Save changes',
    search: 'Search',
    status: 'Status',
    success: 'Success',
    sync: 'Sync',
    test: 'Test',
    update: 'Update',
  },
  manifest: {
    name: 'DeepSeek++',
    description: 'Agentic memory, skills, execution, automation, and MCP tools for DeepSeek',
    actionTitle: 'DeepSeek++',
  },
  app: {
    sideNavLabel: 'Sidebar navigation',
    version: 'v{version}',
    tabs: {
      chat: 'Chat',
      memory: 'Memory',
      capabilities: 'Capabilities',
      preset: 'Presets',
      automation: 'Automation',
      settings: 'Settings',
    },
  },
  locale: {
    settingTitle: 'Language',
    settingDescription: 'Choose the language for DeepSeek++ UI and model behavior.',
    auto: 'Follow browser',
    zhCN: '简体中文',
    en: 'English',
  },
  sidepanel: {
    memory: {
      actions: {
        pin: 'Pin',
        unpin: 'Unpin',
      },
      age: {
        justNow: 'Just now',
        minutesAgo: '{count}m ago',
        hoursAgo: '{count}h ago',
        daysAgo: '{count}d ago',
      },
      form: {
        namePlaceholder: 'Title',
        contentPlaceholder: 'Content',
        tagsPlaceholder: 'Tags, comma-separated',
      },
      types: {
        user: 'User',
        feedback: 'Feedback',
        topic: 'Topic',
        reference: 'Reference',
      },
    },
    preset: {
      activeBadge: 'Active',
      form: {
        namePlaceholder: 'Preset name, e.g. Code assistant or Translation expert',
        contentLabel: 'System prompt content',
        contentPlaceholder: 'You are a professional...\n\n## Core principles\n- ...',
      },
    },
    skill: {
      disabledBadge: 'Disabled',
      memoryEnabledBadge: 'Memory injection',
      unknownLicense: 'Unknown license',
      actions: {
        enableSkill: 'Enable {name}',
        disableSkill: 'Disable {name}',
        editSkill: 'Edit {name}',
        deleteSkill: 'Delete {name}',
      },
      form: {
        namePlaceholder: 'Name, e.g. my-skill',
        nameError: 'Invalid name: only letters, digits, Chinese characters, and hyphens are allowed',
        triggerCommand: 'Trigger command:',
        descriptionPlaceholder: 'Description, when to use this skill',
        instructionsLabel: 'Instructions (Markdown, tell AI how to execute)',
        instructionsPlaceholder: 'You are a...\n\n## Core principles\n- ...',
        memoryInjectionLabel: 'Enable memory injection',
      },
      sources: {
        builtin: 'Built-in',
        official: 'Official',
        custom: 'Custom',
        remote: 'GitHub',
      },
    },
    scenario: {
      title: 'Context menu scenarios',
      description: 'Select text and right-click to send it to sidepanel chat',
      customTitle: 'Custom scenarios',
      namePlaceholder: 'Scenario name',
      templatePlaceholder: 'Prompt template with {text}',
    },
    githubSkillImport: {
      title: 'Import Skill from GitHub',
      description: 'Supports repositories, directories, and single SKILL.md links. DeepSeek++ previews content before import and never overwrites local custom Skills.',
      urlPlaceholder: 'https://github.com/owner/repo or .../SKILL.md',
      permissionError: 'GitHub API access permission is required to read repository Skills',
      previewFailed: 'Preview failed',
      importFailed: 'Import failed',
      importedMessage: 'Imported {count} Skills',
      selectAll: 'Select all',
      clearSelection: 'Clear selection',
      selectedSummary: 'Selected {selected} / {total} · {bytes}',
      importSelected: 'Import selected Skills',
      openRepository: 'Open repository',
      repoRoot: 'repo root',
      unknownLicense: 'Unknown',
      warningOverflow: '{count} more warnings',
      renamedBadge: 'Renamed',
      resourceCount: '{count} resources',
      omittedCount: '{count} omitted',
      renamedNotice: '{count} Skills were renamed automatically because of naming conflicts.',
      meta: {
        license: 'License',
        version: 'Version',
        skill: 'Skill',
        defaultBranch: 'Default',
      },
    },
    memoryPage: {
      emptyAll: 'No memories yet. They will accumulate automatically during conversations.',
      emptyFiltered: 'No memories in this category',
      count: '{count} memories total',
    },
    presetPage: {
      title: 'System prompt presets',
      import: 'Import',
      create: 'New',
      emptyHelp: 'Create a system prompt preset, then select it to inject automatically before the first message of each new conversation.',
      activeHelp: 'When a preset is enabled, its prompt is injected before the first message of each new conversation. Only one preset can be active at a time.',
    },
    skillPage: {
      title: 'Available Skills',
      createCustom: 'Custom',
      sectionGithub: 'GitHub imports',
      sectionBuiltin: 'Built-in',
      sectionOfficial: 'Official',
      sectionCustom: 'Custom',
      usagePrefix: 'Type',
      usageTrigger: '/skill-name arguments',
      usageSuffix: 'in the DeepSeek input to trigger a Skill. Example:',
      usageExample: '/frontend-design build a login page',
      githubSourceTitle: 'GitHub sources',
      repoRoot: 'repo root',
      check: 'Check',
      checking: 'Checking...',
      sync: 'Sync',
      syncing: 'Syncing...',
      remove: 'Remove',
      skillCount: '{count} Skills',
      unknownLicense: 'Unknown license',
      syncedAt: 'Synced {time}',
      checkedAt: 'Checked {time}',
      checkPermissionError: 'GitHub API access permission is required to check for updates',
      syncPermissionError: 'GitHub API access permission is required to sync updates',
      checkFailed: 'Update check failed',
      syncFailed: 'Sync failed',
      syncedSkills: 'Synced {count} Skills',
      deleteSourceConfirm: 'Remove {count} Skills imported from {repository}?',
      noUpdates: 'No upstream updates found',
      changedUpdates: '{count} imported Skills may have updates',
      newSkills: '{count} new Skills',
      missingSkills: '{count} imported Skills disappeared upstream',
      updatesFound: 'Upstream updates found',
    },
    settings: {
      apiKeyRequired: 'Enter a DeepSeek API Key',
      saveFailed: 'Save failed',
      clearFailed: 'Clear failed',
      apiKeySaved: 'Saved. Context menu scenarios can now run on regular webpages.',
      apiKeyCleared: 'Cleared. Context menu scenarios are limited to DeepSeek pages again.',
      webDavPermissionDenied: 'Permission is required to connect to the WebDAV server',
      operationFailed: 'Operation failed',
      syncCounts: '{memories} memories, {skills} Skills, {presets} presets',
      connectionSuccess: 'Connection succeeded',
      connectionFailed: 'Connection failed',
      uploadConfirm: 'Overwrite remote data with local memories, Skills, and presets?',
      uploadSuccess: 'Upload complete. Remote data was overwritten. {counts}',
      uploadFailed: 'Upload failed',
      downloadConfirm: 'Overwrite local memories, Skills, and presets with remote data? This cannot be undone.',
      downloadSuccess: 'Download complete. Local data was overwritten. {counts}',
      downloadFailed: 'Download failed',
      importMemoryArrayError: 'Import file must be a memory array',
      jsonFormatError: 'Invalid JSON format',
      clearAllConfirm: 'Clear all memories? This cannot be undone.',
      neverSynced: 'Never synced',
      modelSection: 'Model settings',
      expertMode: 'Expert mode',
      expertModeDescription: 'Use the DeepSeek Expert model for chat',
      sidepanelChat: 'Sidepanel chat',
      sidepanelChatDescription: 'Show the chat tab in the sidepanel with webpage login or official API Key support',
      apiKeyDescription: 'After configuration, context menu scenarios can run on regular webpages',
      configured: 'Configured',
      notConfigured: 'Not configured',
      apiKeyReplacePlaceholder: 'Enter a new key to replace it',
      saving: 'Saving',
      clearing: 'Clearing',
      clearApiKey: 'Clear API Key',
      petWhale: 'DeepSeek whale',
      petWhaleDescription: 'Show a state-aware pet on DeepSeek pages',
      backgroundSection: 'Background settings',
      customBackground: 'Custom background',
      customBackgroundDescription: 'Set a background image for DeepSeek pages',
      uploadImage: 'Upload image',
      imageUrlPlaceholder: 'Paste image URL',
      backgroundPreviewAlt: 'Background preview',
      backgroundPreviewOverlay: 'Preview simulation',
      backgroundOpacity: 'Background opacity',
      clearBackground: 'Clear background',
      floatingPetSection: 'Floating pet',
      positionBottomRight: 'Bottom right',
      positionBottomLeft: 'Bottom left',
      positionCustom: 'Custom',
      size: 'Size',
      opacity: 'Opacity',
      petMotion: 'Floating motion',
      petMotionDescription: 'Turn off to reduce movement',
      cloudSyncSection: 'Cloud sync',
      webDavUrl: 'WebDAV URL',
      username: 'Username',
      password: 'Password',
      remotePath: 'Remote path',
      testConnection: 'Test connection',
      uploadLocal: 'Upload local',
      downloadRemote: 'Download remote',
      lastSync: 'Last sync: {time}',
      dataSection: 'Data management',
      memoryTotal: 'Total memories',
      exportMemories: 'Export memories',
      importMemories: 'Import memories',
      clearAllMemories: 'Clear all memories',
      aboutSection: 'About',
      aboutTagline: 'Agentic memory and Skill system',
    },
    capabilitiesPage: {
      navLabel: 'Capabilities navigation',
      tabs: {
        skill: 'Skill',
        mcp: 'MCP',
        tools: 'Tools',
      },
    },
    mcpPage: {
      title: 'MCP',
      summary: '{servers} servers, {enabled} enabled, {tools} auto tools',
      loading: 'Loading MCP config',
      empty: 'No MCP servers',
      shell: 'Shell',
      addServer: 'Add',
      enabled: 'Enabled',
      auto: 'Auto',
      disabled: 'Disabled',
      success: 'Success',
      failure: 'Failed',
      localHost: 'local host',
      messages: {
        loadFailed: 'Failed to load MCP config',
        shellExistsSelected: 'Shell MCP already exists. Existing config selected.',
        shellCreateFailed: 'Failed to create Shell MCP preset',
        shellCreated: 'Shell MCP preset created. Run the install command below, then restart the browser.',
        saveFailed: 'Failed to save MCP server',
        deleteConfirm: 'Delete MCP server "{name}"?',
        permissionGranted: 'Granted {origin}',
        permissionDenied: 'Permission denied',
        permissionRequired: 'Permission required for {origin}',
        connectionSuccess: 'Connected. {tools} tools, {latency}',
        connectionFailed: 'Connection failed',
      },
      transportHints: {
        streamableHttp: 'Recommended. Compatible with newer MCP HTTP services.',
        http: 'JSON-RPC over HTTP POST.',
        sse: 'Legacy MCP SSE transport.',
        stdioBridge: 'The local bridge service starts stdio MCP and owns the file access boundary.',
        nativeMessaging: 'Access local capabilities through the browser Native Messaging Host.',
      },
      form: {
        createTitle: 'Add MCP server',
        editTitle: 'Edit MCP server',
        name: 'Name',
        transport: 'Transport',
        serviceUrl: 'Service URL',
        command: 'Command',
        args: 'Arguments',
        cwd: 'Working directory',
        env: 'Environment variables',
        connectMs: 'Connect ms',
        requestMs: 'Request ms',
        discoveryMs: 'Discovery ms',
        resultBytes: 'Result bytes',
        toolLimit: 'Tool limit',
        defaultExecution: 'Default execution',
        allowInject: 'Allow injection',
        modeAuto: 'Auto execute',
        modeManual: 'Manual strategy',
        modeDisabled: 'Disabled',
        save: 'Save',
      },
      headers: {
        headerName: 'Header',
        headerValue: 'Value',
        secretValue: 'Secret value',
        secretHeaderName: 'Header name',
      },
      validation: {
        nameRequired: 'Name is required',
        positiveInteger: '{label} must be a positive integer',
        nativeHostRequired: 'Native Host is required',
        nativeHostInvalid: 'Native Host can only contain letters, numbers, dots, underscores, and hyphens',
        serviceUrlRequired: 'Service URL is required',
        serviceUrlUnsupported: 'Service URL only supports http/https',
        serviceUrlInvalid: 'Service URL is invalid',
        stdioCommandRequired: 'Stdio Bridge command is required',
        headerInvalidName: 'Invalid Header name: {name}',
        emptyValue: '(empty)',
        headerInvalidValue: 'Header value cannot contain line breaks: {name}',
        headerSecretRequired: 'Header Secret requires a valid Header name',
        envInvalid: 'Invalid environment variable format: {line}',
      },
      row: {
        autoTools: '{active}/{total} auto',
        testing: 'Testing',
        refreshTools: 'Refresh tools',
      },
      detail: {
        grant: 'Grant',
        status: 'Status',
        latency: 'Latency',
        lastConnected: 'Last connected',
        transport: 'Transport',
        executionPolicy: 'Auto execution policy',
        injectionSummary: '{count} tools are currently injected. Disabled or manual strategy will not enter the DeepSeek Prompt.',
        discoveredTools: 'Discovered tools',
        noTools: 'No tools discovered yet',
        recentCalls: 'Recent calls',
        noHistory: 'No call history',
        schemaNone: 'Parameters: none',
        schemaSummary: 'Parameters: {props}{required}',
        schemaRequired: '; required {required}',
      },
      status: {
        ready: 'ready',
        error: 'error',
        disabled: 'disabled',
        unknown: 'unknown',
      },
      endpoint: {
        nativeMessaging: 'Native Messaging',
        bridgeUrl: 'Bridge URL',
        command: 'command',
      },
      shellSetup: {
        localIntro: 'Open a terminal in the project root and run:',
        publishedIntro: 'Open a terminal and run this command once:',
        fallbackIntro: 'If you are using the published extension instead of a local source build, run:',
        detectedExtensionId: 'Detected the {browser} extension ID automatically. Node.js/npm must be installed locally.',
        firefoxFixedId: 'Firefox uses a fixed extension ID, so no extra extension id is required. Node.js/npm must be installed locally.',
        installNote: 'The command installs or updates Shell Native Host. OfficeCLI is skipped by default; remove --skip-officecli if you need OfficeCLI.',
        enableAndTest: 'After installation, enable this service with the switch above, then click "Test" to verify the connection.',
        restartAndTest: 'After installation, restart the browser and click "Test" here to verify the connection.',
        forbidden: 'Native Host is installed, but the current extension ID is not authorized. Run the install command again, then restart the browser.',
        notFound: 'Native Host was not found. Run the install command below and make sure Node.js/npm is installed.',
        unavailable: 'The current browser does not support Native Messaging. Use Chrome, Edge, or Firefox.',
        cannotConnect: 'Cannot connect to Native Host. Confirm that the install script ran and the browser was restarted.',
        ready: 'Connected, {count} tools discovered.',
        disabled: 'The service has been created but is not enabled. Install Native Host, then enable and test it.',
        installFirst: 'Install Native Host first, then click "Test" to verify the connection.',
      },
    },
    chatPage: {
      authRequired: 'Configure a DeepSeek API Key, or sign in at chat.deepseek.com first',
      authHint: 'Without an API Key, sidepanel chat depends on the DeepSeek webpage login session',
      title: 'Chat',
      newSessionTitle: 'New session',
      newSession: 'New',
      empty: 'Type a message to start chatting',
      inputPlaceholder: 'Type a message... (Enter to send, Shift+Enter for a new line)',
      send: 'Send',
    },
    toolsPage: {
      diagnosticsDefaultQuery: 'DeepSeek latest news',
      diagnosticsRunning: 'Diagnosing...',
      diagnosticsRun: 'Diagnose',
      bytes: '{count} bytes',
      errorPrefix: 'Error: {error}',
      toolTitle: 'Tool switches',
      toolDescription: 'When disabled, the tool is not injected into conversations and AI cannot call it',
      webSearchName: 'Web search (web_search)',
      webSearchDescription: 'Search Bing keywords and return titles, URLs, and snippets',
      webFetchName: 'Fetch web page (web_fetch)',
      webFetchDescription: 'Download a URL and extract visible text content',
      pythonTitle: 'Python interpreter (python_exec)',
      pythonStatusNoShell: 'Shell Native Host has not been created',
      pythonStatusNoCache: 'Tools have not been refreshed',
      pythonStatusEnabled: 'Enabled',
      pythonStatusDiscovered: 'Discovered, not enabled',
      pythonStatusMissing: 'python_exec not found',
      pythonDescription: 'Run short code with local Python for quick checks, complex calculations, and small data tasks.',
      pythonCreate: 'Create Shell',
      pythonCreating: 'Creating',
      pythonRefresh: 'Refresh tools',
      pythonRefreshing: 'Refreshing',
      pythonStatusAvailable: 'python_status available',
      pythonMissingDetail: 'The current Shell Native Host did not return python_exec. Reinstall Shell Native Host, restart the browser, then refresh again.',
      shellExists: 'Shell MCP already exists. Refresh tools or reinstall Native Host.',
      shellCreated: 'Shell MCP was created. Install or reinstall Shell Native Host, then refresh tools.',
      pythonFound: 'Python interpreter tool found.',
      pythonMissingAfterRefresh: 'python_exec was not found. Reinstall Shell Native Host, restart the browser, then refresh tools.',
      pythonMissingBeforeToggle: 'python_exec was not found. Refresh tools first, and reinstall Shell Native Host if needed.',
      pythonEnabled: 'Python interpreter enabled.',
      pythonDisabled: 'Python interpreter disabled.',
      disabledNotice: 'After a tool is disabled, new conversations no longer include its call format. Existing conversations are not affected.',
      diagnosticTitle: 'Search diagnostics',
      diagnosticDescription: 'Test whether search works directly, without the AI chat path',
      permissionTitle: 'web_fetch permission',
      permissionDescription: 'Fetching pages requires permission for the target site. Enter a URL here and grant access.',
      grantPermission: 'Grant',
      permissionGranted: 'Permission granted. This site can be accessed.',
      permissionDenied: 'Permission denied. Try again or add access manually in chrome://extensions.',
      permissionInvalidUrl: 'Invalid URL. Enter a full URL such as https://example.com.',
      allSitesRequesting: 'Requesting...',
      allSitesGranted: 'All sites granted',
      allSitesGrant: 'Grant all sites',
      allSitesHelp: 'Grant the extension access to all sites, so web_fetch can fetch pages without another prompt',
    },
    automationPage: {
      title: 'Automation',
      summary: '{total} tasks, {active} active',
      create: 'New',
      empty: 'No automations',
      namePromptRequired: 'Name and prompt are required',
      expressionRequired: 'Enter a schedule expression',
      runFailed: 'Run failed',
      deleteConfirm: 'Delete automation "{name}"?',
      form: {
        name: 'Name',
        namePlaceholder: 'Task name',
        model: 'Model',
        defaultModel: 'Default',
        promptPlaceholder: 'Enter the content to send to DeepSeek on schedule',
        trigger: 'Trigger',
        manual: 'Manual',
        expression: 'Expression',
        timezone: 'Timezone',
        search: 'Web search',
        thinking: 'Deep thinking',
        create: 'Create',
      },
      status: {
        active: 'Active',
        paused: 'Paused',
        queued: 'Queued',
        running: 'Running',
        succeeded: 'Succeeded',
        failed: 'Failed',
        timeout: 'Timed out',
        cancelled: 'Cancelled',
        skipped: 'Skipped',
      },
      meta: {
        next: 'Next',
        previous: 'Previous',
        session: 'Session',
        recent: 'Recent',
        notCreated: 'Not created',
        none: 'None',
      },
      actions: {
        openSession: 'Open session',
        runNow: 'Run now',
      },
      attempt: '{count}x',
    },
  },
  content: {
    export: {
      buttonIdle: 'Export current conversation',
      buttonRunning: 'Exporting current conversation',
      emptyConversation: 'This page has no exportable conversation yet.',
      formatDialogLabel: 'Choose export formats',
      formatTitle: 'Export formats',
      submit: 'Export',
      progress: 'Exporting current conversation...',
      failed: 'Export failed',
      cancelled: 'Export cancelled',
      partialSuccess: 'Export completed, but some sessions could not be read. Check Export Warnings in the exported file.',
      success: 'Current conversation exported.',
    },
    toolBlock: {
      title: 'Executed tools ({count})',
      pythonInterpreter: 'Python interpreter',
      summaries: {
        saved: 'Saved',
        updated: 'Updated',
        deleted: 'Deleted',
        searched: 'Searched',
        fetched: 'Fetched',
        executed: 'Executed',
        failed: 'Execution failed',
        messageFailed: 'Tool message failed',
        backgroundFailed: 'Background tool execution failed',
      },
      missingResultDetail: 'Background did not return a tool result. Refresh the current DeepSeek page and try again. If it still fails, retest Shell Local on the MCP page.',
      invalidResultDetail: 'Background returned an invalid tool result: {preview}',
    },
    agent: {
      stop: 'Stop',
      stopped: 'Stopped',
      step: 'Step {index}',
      streaming: 'streaming...',
      complete: 'Complete',
      completeWithTools: 'Complete ({count} tools)',
      executingTools: 'Executing tools',
      error: 'Execution error',
      footerComplete: 'Agent complete ({steps} steps, {tools} tool calls)',
      footerError: 'Agent error ({steps} steps, {tools} tool calls)',
    },
    permission: {
      webFetch: 'DeepSeek++ needs permission to access {origin} so it can fetch that page',
      deny: 'Deny',
      grant: 'Allow',
      requesting: 'Requesting...',
    },
    skillPopup: {
      hint: '↑↓ Navigate · Enter Select · Esc Close',
    },
    tokenSpeed: {
      title: 'Token output speed: {speed}{idle}',
      idleSuffix: ' (idle)',
    },
    extensionReloaded: 'The extension was reloaded. Refresh the current DeepSeek page and try again.',
  },
  background: {
    contextMenus: {
      sendToChat: 'Send to chat',
    },
    auth: {
      missingDeepSeek: 'Sign in at chat.deepseek.com first, or refresh the DeepSeek page and try again.',
    },
    export: {
      generating: 'Generating export files',
      cancelled: 'Export cancelled',
    },
    sync: {
      missingWebDav: 'WebDAV is not configured',
      missingRemoteFile: 'Remote file {file} is missing. Download stopped to avoid overwriting local data.',
    },
    chat: {
      continueWithToolResults: '[TOOL_RESULTS]\n{toolResults}\n[/TOOL_RESULTS]\n\nContinue answering based on the tool results above.',
      maxToolSteps: '(Maximum tool-call steps reached; conversation ended)',
    },
  },
  tool: {
    runtime: {
      invalidFormat: 'Invalid tool format',
      unknownTool: 'Unknown tool',
    },
    memory: {
      providerName: 'DeepSeek++ Memory',
      saveTitle: 'Save memory',
      saveDescription: 'Save a new long-term memory',
      typeDescription: 'Memory type: user=identity, role, or preference; feedback=behavior correction; topic=discussion notes; reference=external resource link',
      nameDescription: 'Short title',
      contentDescription: 'Content to save',
      tagsDescription: 'Tag list',
      updateTitle: 'Update memory',
      updateDescription: 'Update an existing memory',
      idDescription: 'Memory ID',
      updatedNameDescription: 'Updated title',
      updatedContentDescription: 'Updated content',
      deleteTitle: 'Delete memory',
      deleteDescription: 'Delete memory',
      unsupported: 'Unsupported memory tool',
      saveFailed: 'Save failed',
      saveMissingConfirmation: 'No save confirmation received',
      saved: 'Saved',
      invalidPayload: 'Invalid memory payload',
      invalidType: 'type must be user, feedback, topic, or reference',
      invalidName: 'name must be a non-empty string',
      invalidContent: 'content must be a non-empty string',
      invalidTags: 'tags must be an array of strings',
      invalidId: 'Invalid ID',
      notFound: 'Memory not found',
      notFoundDetail: 'ID {id} does not exist',
      updated: 'Updated',
      deleted: 'Deleted',
    },
    web: {
      providerName: 'DeepSeek++ Web Search',
      searchTitle: 'Search the web',
      searchDescription: 'Search the web and return matching page titles, URLs, and snippets',
      queryDescription: 'Search query keywords',
      topKDescription: 'Number of results to return, default 5',
      fetchTitle: 'Fetch web page',
      fetchDescription: 'Download the specified URL and return visible text after removing navigation, scripts, and styles',
      urlDescription: 'Full URL to fetch (http:// or https://)',
      unsupported: 'Unsupported web tool',
      emptyQuery: 'Search query cannot be empty',
      searchComplete: 'Search completed with {count} results',
      searchNoResults: 'No search results',
      searchFailed: 'Search failed',
      permissionDenied: 'The extension does not have permission to access Bing. Remove and reload the dist/chrome-mv3 extension directory, or confirm cn.bing.com is listed under site access in chrome://extensions -> DeepSeek++ details.',
      noParseableResults: 'No parseable search results found: {error}',
      searchFailedDetail: 'Search failed: {error}',
      emptyUrl: 'URL cannot be empty',
      invalidUrl: 'Invalid URL',
      invalidUrlDetail: 'Could not parse URL: {url}',
      contentType: 'Page type: {contentType}',
      contentTypeDetail: 'Content-Type: {contentType}\nURL: {url}\n(Content is not text and cannot be displayed)',
      truncated: '\n\n... [Content truncated, {count} characters total]',
      fetchComplete: 'Fetched {url}',
      fetchTruncatedDetail: 'Page length {length} characters, truncated to {maxLength} characters',
      fetchLengthDetail: 'Page length {length} characters',
      fetchFailed: 'Failed to fetch page',
      missingHostPermission: 'Cannot access {url}; host permission is missing.',
    },
  },
  prompt: {
    toolCallReminderTitle: 'Tool call format reminder:',
    taskCompleteTag: 'task_complete',
    memoryEmpty: '(No memories yet)',
    skillUserInputWrapper: '{instructions}\n\n---\n\nThe following is the user input for this turn. Follow the instructions above when handling it:\n\n{userInput}',
    inlineAgent: {
      continuationIntro: 'These are the tool results just executed for the tool-continuation task. Continue like a real agent, using the original task and these tool results to move the work forward.',
      continuationEnough: 'If the results are enough, output the final answer. Only call more tools when more information, verification, or file changes are truly needed.',
      continuationNoPseudo: 'Do not ask the user to click continue, and do not output pseudo tool-call JSON. When more action is needed, output only executable XML tool tags.',
      failureRecovery: 'At least one tool failed. Do not stop because of a recoverable error; read summary/detail/error, fix the parameters or choose a suitable next step, and continue completing the task.',
      nudgeNoTools: 'The previous reply did not include executable tool XML, so the automated continuation cannot proceed.',
      nudgeChoice: 'Choose exactly one path based on the original task and tool results:',
      nudgeNextTool: '1. If the task is still incomplete, this turn MUST directly output the next executable tool XML.',
      nudgeComplete: '2. If the task is complete, output <task_complete>{"summary":"..."}</task_complete>.',
      nudgeCount: 'This is no-tool-call correction attempt {count}.',
      finalizationIntro: 'These are the tool results that were just executed automatically. Give the final answer based on the original task and these results.',
      finalizationNoTools: 'This is the final-answer turn: do not call any more tools.',
    },
    automation: {
      continuationIntro: 'These are the MCP tool results just executed for the automation. Continue completing the automation based on these results.',
      continuationEnough: 'If the results are enough, output the final conclusion. Only call more tools when more information is truly needed.',
    },
    systemChat: `## Role
You are the user's personal AI assistant with long-term cross-conversation memory. You can remember the user's identity, preferences, technical stack, and key context from prior conversations so future replies are personalized and useful.

## Existing Memories
{memories}

## Tools

You have access to a set of tools. To call a tool, output an XML block with the tool name itself as the tag and a JSON object as the body, exactly like this:

<memory_save>
{"type": "user", "name": "User role", "content": "Frontend developer", "tags": ["frontend"]}
</memory_save>

The JSON body MUST be valid JSON on its own. Do NOT add any other text inside the tags, only JSON. Use forward slashes or escaped backslashes for local file paths. You can place tool calls anywhere in your reply (not only at the end).
The extension only executes direct tool-name tags. Never use wrapper formats such as <invoke name="tool_name">...</invoke> or <tool_call>...</tool_call>.
The tag name MUST exactly match one of the available tool names.
If a tool is listed in Available Tools, it is connected through the extension and you can call it by emitting the XML tag. Do NOT say you cannot call listed MCP tools.
Never output pseudo tool-call JSON such as {"tool":"name","arguments":{...}} in a Markdown code block. That is explanation text, not an executable call.
Never place executable tool XML in a thinking/reasoning section. Put tool XML in the final assistant answer content so the extension can execute it.

### Available Tools

{tools}

You MUST strictly follow the tool names and parameter schemas above when invoking tools.

## Memory Saving Rules

When any of the following appears in conversation, you MUST call the memory_save tool:
- The user mentions their identity, profession, or role
- The user expresses preferences, habits, or working style
- The user corrects your answer style or behavior
- Important technical decisions or architecture choices appear
- The user explicitly says "remember", "note this", "do not forget", or similar

### Example

User: I am a frontend developer and mainly use React and TypeScript
Assistant reply:

Got it. React + TypeScript is a common modern frontend stack. Ask me anything related to it.

<memory_save>
{"type": "user", "name": "User role and tech stack", "content": "Frontend developer, mainly uses React and TypeScript", "tags": ["frontend", "React", "TypeScript"]}
</memory_save>

### Rules
- You may call tools anywhere in your reply, not only at the end
- Tool calls are executed automatically and results are returned to you
- Save only information with long-term value, not one-off Q&A
- Do not save information that already exists in Existing Memories

`,
    systemThinking: `You have long-term memory. Existing memories:

{memories}

## Tools

You have access to a set of tools. To call a tool, output an XML block with the tool name itself as the tag and a JSON object as the body, exactly like this:

<memory_save>
{"type": "user", "name": "User role", "content": "Frontend developer", "tags": ["frontend"]}
</memory_save>

The JSON body MUST be valid JSON on its own. Do NOT add any other text inside the tags, only JSON. Use forward slashes or escaped backslashes for local file paths.
The extension only executes direct tool-name tags. Never use wrapper formats such as <invoke name="tool_name">...</invoke> or <tool_call>...</tool_call>.
The tag name MUST exactly match one of the available tool names.
If a tool is listed in Available Tools, it is connected through the extension and you can call it by emitting the XML tag. Do NOT say you cannot call listed MCP tools.
Never output pseudo tool-call JSON such as {"tool":"name","arguments":{...}} in a Markdown code block. That is explanation text, not an executable call.
Never place executable tool XML in a thinking/reasoning section. Put tool XML in the final assistant answer content so the extension can execute it.

### Available Tools

{tools}

You MUST strictly follow the tool names and parameter schemas above when invoking tools.

When the user reveals important durable information (identity, preference, behavior correction, or important decision), you MUST call memory_save. You may call tools anywhere in your reply. Save only information with long-term value; do not duplicate existing memories.

---

`,
    webSearchGuidance: `## Web Search Rules

Use the web_search tool when any of these apply:
- The user asks about real-time information, news, events, exchange rates, weather, or similar
- The user asks about knowledge you are not sure about and current sources are needed
- The user explicitly asks you to search or look something up
- You need to verify facts, data, or cited sources

### Search Flow
1. First output a web_search tool call
2. The search runs automatically; results are shown on the page and sent back to you
3. Read the results, then answer based on them

### Example

User: Who won the 2024 Nobel Prizes?
Assistant reply:

I will search for the latest information.

<web_search>
{"query": "2024 Nobel Prize winners"}
</web_search>

### Rules
- Use keywords that match the user's language and target sources
- If one search is not enough, call web_search again with different keywords
- Do not invent real-time information without searching
`,
    toolFormatReminder: `---
Tool call format reminder:
Available tool tag names: {names}
These listed tools are executable by the extension. Do not claim you cannot call a listed MCP tool.
To call a tool, use ONLY the direct XML tag whose name is the tool name, with valid JSON as the body.
For MCP tools, prefer the short tag name when it appears in the available names list.
For local file paths, use forward slashes or escaped backslashes so the JSON body remains valid.
Do not use <invoke name="...">, <tool_call>, Markdown code fences, {"tool":"...","arguments":{...}}, or any wrapper format.
Do not put executable tool XML in a thinking/reasoning section; put it in the final assistant answer content.
`,
    pythonHintTitle: '### Python Quick Validation Capability',
    pythonHintExec: 'Use <{execName}> for short Python snippets that verify an idea, perform complex calculations, or transform small data. Treat it as a scratchpad, not as a general local execution environment.',
    pythonHintStatus: 'Use <{statusName}>{}</{statusName}> when you need to know the Python version or whether numpy, pandas, or sympy are available.',
    pythonHintAvailability: 'Assume the Python standard library is available. Only use numpy, pandas, or sympy after python_status reports them as available.',
    pythonHintSafety: 'Do not install packages, access sensitive local files, run long jobs, or use network access through Python. Keep code short and return concise text or JSON.',
    shellHintTitle: '### Shell MCP Capability',
    shellHintConnected: 'Shell MCP is connected through the extension. You can execute local CLI commands by emitting the executable XML tool tag; do not say you cannot run commands when this tool is listed.',
    shellHintExec: 'Use <{execName}> with a JSON body such as {"command":"officecli --version","timeout_ms":60000} to run OfficeCLI or other local CLI tools.',
    shellHintStatus: 'Use <{statusName}>{}</{statusName}> first when you need host status, shell, PATH, or working-directory context.',
    shellHintWindows: 'Match command syntax to shell_status.shell. On Windows the Shell Local host uses PowerShell by default, so list files with commands such as Get-ChildItem -LiteralPath "D:\\\\Documents\\\\Downloads\\\\CN" -File | Select-Object -ExpandProperty FullName, and quote paths once inside the command string. Use cmd.exe /c explicitly only when you need CMD syntax such as dir /b.',
    shellHintNames: 'Recognized shell tool names: {names}',
  },
  pet: {
    lines: {
      thinking: ['Thinking...', 'Reasoning...', 'Working it through'],
      working: ['Working', 'Crafting', 'Building'],
      speaking: ['Explaining', 'Unfolding', 'Finding the thread'],
      idle: ['Idle', 'Tap to check in', 'Taking a breath'],
      confused: ['Reorienting', 'Sorting it out', 'Finding the path'],
      success: ['Done', 'Handled', 'Finished'],
      error: ['Stuck...', 'Something failed', 'Needs a retry'],
      sleepy: ['Zzz...', 'Sleepy...', 'Taking a nap'],
    },
  },
} as const satisfies LocaleMessages;
