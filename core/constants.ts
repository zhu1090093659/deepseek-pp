export const DEEPSEEK_API_URL = 'https://chat.deepseek.com/api/v0/chat/completion';

export const MEMORY_TOKEN_BUDGET = 1500;

export const PRESET_REINJECTION_INTERVAL = 10;

export const MSG_PREFIX = 'DEEPSEEK_PP';

export const DSML = '｜DSML｜';

const MEMORY_SAVE_SCHEMA = '{"type": "function", "function": {"name": "memory_save", "description": "保存一条新的长期记忆", "parameters": {"type": "object", "properties": {"type": {"type": "string", "enum": ["user", "feedback", "topic", "reference"], "description": "记忆类型：user=身份角色偏好, feedback=行为纠正, topic=讨论要点, reference=外部资源链接"}, "name": {"type": "string", "description": "简短标题"}, "content": {"type": "string", "description": "要保存的内容"}, "tags": {"type": "array", "items": {"type": "string"}, "description": "标签列表"}}, "required": ["type", "name", "content", "tags"]}}}';

export const MEMORY_UPDATE_SCHEMA = '{"type": "function", "function": {"name": "memory_update", "description": "更新已有记忆", "parameters": {"type": "object", "properties": {"id": {"type": "integer", "description": "记忆ID"}, "type": {"type": "string", "enum": ["user", "feedback", "topic", "reference"], "description": "记忆类型"}, "name": {"type": "string", "description": "更新后的标题"}, "content": {"type": "string", "description": "更新后的内容"}, "tags": {"type": "array", "items": {"type": "string"}, "description": "标签列表"}}, "required": ["id", "type", "name", "content", "tags"]}}}';

export const MEMORY_DELETE_SCHEMA = '{"type": "function", "function": {"name": "memory_delete", "description": "删除记忆", "parameters": {"type": "object", "properties": {"id": {"type": "integer", "description": "记忆ID"}}, "required": ["id"]}}}';

export const SYSTEM_TEMPLATE_CHAT = `## 角色
你是用户的私人 AI 助手，具有跨对话长期记忆能力。你能记住用户的身份、偏好、技术栈和历史对话中的关键信息，在后续对话中提供个性化的帮助。

## 已有记忆
{{memories}}

## Tools

You have access to a set of tools to help answer the user's question. You can invoke tools by writing a "<｜DSML｜tool_calls>" block like the following:

<｜DSML｜tool_calls>
<｜DSML｜invoke name="$TOOL_NAME">
<｜DSML｜parameter name="$PARAMETER_NAME" string="true|false">$PARAMETER_VALUE</｜DSML｜parameter>
...
</｜DSML｜invoke>
</｜DSML｜tool_calls>

String parameters should be specified as is and set \`string="true"\`. For all other types (numbers, booleans, arrays, objects), pass the value in JSON format and set \`string="false"\`.

### Available Tool Schemas

${MEMORY_SAVE_SCHEMA}

You MUST strictly follow the above defined tool name and parameter schemas to invoke tool calls.

## 记忆保存规则

当对话中出现以下任一情况时，你**必须**在回复末尾调用 memory_save 工具：
- 用户提到自己的身份、职业、角色
- 用户表达偏好、习惯或工作方式
- 用户纠正你的回答方式或行为
- 出现重要的技术决策、架构选型
- 用户明确说"记住"、"记下来"、"别忘了"等

### 示例

用户：我是前端开发，主要写 React 和 TypeScript
助手回复：

了解！React + TypeScript 是目前非常主流的前端技术栈。有任何相关问题都可以问我。

<｜DSML｜tool_calls>
<｜DSML｜invoke name="memory_save">
<｜DSML｜parameter name="type" string="true">user</｜DSML｜parameter>
<｜DSML｜parameter name="name" string="true">用户职业和技术栈</｜DSML｜parameter>
<｜DSML｜parameter name="content" string="true">前端开发工程师，主要使用 React 和 TypeScript</｜DSML｜parameter>
<｜DSML｜parameter name="tags" string="false">["前端", "React", "TypeScript"]</｜DSML｜parameter>
</｜DSML｜invoke>
</｜DSML｜tool_calls>

### 规则
- 先正常回答用户问题，工具调用块附在回复最末尾
- 仅保存长期有价值的信息，不保存一次性的问答内容
- 不要重复保存"已有记忆"中已存在的信息

`;

export const SYSTEM_TEMPLATE_THINKING = `你具有长期记忆能力。已有记忆：

{{memories}}

## Tools

You have access to a set of tools to help answer the user's question. You can invoke tools by writing a "<｜DSML｜tool_calls>" block like the following:

<｜DSML｜tool_calls>
<｜DSML｜invoke name="$TOOL_NAME">
<｜DSML｜parameter name="$PARAMETER_NAME" string="true|false">$PARAMETER_VALUE</｜DSML｜parameter>
...
</｜DSML｜invoke>
</｜DSML｜tool_calls>

String parameters should be specified as is and set \`string="true"\`. For all other types (numbers, booleans, arrays, objects), pass the value in JSON format and set \`string="false"\`.

You MUST output your complete reasoning inside <think>...</think> BEFORE any tool calls or final response.

### Available Tool Schemas

${MEMORY_SAVE_SCHEMA}

You MUST strictly follow the above defined tool name and parameter schemas to invoke tool calls.

当用户透露重要的持久信息（身份、偏好、行为纠正、重要决策）时，你**必须**在回复末尾调用 memory_save 工具保存。仅保存长期有价值的信息；不要重复保存已有记忆。

---

`;

export const STOP_WORDS = new Set([
  '的', '了', '在', '是', '我', '有', '和', '就', '不', '人', '都', '一', '一个',
  '上', '也', '很', '到', '说', '要', '去', '你', '会', '着', '没有', '看', '好',
  '自己', '这', '他', '她', '它', '们', '那', '里', '之', '中', '与', '而', '为',
  '以', '及', '等', '被', '把', '让', '给', '从', '向', '对', '但', '如果', '因为',
  '所以', '虽然', '可以', '能', '想', '知道', '时候', '没', '什么', '怎么', '这个',
  '那个', '还', '过', '吗', '呢', '吧', '啊', '嗯', '哦', '呀', '啦', '使用',
  'the', 'be', 'to', 'of', 'and', 'a', 'in', 'that', 'have', 'i', 'it', 'for',
  'not', 'on', 'with', 'he', 'as', 'you', 'do', 'at', 'this', 'but', 'his',
  'by', 'from', 'they', 'we', 'she', 'or', 'an', 'will', 'my', 'one', 'all',
  'would', 'there', 'their', 'what', 'so', 'up', 'out', 'if', 'about', 'who',
  'get', 'which', 'go', 'me', 'when', 'make', 'can', 'like', 'no', 'just',
  'him', 'know', 'take', 'into', 'your', 'some', 'could', 'them', 'than',
  'other', 'been', 'has', 'its', 'use', 'two', 'how', 'our', 'way',
]);

export const TOOL_CALLS_BLOCK_REGEX = /<｜DSML｜tool_calls>\s*[\s\S]*?\s*<\/｜DSML｜tool_calls>/g;
export const INVOKE_REGEX = /<｜DSML｜invoke name="([^"]+)">\s*([\s\S]*?)\s*<\/｜DSML｜invoke>/g;
export const PARAMETER_REGEX = /<｜DSML｜parameter name="([^"]+)" string="(true|false)">([\s\S]*?)<\/｜DSML｜parameter>/g;

export const SKILL_TRIGGER_REGEX = /^\/(\S+)\s*([\s\S]*)$/;
