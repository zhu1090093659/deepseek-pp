import { describe, expect, it } from 'vitest';
import { createArtifactToolDescriptors } from '../core/artifact';
import { extractLegacyToolCalls, extractToolCalls, replaceToolCallsWithSummary, stripToolCalls } from '../core/interceptor/tool-parser';
import { MISMATCHED_TOOL_CALL_ERROR_CODE } from '../core/tool/execution-error';
import { createStreamingToolCallParser } from '../core/interceptor/streaming-tool-call-parser';

/**
 * Task: recover mismatched-close tool calls as parseError records
 * (tool_call_close_mismatched) across all parser surfaces. Recovery is
 * BOUNDED: only when a terminator (known closing tag, legacy/plain
 * `</invoke>`, or the next known open tag) exists; pure unterminated blocks
 * keep the previous behavior (skipped / tool_call_incomplete on flush).
 */
describe('mismatched-close tool call recovery', () => {
  const descriptors = createArtifactToolDescriptors('en');

  it('recovers a call closed by a foreign tag with a single parseError record', () => {
    const text = 'Before <artifact_create>{"filename":"a.txt","content":"x"}</invoke> after';
    const calls = extractToolCalls(text, { descriptors });

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      invocationName: 'artifact_create',
      payload: { filename: 'a.txt', content: 'x' },
      raw: '<artifact_create>{"filename":"a.txt","content":"x"}</invoke>',
      parseError: {
        code: MISMATCHED_TOOL_CALL_ERROR_CODE,
        retryable: false,
      },
    });
    expect(calls[0].parseError?.message).toContain('</invoke>');
  });

  it('keeps an empty payload when the recovered body is not JSON (no compound errors)', () => {
    const text = '<artifact_create>not-json</invoke>';
    const calls = extractToolCalls(text, { descriptors });

    expect(calls).toHaveLength(1);
    expect(calls[0].payload).toEqual({});
    expect(calls[0].parseError?.code).toBe(MISMATCHED_TOOL_CALL_ERROR_CODE);
  });

  it('yields 2 calls for parallel blocks where only the first is mismatched', () => {
    const text = [
      '<artifact_create>{"filename":"a.txt"}</invoke>',
      '<artifact_bundle_create>{"filename":"b.zip","files":[]}</artifact_bundle_create>',
    ].join('');
    const calls = extractToolCalls(text, { descriptors });

    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatchObject({
      invocationName: 'artifact_create',
      payload: { filename: 'a.txt' },
      parseError: { code: MISMATCHED_TOOL_CALL_ERROR_CODE },
    });
    expect(calls[1]).toMatchObject({
      invocationName: 'artifact_bundle_create',
      payload: { filename: 'b.zip' },
    });
    expect(calls[1].parseError).toBeUndefined();
  });

  it('recovers via the next known open tag when no foreign close exists', () => {
    const text = '<artifact_create>{"filename":"a.txt"}<artifact_bundle_create>{"filename":"b.zip","files":[]}</artifact_bundle_create>';
    const calls = extractToolCalls(text, { descriptors });

    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatchObject({
      invocationName: 'artifact_create',
      payload: { filename: 'a.txt' },
      parseError: { code: MISMATCHED_TOOL_CALL_ERROR_CODE },
    });
    expect(calls[0].raw).not.toContain('<artifact_bundle_create>');
    expect(calls[1].parseError).toBeUndefined();
  });

  it('keeps pure unterminated blocks unclaimed (bounded recovery)', () => {
    const text = '<artifact_create>' + ' '.repeat(1_000);
    expect(extractToolCalls(text, { descriptors })).toHaveLength(0);
    expect(stripToolCalls(text, { descriptors })).toBe('<artifact_create>');
  });

  it('strip removes the recovered stray tags and summary renders them as malformed', () => {
    const text = 'Before <artifact_create>{"filename":"a.txt"}</invoke> after';

    expect(stripToolCalls(text, { descriptors })).toBe('Before  after');

    const summary = replaceToolCallsWithSummary(text, { descriptors });
    expect(summary).toContain('已调用工具');
    expect(summary).toContain('格式错误');
    expect(summary).not.toContain('<artifact_create>');
    expect(summary).not.toContain('</invoke>');
  });

  it('recovers a legacy unterminated invoke bounded by the legacy block end', () => {
    const text = [
      '<｜DSML｜tool_calls>',
      '<｜DSML｜invoke name="artifact_create">',
      '<｜DSML｜parameter name="filename" string="true">a.txt</｜DSML｜parameter>',
      '</｜DSML｜tool_calls>',
    ].join('');
    const calls = extractToolCalls(text, { descriptors });

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      invocationName: 'artifact_create',
      payload: { filename: 'a.txt' },
      parseError: { code: MISMATCHED_TOOL_CALL_ERROR_CODE, retryable: false },
    });
    expect(calls[0].raw.startsWith('<｜DSML｜invoke name="artifact_create">')).toBe(true);
    expect(calls[0].raw.endsWith('</｜DSML｜tool_calls>')).toBe(true);
  });

  it('leaves a well-formed legacy block unchanged (no false recovery)', () => {
    const text = [
      '<｜DSML｜tool_calls>',
      '<｜DSML｜invoke name="artifact_create">',
      '<｜DSML｜parameter name="filename" string="true">a.txt</｜DSML｜parameter>',
      '</｜DSML｜invoke>',
      '</｜DSML｜tool_calls>',
    ].join('');
    const calls = extractToolCalls(text, { descriptors });

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      invocationName: 'artifact_create',
      payload: { filename: 'a.txt' },
    });
    expect(calls[0].parseError).toBeUndefined();
  });
});

describe('streaming mismatched-close recovery', () => {
  const descriptors = createArtifactToolDescriptors('en');

  it('finalizes the mismatched call as failed and parses the next parallel block', () => {
    const parser = createStreamingToolCallParser(descriptors);
    const start = parser.append('<artifact_create>');
    const result = parser.append('{"filename":"a.txt"}</invoke><artifact_create>{"filename":"b.txt","content":"x"}</artifact_create>');

    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]).toMatchObject({
      id: start.started[0].id,
      invocationName: 'artifact_create',
      parseError: { code: MISMATCHED_TOOL_CALL_ERROR_CODE, retryable: false },
    });
    expect(result.completed).toHaveLength(1);
    expect(result.completed[0]).toMatchObject({
      invocationName: 'artifact_create',
      payload: { filename: 'b.txt', content: 'x' },
    });
    expect(parser.flush()).toEqual({ started: [], completed: [], failed: [], streamed: [] });
  });

  it('recovers a foreign close split across chunk boundaries', () => {
    const parser = createStreamingToolCallParser(descriptors);
    const start = parser.append('<artifact_create>{"filename":"a.txt"}</inv');
    const result = parser.append('oke><artifact_create>{"filename":"b.txt","content":"x"}</artifact_create>');

    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]).toMatchObject({
      id: start.started[0].id,
      parseError: { code: MISMATCHED_TOOL_CALL_ERROR_CODE },
    });
    expect(result.completed).toHaveLength(1);
    expect(result.completed[0].payload).toEqual({ filename: 'b.txt', content: 'x' });
  });

  it('recovers on the next known open tag and keeps the stray close out of the next call', () => {
    const parser = createStreamingToolCallParser(descriptors);
    const result = parser.append('<artifact_create>{"a":1}<artifact_bundle_create>{"filename":"b.zip","files":[]}</artifact_bundle_create>');

    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]).toMatchObject({
      invocationName: 'artifact_create',
      parseError: { code: MISMATCHED_TOOL_CALL_ERROR_CODE },
    });
    expect(result.completed).toHaveLength(1);
    expect(result.completed[0]).toMatchObject({
      invocationName: 'artifact_bundle_create',
      payload: { filename: 'b.zip' },
    });
  });

  it('still yields tool_call_incomplete on flush when no terminator exists (unchanged)', () => {
    const parser = createStreamingToolCallParser(descriptors);
    const start = parser.append('<artifact_create>{"filename":"unfinished.html"');

    const terminal = parser.flush();

    expect(terminal.failed).toHaveLength(1);
    expect(terminal.failed[0]).toMatchObject({
      id: start.started[0].id,
      parseError: { code: 'tool_call_incomplete', retryable: false },
    });
  });

  // Dedupe invariant (deepseek-stream-fn.ts), scoped per branch: the XML leg
  // of the fallback is gated on toolCallCount === 0, and with toolCallCount > 0
  // the fallback is restricted to LEGACY ｜DSML｜ blocks (extractLegacyToolCalls)
  // so a recovered call is never re-emitted — mapToolCall drops parseError, so
  // a duplicate copy would carry a best-effort payload and could execute.
  it('streaming recovery bumps toolCallCount so the XML fallback leg cannot fire', () => {
    const raw = '<artifact_create>{"filename":"a.txt"}</invoke><artifact_create>{"filename":"b.txt","content":"x"}</artifact_create>';
    const parser = createStreamingToolCallParser(descriptors);

    let toolCallCount = 0;
    for (const event of [parser.append(raw), parser.flush()]) {
      // Mirrors deepseek-stream-fn.ts onParsed: completed AND failed both count.
      toolCallCount += event.completed.length + event.failed.length;
    }

    expect(toolCallCount).toBeGreaterThan(0);
    const shouldFallback = raw.includes('｜DSML｜')
      || (toolCallCount === 0 && raw.includes('<'));
    expect(shouldFallback).toBe(false);
  });

  it('mixed-format reply: legacy-only fallback emits exactly one mismatched call, no duplicate', () => {
    const mismatched = '<artifact_create>{"filename":"a.txt"}</invoke>';
    const legacyBlock = [
      '<｜DSML｜tool_calls>',
      '<｜DSML｜invoke name="artifact_create">',
      '<｜DSML｜parameter name="filename" string="true">legacy.txt</｜DSML｜parameter>',
      '</｜DSML｜invoke>',
      '</｜DSML｜tool_calls>',
    ].join('');
    const raw = mismatched + legacyBlock;
    const parser = createStreamingToolCallParser(descriptors);

    const streamed: ReturnType<typeof extractToolCalls> = [];
    let toolCallCount = 0;
    for (const event of [parser.append(raw), parser.flush()]) {
      toolCallCount += event.completed.length + event.failed.length;
      streamed.push(...event.completed, ...event.failed);
    }
    expect(toolCallCount).toBeGreaterThan(0);
    expect(streamed).toHaveLength(1);
    expect(streamed[0].parseError?.code).toBe(MISMATCHED_TOOL_CALL_ERROR_CODE);

    // Mirrors deepseek-stream-fn.ts: count > 0 restricts the fallback to
    // legacy ｜DSML｜ blocks, so the recovered XML call is not re-extracted.
    const fallbackCalls = toolCallCount === 0
      ? extractToolCalls(raw, { descriptors })
      : extractLegacyToolCalls(raw, { descriptors });
    expect(fallbackCalls).toHaveLength(1);
    expect(fallbackCalls[0]).toMatchObject({
      invocationName: 'artifact_create',
      payload: { filename: 'legacy.txt' },
    });
    expect(fallbackCalls.some((call) => call.raw.includes('</invoke>'))).toBe(false);

    const emitted = [...streamed, ...fallbackCalls];
    expect(emitted.filter((call) => call.parseError?.code === MISMATCHED_TOOL_CALL_ERROR_CODE))
      .toHaveLength(1);
  });

  it('pure-legacy reply with toolCallCount === 0 still parses via full fallback extraction', () => {
    const raw = [
      '<｜DSML｜tool_calls>',
      '<｜DSML｜invoke name="artifact_create">',
      '<｜DSML｜parameter name="filename" string="true">legacy.txt</｜DSML｜parameter>',
      '</｜DSML｜invoke>',
      '</｜DSML｜tool_calls>',
    ].join('');
    const parser = createStreamingToolCallParser(descriptors);

    let toolCallCount = 0;
    for (const event of [parser.append(raw), parser.flush()]) {
      toolCallCount += event.completed.length + event.failed.length;
    }
    expect(toolCallCount).toBe(0);

    // count === 0 keeps full extraction: pure-legacy replies must still work.
    const fallbackCalls = extractToolCalls(raw, { descriptors });
    expect(fallbackCalls).toHaveLength(1);
    expect(fallbackCalls[0]).toMatchObject({
      invocationName: 'artifact_create',
      payload: { filename: 'legacy.txt' },
    });
  });
});
