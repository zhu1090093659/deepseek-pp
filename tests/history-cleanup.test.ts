import { describe, expect, it } from 'vitest';
import { stripToolCallsFromHistory } from '../core/interceptor/history-cleanup';
import { createArtifactToolDescriptors } from '../core/artifact';
import { INLINE_AGENT_CONTINUATION_PLACEHOLDER } from '../core/inline-agent/prompt';
import { createDefaultToolDescriptors } from '../core/tool';

describe('history cleanup', () => {
  it('keeps inline-agent continuation prompt nodes but marks them as hidden internal turns', () => {
    const json = {
      data: {
        biz_data: {
          chat_messages: [
            {
              message_id: 1,
              message_role: 'user',
              content: '看一下深圳的房价',
            },
            {
              message_id: 2,
              message_role: 'assistant',
              parent_message_id: 1,
              content: '我帮你查一下深圳最近的房价情况。',
            },
            {
              message_id: 3,
              message_role: 'user',
              content: [
                '以下是工具续跑任务刚刚执行的工具结果。请像真正的 Agent 一样继续推进。',
                '',
                '<original_task>',
                '看一下深圳的房价',
                '</original_task>',
                '',
                '<tool_results>',
                '[]',
                '</tool_results>',
              ].join('\n'),
            },
            {
              message_id: 4,
              message_role: 'assistant',
              parent_message_id: 3,
              content: '根据最新市场数据，深圳房价如下。',
            },
          ],
        },
      },
    };

    stripToolCallsFromHistory(json, {
      toolDescriptors: createDefaultToolDescriptors(),
      onToolCallsRestored: () => undefined,
    });

    expect(json.data.biz_data.chat_messages.map((message: { message_id: number }) => message.message_id)).toEqual([1, 2, 3, 4]);
    expect(json.data.biz_data.chat_messages[2].content).toBe(INLINE_AGENT_CONTINUATION_PLACEHOLDER);
    expect(json.data.biz_data.chat_messages[3].parent_message_id).toBe(3);
  });

  it('adds assistant message anchors to restored tool-call records', () => {
    const records: unknown[] = [];
    const json = {
      data: {
        biz_data: {
          chat_messages: [
            {
              message_id: 10,
              message_role: 'user',
              content: 'Save this',
            },
            {
              message_id: 11,
              message_role: 'assistant',
              parent_message_id: 10,
              content: [
                'Saved.',
                '<memory_save>',
                '{"type":"topic","name":"anchor","content":"ok","tags":[]}',
                '</memory_save>',
              ].join('\n'),
            },
          ],
        },
      },
    };

    stripToolCallsFromHistory(json, {
      toolDescriptors: createDefaultToolDescriptors(),
      onToolCallsRestored: (next) => records.push(...next),
    });

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      metadata: {
        messageId: 11,
        parentMessageId: 10,
        assistantMessageIndex: 0,
        role: 'assistant',
      },
    });
  });

  it('strips inline-agent continuation assistant tool calls without restoring duplicate tool blocks', () => {
    const records: unknown[] = [];
    const json = {
      data: {
        biz_data: {
          chat_messages: [
            {
              message_id: 21,
              message_role: 'user',
              content: '查一下港股行情',
            },
            {
              message_id: 22,
              message_role: 'assistant',
              parent_message_id: 21,
              content: '我帮你搜索一下港股最新行情。',
            },
            {
              message_id: 23,
              message_role: 'user',
              parent_message_id: 22,
              content: [
                '以下是工具续跑任务刚刚执行的工具结果。请像真正的 Agent 一样继续推进。',
                '',
                '<original_task>',
                '查一下港股行情',
                '</original_task>',
                '',
                '<tool_results>',
                '[]',
                '</tool_results>',
              ].join('\n'),
            },
            {
              message_id: 24,
              message_role: 'assistant',
              parent_message_id: 23,
              content: [
                '，需要重新获取页面。',
                '<web_fetch>',
                '{"url":"https://example.com/hk"}',
                '</web_fetch>',
              ].join('\n'),
            },
          ],
        },
      },
    };

    stripToolCallsFromHistory(json, {
      toolDescriptors: createDefaultToolDescriptors(),
      onToolCallsRestored: (next) => records.push(...next),
    });

    expect(records).toHaveLength(0);
    expect(json.data.biz_data.chat_messages[2].content).toBe(INLINE_AGENT_CONTINUATION_PLACEHOLDER);
    expect(json.data.biz_data.chat_messages[3].content).toBe('，需要重新获取页面。');
  });

  it('replaces inline-agent task_complete markers with their summary in restored history', () => {
    const json = {
      data: {
        biz_data: {
          chat_messages: [
            {
              message_id: 39,
              message_role: 'user',
              content: [
                '以下是工具续跑任务刚刚执行的工具结果。请像真正的 Agent 一样继续推进。',
                '',
                '<original_task>',
                '整理回答',
                '</original_task>',
                '',
                '<tool_results>',
                '[]',
                '</tool_results>',
              ].join('\n'),
            },
            {
              message_id: 40,
              message_role: 'assistant',
              parent_message_id: 39,
              content: '<task_complete>{"summary":"回答已经整理完成。","artifacts":[]}</task_complete>',
            },
          ],
        },
      },
    };

    stripToolCallsFromHistory(json, {
      toolDescriptors: createDefaultToolDescriptors(),
      onToolCallsRestored: () => undefined,
    });

    expect(json.data.biz_data.chat_messages[0].content).toBe(INLINE_AGENT_CONTINUATION_PLACEHOLDER);
    expect(json.data.biz_data.chat_messages[1].content).toBe('回答已经整理完成。');
  });

  it('preserves user-authored task_complete examples in restored history', () => {
    const content = '<task_complete>{"summary":"保留原始示例。","artifacts":[]}</task_complete>';
    const json = {
      data: {
        biz_data: {
          chat_messages: [
            {
              message_id: 41,
              message_role: 'user',
              content,
            },
          ],
        },
      },
    };

    stripToolCallsFromHistory(json, {
      toolDescriptors: createDefaultToolDescriptors(),
      onToolCallsRestored: () => undefined,
    });

    expect(json.data.biz_data.chat_messages[0].content).toBe(content);
  });

  it('preserves non-inline-agent assistant task_complete examples in restored history', () => {
    const content = 'Example: <task_complete>{"summary":"保留原始示例。","artifacts":[]}</task_complete>';
    const json = {
      data: {
        biz_data: {
          chat_messages: [
            {
              message_id: 42,
              message_role: 'assistant',
              parent_message_id: 41,
              content,
            },
          ],
        },
      },
    };

    stripToolCallsFromHistory(json, {
      toolDescriptors: createDefaultToolDescriptors(),
      onToolCallsRestored: () => undefined,
    });

    expect(json.data.biz_data.chat_messages[0].content).toBe(content);
  });

  it('does not parse or pass huge artifact payloads back through restore records', () => {
    const records: any[] = [];
    const html = '<!doctype html><html><body>' + 'x'.repeat(250_000) + '</body></html>';
    const json = {
      data: {
        biz_data: {
          chat_messages: [
            {
              message_id: 20,
              message_role: 'assistant',
              content: [
                'Created < draft.',
                '<artifact_create>',
                JSON.stringify({
                  filename: 'demo.html',
                  content: html,
                  mimeType: 'text/html',
                }),
                '</artifact_create>',
              ].join('\n'),
            },
          ],
        },
      },
    };

    stripToolCallsFromHistory(json, {
      toolDescriptors: [
        ...createDefaultToolDescriptors(),
        ...createArtifactToolDescriptors(),
      ],
      onToolCallsRestored: (next) => records.push(...next),
    });

    expect(json.data.biz_data.chat_messages[0].content).toBe('Created < draft.');
    expect(records).toHaveLength(1);
    expect(records[0].content).toBe('Created < draft.');
    expect(records[0].calls[0].name).toBe('artifact_create');
    expect(records[0].calls[0].raw).toBe('<artifact_create>\n...[restore payload omitted]\n</artifact_create>');
    expect(records[0].calls[0].payload).toEqual({});
  });

  it('strips huge legacy DSML blocks without parsing their payload content', () => {
    const records: any[] = [];
    const json = {
      data: {
        biz_data: {
          chat_messages: [
            {
              message_id: 30,
              message_role: 'assistant',
              content: [
                'Saved.',
                '<｜DSML｜tool_calls>',
                '<｜DSML｜invoke name="memory_save">',
                '<｜DSML｜parameter name="name" string="true">',
                'n'.repeat(130_000),
                '</｜DSML｜parameter>',
                '</｜DSML｜invoke>',
                '</｜DSML｜tool_calls>',
              ].join(''),
            },
          ],
        },
      },
    };

    stripToolCallsFromHistory(json, {
      toolDescriptors: createDefaultToolDescriptors(),
      onToolCallsRestored: (next) => records.push(...next),
    });

    expect(json.data.biz_data.chat_messages[0].content).toBe('Saved.');
    expect(records).toHaveLength(1);
    expect(records[0].calls[0].name).toBe('memory_save');
    expect(records[0].calls[0].raw).toBe('<memory_save>\n...[restore payload omitted]\n</memory_save>');
    expect(records[0].calls[0].payload).toEqual({});
  });
});
