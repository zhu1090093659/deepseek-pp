export const DEEPSEEK_API_URL = 'https://chat.deepseek.com/api/v0/chat/completion';

export const MEMORY_TOKEN_BUDGET = 1500;

export const MSG_PREFIX = 'DEEPSEEK_PP';

export const DSML = '｜DSML｜';

export const SYSTEM_TEMPLATE = `## 角色
你是一个具有长期记忆能力的AI助手。

## 可用记忆
{{memories}}

## 记忆工具
当你认为对话中出现了值得长期记住的信息（用户身份、偏好、重要决策、技术栈、工作习惯等），或用户明确要求你记住某事时，请在回复中使用以下格式调用记忆工具：

<｜DSML｜tool_calls>
<｜DSML｜invoke name="memory_save">
<｜DSML｜parameter name="type" string="true">user|feedback|topic|reference</｜DSML｜parameter>
<｜DSML｜parameter name="name" string="true">简短标题</｜DSML｜parameter>
<｜DSML｜parameter name="content" string="true">记忆内容</｜DSML｜parameter>
<｜DSML｜parameter name="tags" string="false">["标签1"]</｜DSML｜parameter>
</｜DSML｜invoke>
</｜DSML｜tool_calls>

type 说明：
- user: 用户身份、角色、偏好
- feedback: 用户对你回答方式的反馈和纠正
- topic: 当前讨论主题的关键信息
- reference: 外部资源、链接、工具的指引

规则：
- 自然融入回复，不要为了保存记忆而中断回答的流畅性
- 仅保存具有长期价值的信息，不保存临时性的对话内容
- tool_calls 块放在回复末尾
- 不要重复保存已有记忆中已存在的信息

`;

export const TOOL_CALLS_BLOCK_REGEX = /<｜DSML｜tool_calls>\s*[\s\S]*?\s*<\/｜DSML｜tool_calls>/g;
export const INVOKE_REGEX = /<｜DSML｜invoke name="([^"]+)">\s*([\s\S]*?)\s*<\/｜DSML｜invoke>/g;
export const PARAMETER_REGEX = /<｜DSML｜parameter name="([^"]+)" string="(true|false)">([\s\S]*?)<\/｜DSML｜parameter>/g;

export const SKILL_TRIGGER_REGEX = /^\/(\S+)\s*([\s\S]*)$/;
