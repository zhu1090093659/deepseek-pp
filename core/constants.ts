import {
  DEFAULT_TOOL_DESCRIPTORS,
  createToolInvocationCatalog,
  createXmlToolCallRegex,
} from './tool/invocation';

export const DEEPSEEK_API_URL = 'https://chat.deepseek.com/api/v0/chat/completion';

export const MEMORY_TOKEN_BUDGET = 1500;

export const PRESET_REINJECTION_INTERVAL = 10;

export const MSG_PREFIX = 'DEEPSEEK_PP';

export const DPP_MANAGED_AGENT_PROMPT_MARKER = '<!-- deepseek-pp-managed-agent-runner:v1 -->';

export const DSML = '｜DSML｜';

export const TOOL_NAMES = DEFAULT_TOOL_DESCRIPTORS.map((tool) => tool.invocationName);
export type ToolName = string;

export const MEMORY_SAVE_SCHEMA = '{"type": "function", "function": {"name": "memory_save", "description": "保存一条新的长期记忆", "parameters": {"type": "object", "properties": {"type": {"type": "string", "enum": ["user", "feedback", "topic", "reference"], "description": "记忆类型：user=身份角色偏好, feedback=行为纠正, topic=讨论要点, reference=外部资源链接"}, "name": {"type": "string", "description": "简短标题"}, "content": {"type": "string", "description": "要保存的内容"}, "tags": {"type": "array", "items": {"type": "string"}, "description": "标签列表"}}, "required": ["type", "name", "content", "tags"]}}}';

export const MEMORY_UPDATE_SCHEMA = '{"type": "function", "function": {"name": "memory_update", "description": "更新已有记忆", "parameters": {"type": "object", "properties": {"id": {"type": "integer", "description": "记忆ID"}, "type": {"type": "string", "enum": ["user", "feedback", "topic", "reference"], "description": "记忆类型"}, "name": {"type": "string", "description": "更新后的标题"}, "content": {"type": "string", "description": "更新后的内容"}, "tags": {"type": "array", "items": {"type": "string"}, "description": "标签列表"}}, "required": ["id", "type", "name", "content", "tags"]}}}';

export const MEMORY_DELETE_SCHEMA = '{"type": "function", "function": {"name": "memory_delete", "description": "删除记忆", "parameters": {"type": "object", "properties": {"id": {"type": "integer", "description": "记忆ID"}}, "required": ["id"]}}}';

export const SYSTEM_TEMPLATE_CHAT = `## 角色
你是用户的私人 AI 助手，具有跨对话记忆能力。

## 记忆
{{memories}}

## Tools

调用工具时，以工具名为 XML 标签、JSON 为 body：

<memory_save>
{"type":"user","name":"用户职业","content":"前端开发","tags":["前端"]}
</memory_save>

规则：
- 标签名必须与工具名完全一致；JSON body 必须是合法独立 JSON
- 文件路径用正斜杠或转义反斜杠
- 禁止使用包装格式（<invoke>、<tool_call>、代码块、{"tool":...}）
- 工具 XML 不可放在 thinking/reasoning 区域
- 可在回复任意位置调用工具

### 可用工具

{{tools}}

## 记忆规则

用户透露身份、偏好、纠正、重要决策或说"记住"时，调用 memory_save 保存。仅保存长期价值信息，不重复已有记忆。

`;

export const SYSTEM_TEMPLATE_THINKING = `你具有跨对话记忆能力。已有记忆：

{{memories}}

## Tools

调用工具时，以工具名为 XML 标签、JSON 为 body：

<memory_save>
{"type":"user","name":"用户职业","content":"前端开发","tags":["前端"]}
</memory_save>

规则：
- 标签名必须与工具名完全一致；JSON body 必须是合法独立 JSON
- 文件路径用正斜杠或转义反斜杠
- 禁止使用包装格式（<invoke>、<tool_call>、代码块、{"tool":...}）
- 工具 XML 不可放在 thinking/reasoning 区域
- 可在回复任意位置调用工具

### 可用工具

{{tools}}

用户透露身份、偏好、纠正、重要决策时，调用 memory_save 保存。仅保存长期价值信息。

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

// XML-style tool call regex: <tool_name>JSON</tool_name>
export const TOOL_CALL_REGEX = createXmlToolCallRegex(createToolInvocationCatalog(DEFAULT_TOOL_DESCRIPTORS));

export const SKILL_TRIGGER_REGEX = /^\/(\S+)\s*([\s\S]*)$/;
