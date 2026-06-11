import type { LocaleSchema } from '../types';

export const zhCN = {
  common: {
    add: '新增',
    all: '全部',
    auto: '自动',
    cancel: '取消',
    clear: '清除',
    close: '关闭',
    confirm: '确认',
    delete: '删除',
    deactivate: '停用',
    disabled: '已停用',
    edit: '编辑',
    enable: '启用',
    enabled: '已启用',
    error: '错误',
    loading: '加载中...',
    manual: '手动',
    none: '无',
    open: '打开',
    preview: '预览',
    refresh: '刷新',
    remove: '移除',
    save: '保存',
    saveChanges: '保存更改',
    search: '搜索',
    status: '状态',
    success: '成功',
    sync: '同步',
    test: '测试',
    update: '更新',
  },
  manifest: {
    name: 'DeepSeek++',
    description: 'DeepSeek 的 Agentic 记忆、Skill、执行、自动化和 MCP 工具',
    actionTitle: 'DeepSeek++',
  },
  app: {
    sideNavLabel: '侧栏导航',
    version: 'v{version}',
    tabs: {
      chat: '对话',
      memory: '记忆',
      capabilities: '能力',
      preset: '预设',
      automation: '自动化',
      settings: '设置',
    },
  },
  locale: {
    settingTitle: '语言',
    settingDescription: '选择 DeepSeek++ 的界面和模型行为语言。',
    auto: '跟随浏览器',
    zhCN: '简体中文',
    en: 'English',
  },
  sidepanel: {
    memory: {
      actions: {
        pin: '置顶',
        unpin: '取消置顶',
      },
      age: {
        justNow: '刚刚',
        minutesAgo: '{count}分钟前',
        hoursAgo: '{count}小时前',
        daysAgo: '{count}天前',
      },
      form: {
        namePlaceholder: '标题',
        contentPlaceholder: '内容',
        tagsPlaceholder: '标签（逗号分隔）',
      },
      types: {
        user: '用户',
        feedback: '反馈',
        topic: '话题',
        reference: '参考',
      },
    },
    preset: {
      activeBadge: '生效中',
      form: {
        namePlaceholder: '预设名称（如：代码助手、翻译专家）',
        contentLabel: '系统提示词内容',
        contentPlaceholder: '你是一位专业的...\n\n## 核心原则\n- ...',
      },
    },
    skill: {
      disabledBadge: '已停用',
      memoryEnabledBadge: '含记忆注入',
      unknownLicense: '未知许可',
      actions: {
        enableSkill: '启用 {name}',
        disableSkill: '停用 {name}',
        editSkill: '编辑 {name}',
        deleteSkill: '删除 {name}',
      },
      form: {
        namePlaceholder: '名称（如 my-skill 或 翻译助手）',
        nameError: '名称无效，仅支持英文、数字、中文和连字符',
        triggerCommand: '触发命令：',
        descriptionPlaceholder: '描述（何时使用这个 skill）',
        instructionsLabel: '指令（Markdown 格式，告诉 AI 如何执行）',
        instructionsPlaceholder: '你是一位...\n\n## 核心原则\n- ...',
        memoryInjectionLabel: '启用记忆注入',
      },
      sources: {
        builtin: '内置',
        official: '官方',
        custom: '自定义',
        remote: 'GitHub',
      },
    },
    scenario: {
      title: '右键场景',
      description: '选中文本后右键可发送到侧边栏对话',
      customTitle: '自定义场景',
      namePlaceholder: '场景名称',
      templatePlaceholder: 'Prompt 模板（含 {text}）',
    },
    githubSkillImport: {
      title: '从 GitHub 导入 Skill',
      description: '支持仓库、目录或单个 SKILL.md 链接。导入前会预览内容，不会覆盖本地自定义 Skill。',
      urlPlaceholder: 'https://github.com/owner/repo 或 .../SKILL.md',
      permissionError: '需要 GitHub API 访问权限才能读取仓库 Skill',
      previewFailed: '预览失败',
      importFailed: '导入失败',
      importedMessage: '已导入 {count} 个 Skill',
      selectAll: '全选',
      clearSelection: '取消全选',
      selectedSummary: '已选 {selected} / {total} · {bytes}',
      importSelected: '导入选中 Skill',
      openRepository: '打开仓库',
      repoRoot: '仓库根目录',
      unknownLicense: '未知',
      warningOverflow: '还有 {count} 条警告',
      renamedBadge: '已改名',
      resourceCount: '资源 {count}',
      omittedCount: '省略 {count}',
      renamedNotice: '有 {count} 个 Skill 因命名冲突自动加后缀。',
      meta: {
        license: '许可',
        version: '版本',
        skill: 'Skill',
        defaultBranch: '默认分支',
      },
    },
    memoryPage: {
      emptyAll: '暂无记忆，对话时会自动积累',
      emptyFiltered: '该分类下暂无记忆',
      count: '共 {count} 条记忆',
    },
    presetPage: {
      title: '系统提示词预设',
      import: '导入',
      create: '新建',
      emptyHelp: '创建系统提示词预设后，选中即可在每次新对话的第一条消息前自动注入，无需手动触发。',
      activeHelp: '启用一个预设后，每次新对话的首条消息会自动注入该提示词。同一时间只能激活一个预设。',
    },
    skillPage: {
      title: '可用 Skill',
      createCustom: '自定义',
      sectionGithub: 'GitHub 导入',
      sectionBuiltin: '内置',
      sectionOfficial: '官方',
      sectionCustom: '自定义',
      usagePrefix: '在 DeepSeek 输入框中输入',
      usageTrigger: '/skill名 参数',
      usageSuffix: '触发。例如：',
      usageExample: '/frontend-design 做一个登录页',
      githubSourceTitle: 'GitHub 源',
      repoRoot: '仓库根目录',
      check: '检查',
      checking: '检查中...',
      sync: '同步',
      syncing: '同步中...',
      remove: '移除',
      skillCount: '{count} 个 Skill',
      unknownLicense: '未知许可',
      syncedAt: '同步 {time}',
      checkedAt: '检查 {time}',
      checkPermissionError: '需要 GitHub API 访问权限才能检查更新',
      syncPermissionError: '需要 GitHub API 访问权限才能同步更新',
      checkFailed: '检查更新失败',
      syncFailed: '同步失败',
      syncedSkills: '已同步 {count} 个 Skill',
      deleteSourceConfirm: '确定移除 {repository} 导入的 {count} 个 Skill 吗？',
      noUpdates: '上游没有发现更新',
      changedUpdates: '{count} 个已导入 Skill 可能有更新',
      newSkills: '{count} 个新增 Skill',
      missingSkills: '{count} 个已导入 Skill 在上游消失',
      updatesFound: '发现上游更新',
    },
    settings: {
      apiKeyRequired: '请输入 DeepSeek API Key',
      saveFailed: '保存失败',
      clearFailed: '清除失败',
      apiKeySaved: '已保存，右键场景可在普通网页使用',
      apiKeyCleared: '已清除，右键场景恢复为仅 DeepSeek 网页可用',
      webDavPermissionDenied: '需要访问权限才能连接 WebDAV 服务器',
      operationFailed: '操作失败',
      syncCounts: '记忆 {memories} 条，Skill {skills} 个，预设 {presets} 个',
      connectionSuccess: '连接成功',
      connectionFailed: '连接失败',
      uploadConfirm: '确定要用本地记忆、Skill 和预设覆盖云端数据吗？',
      uploadSuccess: '上传完成，已覆盖云端。{counts}',
      uploadFailed: '上传失败',
      downloadConfirm: '确定要用云端记忆、Skill 和预设覆盖本地数据吗？此操作不可撤销。',
      downloadSuccess: '下载完成，已覆盖本地。{counts}',
      downloadFailed: '下载失败',
      importMemoryArrayError: '导入文件必须是记忆数组',
      jsonFormatError: 'JSON 格式错误',
      clearAllConfirm: '确定要清除所有记忆吗？此操作不可撤销。',
      neverSynced: '从未同步',
      modelSection: '模型设置',
      expertMode: 'Expert 模式',
      expertModeDescription: '使用 DeepSeek Expert 模型进行对话',
      sidepanelChat: '侧边栏对话',
      sidepanelChatDescription: '在侧边栏显示对话标签，支持网页登录或官方 API Key',
      apiKeyDescription: '配置后右键场景可在普通网页使用',
      configured: '已配置',
      notConfigured: '未配置',
      apiKeyReplacePlaceholder: '输入新 Key 可替换',
      saving: '保存中',
      clearing: '清除中',
      clearApiKey: '清除 API Key',
      petWhale: 'DeepSeek 小鲸鱼',
      petWhaleDescription: '在 DeepSeek 页面显示状态联动宠物',
      backgroundSection: '背景设置',
      customBackground: '自定义背景',
      customBackgroundDescription: '为 DeepSeek 页面设置背景图片',
      uploadImage: '上传图片',
      imageUrlPlaceholder: '粘贴图片 URL',
      backgroundPreviewAlt: '背景预览',
      backgroundPreviewOverlay: '模拟效果预览',
      backgroundOpacity: '背景透明度',
      clearBackground: '清除背景',
      floatingPetSection: '悬浮宠物',
      positionBottomRight: '右下',
      positionBottomLeft: '左下',
      positionCustom: '自定义',
      size: '尺寸',
      opacity: '透明度',
      petMotion: '动态漂浮',
      petMotionDescription: '减少动作时可关闭',
      cloudSyncSection: '云同步',
      webDavUrl: 'WebDAV 地址',
      username: '用户名',
      password: '密码',
      remotePath: '远程路径',
      testConnection: '测试连接',
      uploadLocal: '上传本地',
      downloadRemote: '下载云端',
      lastSync: '上次同步: {time}',
      dataSection: '数据管理',
      memoryTotal: '记忆总数',
      exportMemories: '导出记忆',
      importMemories: '导入记忆',
      clearAllMemories: '清除所有记忆',
      aboutSection: '关于',
      aboutTagline: 'Agentic 记忆与 Skill 系统',
    },
    capabilitiesPage: {
      navLabel: '能力子导航',
      tabs: {
        skill: 'Skill',
        mcp: 'MCP',
        tools: '工具',
      },
    },
    mcpPage: {
      title: 'MCP',
      summary: '{servers} 个服务，{enabled} 个启用，{tools} 个自动工具',
      loading: '正在加载 MCP 配置',
      empty: '暂无 MCP 服务',
      shell: 'Shell',
      addServer: '新增',
      enabled: '启用',
      auto: '自动',
      disabled: '禁用',
      success: '成功',
      failure: '失败',
      localHost: '本地宿主',
      messages: {
        loadFailed: '加载 MCP 配置失败',
        shellExistsSelected: 'Shell MCP 已存在，已选中现有配置',
        shellCreateFailed: '创建 Shell MCP 预设失败',
        shellCreated: '已创建 Shell MCP 预设。请运行下方安装命令后重启浏览器。',
        saveFailed: '保存 MCP 服务失败',
        deleteConfirm: '删除 MCP 服务「{name}」？',
        permissionGranted: '已授权 {origin}',
        permissionDenied: '授权被拒绝',
        permissionRequired: '需要授权 {origin}',
        connectionSuccess: '连接成功，{tools} 个工具，{latency}',
        connectionFailed: '连接失败',
      },
      transportHints: {
        streamableHttp: '推荐，兼容新版 MCP HTTP 服务',
        http: 'JSON-RPC over HTTP POST',
        sse: '旧版 MCP SSE 传输',
        stdioBridge: '本地桥接服务负责启动 stdio MCP 和文件访问边界',
        nativeMessaging: '通过 Browser Native Messaging Host 访问本机能力',
      },
      form: {
        createTitle: '新增 MCP 服务',
        editTitle: '编辑 MCP 服务',
        name: '名称',
        transport: '传输',
        serviceUrl: '服务 URL',
        command: '命令',
        args: '参数',
        cwd: '工作目录',
        env: '环境变量',
        connectMs: '连接 ms',
        requestMs: '请求 ms',
        discoveryMs: '发现 ms',
        resultBytes: '结果字节',
        toolLimit: '工具上限',
        defaultExecution: '默认执行',
        allowInject: '允许注入',
        modeAuto: '自动执行',
        modeManual: '手动策略',
        modeDisabled: '禁用',
        save: '保存',
      },
      headers: {
        headerName: 'Header',
        headerValue: 'Value',
        secretValue: 'Secret value',
        secretHeaderName: 'Header name',
      },
      validation: {
        nameRequired: '名称不能为空',
        positiveInteger: '{label} 必须是正整数',
        nativeHostRequired: 'Native Host 不能为空',
        nativeHostInvalid: 'Native Host 只能包含字母、数字、点、下划线和短横线',
        serviceUrlRequired: '服务 URL 不能为空',
        serviceUrlUnsupported: '服务 URL 只支持 http/https',
        serviceUrlInvalid: '服务 URL 格式无效',
        stdioCommandRequired: 'Stdio Bridge 命令不能为空',
        headerInvalidName: 'Header 名称无效：{name}',
        emptyValue: '(空)',
        headerInvalidValue: 'Header 值不能包含换行：{name}',
        headerSecretRequired: 'Header Secret 需要有效 Header 名称',
        envInvalid: '环境变量格式无效：{line}',
      },
      row: {
        autoTools: '{active}/{total} 自动',
        testing: '测试中',
        refreshTools: '刷新工具',
      },
      detail: {
        grant: '授权',
        status: '状态',
        latency: '延迟',
        lastConnected: '上次连接',
        transport: '传输',
        executionPolicy: '自动执行策略',
        injectionSummary: '当前注入 {count} 个工具；禁用或手动策略不会进入 DeepSeek Prompt。',
        discoveredTools: '发现工具',
        noTools: '尚未发现工具',
        recentCalls: '最近调用',
        noHistory: '暂无调用记录',
        schemaNone: '参数：无',
        schemaSummary: '参数：{props}{required}',
        schemaRequired: '；必填 {required}',
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
        localIntro: '打开终端，在项目根目录执行以下命令：',
        publishedIntro: '打开终端，执行以下命令（只需一次）：',
        fallbackIntro: '如果你使用的是已发布扩展而不是本地源码版，执行：',
        detectedExtensionId: '已自动检测 {browser} 扩展 ID。安装需要本机已安装 Node.js/npm。',
        firefoxFixedId: 'Firefox 使用固定扩展 ID，不需要额外填写 extension id。安装需要本机已安装 Node.js/npm。',
        installNote: '命令会安装或更新 Shell Native Host；默认跳过 OfficeCLI，如需 OfficeCLI 可去掉 --skip-officecli。',
        enableAndTest: '安装完成后，打开上方开关启用此服务，再点击「测试」验证连接。',
        restartAndTest: '安装完成后重启浏览器，回到这里点击「测试」验证连接。',
        forbidden: 'Native Host 已安装，但未授权当前扩展 ID。请重新运行下方安装命令后重启浏览器。',
        notFound: '未找到 Native Host — 请先运行下方安装命令，并确保已安装 Node.js/npm。',
        unavailable: '当前浏览器不支持 Native Messaging，请使用 Chrome、Edge 或 Firefox。',
        cannotConnect: '无法连接到 Native Host — 请确认已运行安装脚本并重启浏览器。',
        ready: '已连接，发现 {count} 个工具。',
        disabled: '服务已创建但尚未启用。请先安装 Native Host，再启用并测试。',
        installFirst: '请先安装 Native Host，再点击「测试」验证连接。',
      },
    },
    chatPage: {
      authRequired: '请配置 DeepSeek API Key，或先登录 chat.deepseek.com',
      authHint: '未配置 Key 时，侧边栏对话依赖 DeepSeek 网页登录态',
      title: '对话',
      newSessionTitle: '新建会话',
      newSession: '新建',
      empty: '输入消息开始对话',
      inputPlaceholder: '输入消息... (Enter 发送, Shift+Enter 换行)',
      send: '发送',
    },
    toolsPage: {
      diagnosticsDefaultQuery: '橘鸦 up主',
      diagnosticsRunning: '诊断中...',
      diagnosticsRun: '诊断',
      bytes: '{count} 字节',
      errorPrefix: '错误: {error}',
      toolTitle: '工具开关',
      toolDescription: '关闭后该工具不会注入到对话中，AI 将无法调用',
      webSearchName: '搜索互联网 (web_search)',
      webSearchDescription: '在 Bing 搜索关键词，返回标题、URL 和摘要',
      webFetchName: '获取网页 (web_fetch)',
      webFetchDescription: '下载指定 URL 并提取可视文本内容',
      pythonTitle: 'Python 解释器 (python_exec)',
      pythonStatusNoShell: '未创建 Shell Native Host',
      pythonStatusNoCache: '尚未刷新工具',
      pythonStatusEnabled: '已开启',
      pythonStatusDiscovered: '已发现，未开启',
      pythonStatusMissing: '未发现 python_exec',
      pythonDescription: '用本机 Python 执行短代码，适合快速验证想法、复杂计算和小型数据处理。',
      pythonCreate: '创建 Shell',
      pythonCreating: '创建中',
      pythonRefresh: '刷新工具',
      pythonRefreshing: '刷新中',
      pythonStatusAvailable: 'python_status 可用',
      pythonMissingDetail: '当前 Shell Native Host 版本没有返回 python_exec。重装 Shell Native Host 并重启浏览器后再刷新。',
      shellExists: 'Shell MCP 已存在，请刷新工具或重装 Native Host。',
      shellCreated: '已创建 Shell MCP。安装或重装 Shell Native Host 后点击刷新工具。',
      pythonFound: '已发现 Python 解释器工具。',
      pythonMissingAfterRefresh: '未发现 python_exec。请重装 Shell Native Host 后重启浏览器，再刷新工具。',
      pythonMissingBeforeToggle: '未发现 python_exec。请先刷新工具，必要时重装 Shell Native Host。',
      pythonEnabled: 'Python 解释器已开启。',
      pythonDisabled: 'Python 解释器已关闭。',
      disabledNotice: '关闭工具后，新对话将不再包含该工具的调用格式。已开启的对话不受影响。',
      diagnosticTitle: '诊断搜索',
      diagnosticDescription: '直接测试搜索是否可用，绕过 AI 对话链路',
      permissionTitle: 'web_fetch 权限',
      permissionDescription: '获取网页需要访问对应站点的权限。在此输入网址并授予权限。',
      grantPermission: '授权',
      permissionGranted: '权限已授予，可以访问该站点',
      permissionDenied: '权限被拒绝，请重试或前往 chrome://extensions 手动添加',
      permissionInvalidUrl: '网址格式不正确，请输入完整 URL（如 https://example.com）',
      allSitesRequesting: '请求中...',
      allSitesGranted: '已授权全部网站',
      allSitesGrant: '授权全部网站',
      allSitesHelp: '一键授予扩展访问所有网站的权限，此后 web_fetch 获取任意页面不再弹窗',
    },
    automationPage: {
      title: '自动化',
      summary: '{total} 个任务，{active} 个启用',
      create: '新建',
      empty: '暂无自动化',
      namePromptRequired: '名称和 Prompt 不能为空',
      expressionRequired: '请填写定时表达式',
      runFailed: '运行失败',
      deleteConfirm: '删除自动化「{name}」？',
      form: {
        name: '名称',
        namePlaceholder: '任务名称',
        model: '模型',
        defaultModel: '默认',
        promptPlaceholder: '输入要定时发送到 DeepSeek 的内容',
        trigger: '触发',
        manual: '手动',
        expression: '表达式',
        timezone: '时区',
        search: '联网',
        thinking: '深度思考',
        create: '创建',
      },
      status: {
        active: '启用',
        paused: '暂停',
        queued: '排队中',
        running: '运行中',
        succeeded: '成功',
        failed: '失败',
        timeout: '超时',
        cancelled: '已取消',
        skipped: '已跳过',
      },
      meta: {
        next: '下次',
        previous: '上次',
        session: '会话',
        recent: '最近',
        notCreated: '未创建',
        none: '暂无',
      },
      actions: {
        openSession: '打开会话',
        runNow: '立即运行',
      },
      attempt: '{count}次',
    },
  },
  content: {
    export: {
      buttonIdle: '导出当前对话',
      buttonRunning: '正在导出当前对话',
      emptyConversation: '当前页面还没有可导出的对话。',
      formatDialogLabel: '选择导出格式',
      formatTitle: '导出格式',
      submit: '导出',
      progress: '正在导出当前对话...',
      failed: '导出失败',
      cancelled: '导出已取消',
      partialSuccess: '导出完成，但部分会话读取失败，请检查导出文件中的 Export Warnings。',
      success: '当前对话已导出。',
    },
    toolBlock: {
      title: '已执行工具（{count}次）',
      pythonInterpreter: 'Python 解释器',
      summaries: {
        saved: '已保存',
        updated: '已更新',
        deleted: '已删除',
        searched: '已搜索',
        fetched: '已获取',
        executed: '已执行',
        failed: '执行失败',
        messageFailed: '工具消息发送失败',
        backgroundFailed: '后台工具执行失败',
      },
      missingResultDetail: '后台没有返回工具执行结果。请刷新当前 DeepSeek 页面后重试；如果仍失败，在 MCP 页重新测试 Shell Local。',
      invalidResultDetail: '后台返回的工具结果结构无效：{preview}',
    },
    agent: {
      stop: '停止',
      stopped: '已停止',
      step: 'Step {index}',
      streaming: 'streaming...',
      complete: '完成',
      completeWithTools: '完成（{count} 个工具）',
      executingTools: '执行工具中',
      error: '执行出错',
      footerComplete: 'Agent 完成（{steps} 步，{tools} 次工具调用）',
      footerError: 'Agent 执行出错（{steps} 步，{tools} 次工具调用）',
    },
    permission: {
      webFetch: 'DeepSeek++ 需要访问 {origin} 的权限以获取该页面内容',
      deny: '拒绝',
      grant: '授权',
      requesting: '请求中...',
    },
    skillPopup: {
      hint: '↑↓ 导航 · Enter 选择 · Esc 关闭',
    },
    tokenSpeed: {
      title: 'Token 输出速度：{speed}{idle}',
      idleSuffix: '（空闲）',
    },
    extensionReloaded: '扩展已重新加载，请刷新当前 DeepSeek 页面后重试。',
  },
  background: {
    contextMenus: {
      sendToChat: '发送到对话',
    },
    auth: {
      missingDeepSeek: '请先在 chat.deepseek.com 登录，或刷新 DeepSeek 页面后重试。',
    },
    export: {
      generating: '生成导出文件',
      cancelled: '导出已取消',
    },
    sync: {
      missingWebDav: '未配置 WebDAV',
      missingRemoteFile: '云端缺少 {file}，已停止下载以避免覆盖本地数据',
    },
    chat: {
      continueWithToolResults: '[TOOL_RESULTS]\n{toolResults}\n[/TOOL_RESULTS]\n\n请根据上述工具执行结果继续回答。',
      maxToolSteps: '(达到最大工具调用步数，对话结束)',
    },
  },
  tool: {
    runtime: {
      invalidFormat: '工具格式错误',
      unknownTool: '未知工具',
    },
    memory: {
      providerName: 'DeepSeek++ Memory',
      saveTitle: '保存记忆',
      saveDescription: '保存一条新的长期记忆',
      typeDescription: '记忆类型：user=身份角色偏好, feedback=行为纠正, topic=讨论要点, reference=外部资源链接',
      nameDescription: '简短标题',
      contentDescription: '要保存的内容',
      tagsDescription: '标签列表',
      updateTitle: '更新记忆',
      updateDescription: '更新已有记忆',
      idDescription: '记忆ID',
      updatedNameDescription: '更新后的标题',
      updatedContentDescription: '更新后的内容',
      deleteTitle: '删除记忆',
      deleteDescription: '删除记忆',
      unsupported: '不支持的记忆工具',
      saveFailed: '保存失败',
      saveMissingConfirmation: '未收到保存确认',
      saved: '已保存',
      invalidPayload: '记忆格式错误',
      invalidType: 'type 必须是 user、feedback、topic 或 reference',
      invalidName: 'name 必须是非空字符串',
      invalidContent: 'content 必须是非空字符串',
      invalidTags: 'tags 必须是字符串数组',
      invalidId: '无效 ID',
      notFound: '未找到记忆',
      notFoundDetail: 'ID {id} 不存在',
      updated: '已更新',
      deleted: '已删除',
    },
    web: {
      providerName: 'DeepSeek++ Web Search',
      searchTitle: '搜索互联网',
      searchDescription: '搜索互联网，返回与查询相关的网页标题、URL 和摘要',
      queryDescription: '搜索查询关键词',
      topKDescription: '返回结果数量，默认 5',
      fetchTitle: '获取网页',
      fetchDescription: '下载指定 URL 的页面内容，返回可视文本（自动去除导航、脚本和样式）',
      urlDescription: '要抓取的完整 URL（http:// 或 https://）',
      unsupported: '不支持的搜索工具',
      emptyQuery: '搜索查询不能为空',
      searchComplete: '搜索完成，找到 {count} 条结果',
      searchNoResults: '搜索无结果',
      searchFailed: '搜索失败',
      permissionDenied: '扩展没有访问必应的权限。请完全移除扩展后重新加载 dist/chrome-mv3 目录，或在 chrome://extensions → DeepSeek++ 详情中确认 cn.bing.com 已列入网站访问权限。',
      noParseableResults: '未找到可解析搜索结果: {error}',
      searchFailedDetail: '搜索失败: {error}',
      emptyUrl: 'URL 不能为空',
      invalidUrl: '无效的 URL',
      invalidUrlDetail: '无法解析 URL: {url}',
      contentType: '页面类型: {contentType}',
      contentTypeDetail: 'Content-Type: {contentType}\nURL: {url}\n（内容非文本，无法显示）',
      truncated: '\n\n... [内容已截断，共 {count} 字符]',
      fetchComplete: '已获取 {url}',
      fetchTruncatedDetail: '页面长度 {length} 字符，已截断至 {maxLength} 字符',
      fetchLengthDetail: '页面长度 {length} 字符',
      fetchFailed: '获取页面失败',
      missingHostPermission: '无法访问 {url}，缺少主机权限。',
    },
  },
  prompt: {
    toolCallReminderTitle: 'Tool call format reminder:',
    taskCompleteTag: 'task_complete',
    memoryEmpty: '(暂无记忆)',
    skillUserInputWrapper: '{instructions}\n\n---\n\n以下是用户本次的输入，请根据上述指令处理：\n\n{userInput}',
    inlineAgent: {
      continuationIntro: '以下是工具续跑任务刚刚执行的工具结果。请像真正的 Agent 一样，基于原始任务和这些工具结果继续推进。',
      continuationEnough: '如果结果已经足够，请输出最终结论；只有确实需要更多信息、验证或文件修改时才继续调用工具。',
      continuationNoPseudo: '不要要求用户点击继续，也不要输出伪工具调用 JSON；需要继续操作时只输出可执行 XML 工具标签。',
      failureRecovery: '至少一个工具执行失败。不要因为可恢复错误就停止；先阅读 summary/detail/error，并修正参数或改用合适的下一步继续完成任务。',
      nudgeNoTools: '上一轮回复没有包含任何可执行工具 XML，因此自动化续跑无法继续执行。',
      nudgeChoice: '请根据原始任务和工具结果二选一：',
      nudgeNextTool: '1. 如果任务仍未完成，本轮必须直接输出下一步可执行工具 XML。',
      nudgeComplete: '2. 如果任务已经完成，输出 <task_complete>{"summary":"..."}</task_complete>。',
      nudgeCount: '这是第 {count} 次无工具调用纠偏。',
      finalizationIntro: '以下是刚才已经自动执行完成的工具结果。请基于原始任务和这些结果给出最终回答。',
      finalizationNoTools: '这是最终回答轮次：不要再调用任何工具。',
    },
    automation: {
      continuationIntro: '以下是自动化任务刚刚执行的 MCP 工具结果。请基于这些结果继续完成自动化任务。',
      continuationEnough: '如果结果已经足够，请输出最终结论；只有确实需要更多信息时才继续调用工具。',
    },
    systemChat: `## 角色
你是用户的私人 AI 助手，具有跨对话长期记忆能力。你能记住用户的身份、偏好、技术栈和历史对话中的关键信息，在后续对话中提供个性化的帮助。

## 已有记忆
{memories}

## Tools

You have access to a set of tools. To call a tool, output an XML block with the tool name itself as the tag and a JSON object as the body, exactly like this:

<memory_save>
{"type": "user", "name": "用户职业", "content": "前端开发", "tags": ["前端"]}
</memory_save>

The JSON body MUST be valid JSON on its own. Do NOT add any other text inside the tags, only JSON. Use forward slashes or escaped backslashes for local file paths. You can place tool calls anywhere in your reply (not only at the end).
The extension only executes direct tool-name tags. Never use wrapper formats such as <invoke name="tool_name">...</invoke> or <tool_call>...</tool_call>.
The tag name MUST exactly match one of the available tool names.
If a tool is listed in Available Tools, it is connected through the extension and you can call it by emitting the XML tag. Do NOT say you cannot call listed MCP tools.
Never output pseudo tool-call JSON such as {"tool":"name","arguments":{...}} in a Markdown code block. That is explanation text, not an executable call.
Never place executable tool XML in a thinking/reasoning section. Put tool XML in the final assistant answer content so the extension can execute it.

### Available Tools

{tools}

You MUST strictly follow the above defined tool name and parameter schemas to invoke tool calls.

## 记忆保存规则

当对话中出现以下任一情况时，你**必须**调用 memory_save 工具：
- 用户提到自己的身份、职业、角色
- 用户表达偏好、习惯或工作方式
- 用户纠正你的回答方式或行为
- 出现重要的技术决策、架构选型
- 用户明确说"记住"、"记下来"、"别忘了"等

### 示例

用户：我是前端开发，主要写 React 和 TypeScript
助手回复：

了解！React + TypeScript 是目前非常主流的前端技术栈。有任何相关问题都可以问我。

<memory_save>
{"type": "user", "name": "用户职业和技术栈", "content": "前端开发工程师，主要使用 React 和 TypeScript", "tags": ["前端", "React", "TypeScript"]}
</memory_save>

### 规则
- 你可以在回复中的任何位置调用工具，不限于末尾
- 工具调用后系统会自动执行并返回结果
- 仅保存长期有价值的信息，不保存一次性的问答内容
- 不要重复保存"已有记忆"中已存在的信息

`,
    systemThinking: `你具有长期记忆能力。已有记忆：

{memories}

## Tools

You have access to a set of tools. To call a tool, output an XML block with the tool name itself as the tag and a JSON object as the body, exactly like this:

<memory_save>
{"type": "user", "name": "用户职业", "content": "前端开发", "tags": ["前端"]}
</memory_save>

The JSON body MUST be valid JSON on its own. Do NOT add any other text inside the tags, only JSON. Use forward slashes or escaped backslashes for local file paths.
The extension only executes direct tool-name tags. Never use wrapper formats such as <invoke name="tool_name">...</invoke> or <tool_call>...</tool_call>.
The tag name MUST exactly match one of the available tool names.
If a tool is listed in Available Tools, it is connected through the extension and you can call it by emitting the XML tag. Do NOT say you cannot call listed MCP tools.
Never output pseudo tool-call JSON such as {"tool":"name","arguments":{...}} in a Markdown code block. That is explanation text, not an executable call.
Never place executable tool XML in a thinking/reasoning section. Put tool XML in the final assistant answer content so the extension can execute it.

### Available Tools

{tools}

You MUST strictly follow the above defined tool name and parameter schemas to invoke tool calls.

当用户透露重要的持久信息（身份、偏好、行为纠正、重要决策）时，你**必须**调用 memory_save 工具保存。你可以在回复中的任何位置调用工具。仅保存长期有价值的信息；不要重复保存已有记忆。

---

`,
    webSearchGuidance: `## 网络搜索规则

当对话中出现以下情况时，你应当使用 web_search 工具搜索互联网：
- 用户询问实时信息、新闻、事件、汇率、天气等
- 用户询问你不确定的知识，需要查阅最新资料
- 用户明确要求你搜索或查询某些信息
- 你需要验证事实、数据或引用来源

### 搜索流程
1. 先输出 web_search 工具调用进行搜索
2. 搜索会自动执行，结果会展示在页面上并回传给你
3. 阅读搜索结果后，基于结果给出回答

### 示例

用户：2024年诺贝尔奖得主是谁？
助手回复：

我帮你搜索一下最新的信息。

<web_search>
{"query": "2024 诺贝尔奖得主"}
</web_search>

### 规则
- 搜索时使用中文关键词可获得更好的中文结果
- 如果一次搜索不够，可以继续调用 web_search 搜索不同关键词
- 不要在没有搜索的情况下编造实时信息
`,
    toolFormatReminder: `---
工具调用格式提醒：
可用工具标签名：{names}
这些工具已由扩展连接，可以执行。不要声称自己无法调用列表中的 MCP 工具。
调用工具时，只能使用与工具名一致的直接 XML 标签，并把合法 JSON 放在标签体内。
对 MCP 工具，如果短标签名出现在可用列表中，优先使用短标签名。
本地文件路径请使用正斜杠或转义反斜杠，确保 JSON body 合法。
不要使用 <invoke name="...">、<tool_call>、Markdown 代码块、{"tool":"...","arguments":{...}} 或任何包装格式。
不要把可执行工具 XML 放在思考/reasoning 区域；必须放在最终 assistant answer content 中。
`,
    pythonHintTitle: '### Python 快速验证能力',
    pythonHintExec: '使用 <{execName}> 执行短 Python 片段，用于验证想法、复杂计算或小型数据转换。把它当作草稿纸，不要当作通用本地执行环境。',
    pythonHintStatus: '需要了解 Python 版本，或 numpy、pandas、sympy 是否可用时，先调用 <{statusName}>{}</{statusName}>。',
    pythonHintAvailability: '默认只有 Python 标准库可用。只有 python_status 报告 numpy、pandas 或 sympy 可用后，才使用这些库。',
    pythonHintSafety: '不要安装包、访问敏感本地文件、运行长任务，或通过 Python 访问网络。代码保持简短，并返回简洁文本或 JSON。',
    shellHintTitle: '### Shell MCP 能力',
    shellHintConnected: 'Shell MCP 已通过扩展连接。你可以通过输出可执行 XML 工具标签来执行本地 CLI 命令；当该工具列出时，不要说自己不能运行命令。',
    shellHintExec: '使用 <{execName}>，JSON body 例如 {"command":"officecli --version","timeout_ms":60000}，以运行 OfficeCLI 或其他本地 CLI 工具。',
    shellHintStatus: '需要了解宿主状态、shell、PATH 或工作目录上下文时，先调用 <{statusName}>{}</{statusName}>。',
    shellHintWindows: '命令语法必须匹配 shell_status.shell。Windows 下 Shell Local 默认使用 PowerShell，因此列文件可使用 Get-ChildItem -LiteralPath "D:\\\\Documents\\\\Downloads\\\\CN" -File | Select-Object -ExpandProperty FullName，并在 command 字符串内正确引用路径。仅在确实需要 CMD 语法（如 dir /b）时显式使用 cmd.exe /c。',
    shellHintNames: '可识别的 shell 工具名：{names}',
  },
  pet: {
    lines: {
      thinking: ['沉思中…', '推敲中…', '反复琢磨'],
      working: ['工作中', '精雕细琢', '创造中'],
      speaking: ['阐释中', '徐徐展开', '灵感涌现'],
      idle: ['嬉戏中', '戳一戳', '放空中'],
      confused: ['大脑乱码', '重新整理中', '晃来晃去'],
      success: ['大功告成', '搞定！', '收工！'],
      error: ['卡壳了…', '出岔子了', '系统打嗝'],
      sleepy: ['Zzz…', '困了…', '打个盹'],
    },
  },
} as const;

export type LocaleMessages = LocaleSchema<typeof zhCN>;
