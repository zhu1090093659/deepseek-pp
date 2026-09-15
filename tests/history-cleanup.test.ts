import { describe, expect, it } from 'vitest';
import { stripToolCallsFromHistory } from '../core/interceptor/history-cleanup';
import { augmentRequestBody } from '../core/interceptor/request-augmentation';
import { createArtifactToolDescriptors } from '../core/artifact';
import { INLINE_AGENT_CONTINUATION_PLACEHOLDER, buildResumePrompt } from '../core/inline-agent/prompt';
import { createDefaultToolDescriptors } from '../core/tool';

describe('history cleanup', () => {
  it('restores the exact no-argument Skill command without exposing instructions', () => {
    const augmented = augmentRequestBody(JSON.stringify({
      prompt: '/shell',
      parent_message_id: null,
      thinking_enabled: false,
    }), {
      memories: [],
      skills: [{
        name: 'shell',
        instructions: 'Private Shell Skill instructions.',
        memoryEnabled: false,
      }],
      activePreset: null,
      modelType: null,
      toolDescriptors: [],
      messageCount: 0,
      locale: 'en',
    });
    const storedPrompt = JSON.parse(augmented?.body ?? '{}').prompt;
    const json = {
      data: {
        biz_data: {
          chat_messages: [{
            message_id: 0,
            message_role: 'user',
            content: storedPrompt,
          }],
        },
      },
    };

    stripToolCallsFromHistory(json, {
      toolDescriptors: createDefaultToolDescriptors(),
      onToolCallsRestored: () => undefined,
    });

    expect(json.data.biz_data.chat_messages[0].content).toBe('/shell');
  });

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

  it('hides auto-resume prompt nodes as internal turns on history restore', () => {
    // The auto-resume turn has no <tool_results> tag: detection must still
    // treat it as an internal continuation turn — kept in the chain but
    // placeholdered, never rendered as a visible user bubble.
    const json = {
      data: {
        biz_data: {
          chat_messages: [
            {
              message_id: 1,
              message_role: 'user',
              content: '整理这份报告',
            },
            {
              message_id: 2,
              message_role: 'assistant',
              parent_message_id: 1,
              content: '好的，我先处理数据。',
            },
            {
              message_id: 3,
              message_role: 'user',
              parent_message_id: 2,
              content: buildResumePrompt('整理这份报告', 1, 'zh-CN'),
            },
            {
              message_id: 4,
              message_role: 'assistant',
              parent_message_id: 3,
              content: '继续完成了报告。',
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
    expect(json.data.biz_data.chat_messages[3].content).toBe('继续完成了报告。');
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

  it('restores inline-agent xychart shorthand through the native Mermaid path', () => {
    const directChart = [
      '```xychart-beta',
      'title "Revenue"',
      'line [1, 2, 3]',
      '```',
      '',
      '```html',
      '<h1>Native HTML</h1>',
      '```',
    ].join('\n');
    const json = {
      data: {
        biz_data: {
          chat_messages: [
            {
              message_id: 50,
              message_role: 'user',
              content: [
                '以下是工具续跑任务刚刚执行的工具结果。请像真正的 Agent 一样继续推进。',
                '<original_task>生成图表</original_task>',
                '<tool_results>[]</tool_results>',
              ].join('\n'),
            },
            {
              message_id: 51,
              message_role: 'assistant',
              parent_message_id: 50,
              fragments: [
                { content: directChart.slice(0, 19) },
                { content: directChart.slice(19) },
              ],
            },
            {
              message_id: 52,
              message_role: 'assistant',
              parent_message_id: 49,
              content: directChart,
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
    const restoredFragments = json.data.biz_data.chat_messages[1].fragments as Array<{ content: string }>;
    expect(restoredFragments.map((fragment: { content: string }) => fragment.content).join('')).toBe([
      '```mermaid',
      'xychart-beta',
      'title "Revenue"',
      'line [1, 2, 3]',
      '```',
      '',
      '```html',
      '<h1>Native HTML</h1>',
      '```',
    ].join('\n'));
    expect(restoredFragments[1].content).toBe('');
    // Non-agent history is outside the normalization boundary.
    expect(json.data.biz_data.chat_messages[2].content).toBe(directChart);
  });

  it('preserves THINK and RESPONSE fragment roles while normalizing an inline-agent chart', () => {
    const reasoning = '先核验数据，再输出图表。';
    const response = [
      '```xychart-beta',
      'xychart-beta',
      'title "Revenue"',
      'line [1, 2, 3]',
      '```',
      '',
      '```html',
      '<h1>Native HTML</h1>',
      '```',
    ].join('\n');
    const json = {
      data: {
        biz_data: {
          chat_messages: [
            {
              message_id: 60,
              message_role: 'user',
              content: [
                '以下是工具续跑任务刚刚执行的工具结果。请像真正的 Agent 一样继续推进。',
                '<original_task>生成图表</original_task>',
                '<tool_results>[]</tool_results>',
              ].join('\n'),
            },
            {
              message_id: 61,
              message_role: 'assistant',
              parent_message_id: 60,
              fragments: [
                { id: 1, type: 'THINK', content: reasoning },
                { id: 2, type: 'RESPONSE', content: response.slice(0, 24) },
                { id: 3, type: 'RESPONSE', content: response.slice(24) },
              ],
            },
          ],
        },
      },
    };

    stripToolCallsFromHistory(json, {
      toolDescriptors: createDefaultToolDescriptors(),
      onToolCallsRestored: () => undefined,
    });

    const fragments = json.data.biz_data.chat_messages[1].fragments as Array<{
      type: string;
      content: string;
    }>;
    expect(fragments[0]).toMatchObject({ type: 'THINK', content: reasoning });
    expect(fragments.slice(1).map((fragment) => fragment.content).join('')).toBe([
      '```mermaid',
      'xychart-beta',
      'title "Revenue"',
      'line [1, 2, 3]',
      '```',
      '',
      '```html',
      '<h1>Native HTML</h1>',
      '```',
    ].join('\n'));
    expect(fragments[1].type).toBe('RESPONSE');
    expect(fragments[2]).toMatchObject({ type: 'RESPONSE', content: '' });
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

  it('strips an unclosed huge artifact payload from restored history without creating a tool card', () => {
    const records: unknown[] = [];
    const json = {
      data: {
        biz_data: {
          chat_messages: [
            {
              message_id: 21,
              message_role: 'assistant',
              content: [
                '正在生成演示文稿。',
                '<artifact_create>',
                '{"filename":"demo.pptx","content":"',
                'A'.repeat(250_000),
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

    expect(json.data.biz_data.chat_messages[0].content).toBe('正在生成演示文稿。');
    expect(records).toEqual([]);
  });

  it('strips an unclosed whitespace-padded artifact across history fragments', () => {
    const records: unknown[] = [];
    const json = {
      data: {
        biz_data: {
          chat_messages: [
            {
              message_id: 22,
              message_role: 'assistant',
              fragments: [
                { content: '正在生成演示文稿。\n< artifact' },
                { content: '_create >{"filename":"demo.pptx","content":"' },
                { content: 'A'.repeat(250_000) },
              ],
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

    const fragments = json.data.biz_data.chat_messages[0].fragments;
    expect(fragments.map((fragment: { content: string }) => fragment.content).join('')).toBe('正在生成演示文稿。');
    expect(records).toEqual([]);
  });

  it('restores and strips a completed artifact whose tags cross history fragments', () => {
    const records: any[] = [];
    const json = {
      data: {
        biz_data: {
          chat_messages: [
            {
              message_id: 23,
              message_role: 'assistant',
              fragments: [
                { content: 'Before <artifact_' },
                { content: 'create>{"filename":"demo.txt","content":"ok"}</artifact_' },
                { content: 'create> after' },
              ],
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

    const fragments = json.data.biz_data.chat_messages[0].fragments;
    expect(fragments.map((fragment: { content: string }) => fragment.content).join('')).toBe('Before  after');
    expect(records).toHaveLength(1);
    expect(records[0].calls[0]).toMatchObject({
      name: 'artifact_create',
      payload: { filename: 'demo.txt', content: 'ok' },
    });
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
