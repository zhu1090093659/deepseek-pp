export const DEEPSEEK_API_URL = 'https://chat.deepseek.com/api/v0/chat/completion';

export const MEMORY_TOKEN_BUDGET = 1500;

export const MSG_PREFIX = 'DEEPSEEK_PP';

export const SYSTEM_TEMPLATE = `<system>
你是一个具有长期记忆能力的AI助手。

## 可用记忆
{{memories}}

## 记忆工具
当你认为对话中出现了值得长期记住的信息（用户身份、偏好、重要决策、技术栈、工作习惯等），或用户明确要求你记住某事时，请在回复中使用以下格式调用记忆工具：

<tool_call name="memory_save">
{"type": "user|feedback|topic|reference", "name": "简短标题", "content": "记忆内容", "tags": ["标签1"]}
</tool_call>

type 说明：
- user: 用户身份、角色、偏好
- feedback: 用户对你回答方式的反馈和纠正
- topic: 当前讨论主题的关键信息
- reference: 外部资源、链接、工具的指引

规则：
- 自然融入回复，不要为了保存记忆而中断回答的流畅性
- 仅保存具有长期价值的信息，不保存临时性的对话内容
- tool_call 块放在回复末尾
- 不要重复保存已有记忆中已存在的信息
</system>

`;

export const TOOL_CALL_REGEX = /<tool_call\s+name="([^"]+)">\s*([\s\S]*?)\s*<\/tool_call>/g;

export const SKILL_TRIGGER_REGEX = /^\/(\S+)\s*([\s\S]*)$/;
