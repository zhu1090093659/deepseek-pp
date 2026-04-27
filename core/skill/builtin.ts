import type { Skill } from '../types';

export const BUILTIN_SKILLS: Skill[] = [
  {
    name: 'memory',
    trigger: '/memory',
    description: '记忆管理：/memory save <内容> | /memory list | /memory delete <id>',
    promptTemplate:
      '用户请求管理记忆。请根据以下指令操作：\n\n{{content}}\n\n如果是保存操作，请分析内容并使用 memory_save 工具保存。如果是列出操作，请列出所有当前可用的记忆。如果是删除操作，确认删除目标。',
    memoryEnabled: true,
    builtIn: true,
  },
  {
    name: 'translate',
    trigger: '/translate',
    description: '翻译文本',
    promptTemplate: '请翻译以下内容为英文，保持原始格式和语义：\n\n{{content}}',
    memoryEnabled: false,
    builtIn: true,
  },
  {
    name: 'explain',
    trigger: '/explain',
    description: '解释概念或代码',
    promptTemplate:
      '请深入浅出地解释以下内容，使用类比和示例帮助理解：\n\n{{content}}',
    memoryEnabled: true,
    builtIn: true,
  },
  {
    name: 'summarize',
    trigger: '/summarize',
    description: '总结文本',
    promptTemplate:
      '请对以下内容进行结构化总结，提取关键要点：\n\n{{content}}',
    memoryEnabled: false,
    builtIn: true,
  },
];
