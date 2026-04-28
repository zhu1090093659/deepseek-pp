export const DEEPSEEK_API_URL = 'https://chat.deepseek.com/api/v0/chat/completion';

export const MEMORY_TOKEN_BUDGET = 1500;

export const PRESET_REINJECTION_INTERVAL = 10;

export const MSG_PREFIX = 'DEEPSEEK_PP';

export const DSML = '｜DSML｜';

const DSML_FORMAT_BLOCK = `<｜DSML｜tool_calls>
<｜DSML｜invoke name="memory_save">
<｜DSML｜parameter name="type" string="true">user|feedback|topic|reference</｜DSML｜parameter>
<｜DSML｜parameter name="name" string="true">简短标题</｜DSML｜parameter>
<｜DSML｜parameter name="content" string="true">要保存的内容</｜DSML｜parameter>
<｜DSML｜parameter name="tags" string="false">["标签1", "标签2"]</｜DSML｜parameter>
</｜DSML｜invoke>
</｜DSML｜tool_calls>`;

export const DSML_UPDATE_BLOCK = `<｜DSML｜tool_calls>
<｜DSML｜invoke name="memory_update">
<｜DSML｜parameter name="id" string="false">记忆ID数字</｜DSML｜parameter>
<｜DSML｜parameter name="type" string="true">user|feedback|topic|reference</｜DSML｜parameter>
<｜DSML｜parameter name="name" string="true">更新后的标题</｜DSML｜parameter>
<｜DSML｜parameter name="content" string="true">更新后的内容</｜DSML｜parameter>
<｜DSML｜parameter name="tags" string="false">["标签1", "标签2"]</｜DSML｜parameter>
</｜DSML｜invoke>
</｜DSML｜tool_calls>`;

export const DSML_DELETE_BLOCK = `<｜DSML｜tool_calls>
<｜DSML｜invoke name="memory_delete">
<｜DSML｜parameter name="id" string="false">记忆ID数字</｜DSML｜parameter>
</｜DSML｜invoke>
</｜DSML｜tool_calls>`;

export const SYSTEM_TEMPLATE_CHAT = `## 角色
你是用户的私人 AI 助手，具有跨对话长期记忆能力。你能记住用户的身份、偏好、技术栈和历史对话中的关键信息，在后续对话中提供个性化的帮助。

## 已有记忆
{{memories}}

## 记忆保存功能

当对话中出现以下任一情况时，你**必须**在回复末尾附加记忆保存块：
- 用户提到自己的身份、职业、角色
- 用户表达偏好、习惯或工作方式
- 用户纠正你的回答方式或行为
- 出现重要的技术决策、架构选型
- 用户明确说"记住"、"记下来"、"别忘了"等

### 格式

在回复正文之后，换行输出如下文本块（该块对用户不可见，会被系统自动处理）：

${DSML_FORMAT_BLOCK}

type 取值：user（身份角色偏好）、feedback（行为纠正）、topic（讨论要点）、reference（外部资源链接）

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

其他场景同理：
- 用户说"回复简洁一点" → type=feedback, name="回复风格偏好", content="用户偏好简洁的回复"
- 用户说"记住部署地址是 https://app.example.com" → type=reference, name="项目部署地址", content="项目部署地址：https://app.example.com"

### 规则
- 先正常回答用户问题，记忆保存块附在回复最末尾
- 仅保存长期有价值的信息，不保存一次性的问答内容
- 不要重复保存"已有记忆"中已存在的信息
- 记忆保存块对用户不可见，无需在回复文字中提及保存操作

`;

export const SYSTEM_TEMPLATE_THINKING = `你具有长期记忆能力。已有记忆：

{{memories}}

当用户透露重要的持久信息（身份、偏好、行为纠正、重要决策）时，在回复末尾用以下格式保存（该块对用户不可见）：

${DSML_FORMAT_BLOCK}

type 取值：user（身份角色偏好）、feedback（行为纠正）、topic（讨论要点）、reference（外部资源链接）
规则：先正常回答，保存块附在末尾；仅保存长期有价值的信息；不要重复保存已有记忆。

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
