import { describe, expect, it } from 'vitest';
import { extractToolCalls, stripToolCalls, replaceToolCallsWithSummary } from '../core/interceptor/tool-parser';
import { createArtifactToolDescriptors } from '../core/artifact';

describe('H1 ReDoS regression', () => {
  const descriptors = createArtifactToolDescriptors('en');
  it('parses 120K whitespace without catastrophic backtracking', () => {
    const input = '<artifact_create>' + ' '.repeat(119_000);
    const t0 = performance.now();
    const calls = extractToolCalls(input, { descriptors });
    expect(calls).toHaveLength(0);
    expect(performance.now() - t0).toBeLessThan(2000);
  });
  it('strips unterminated tag fast (kept verbatim)', () => {
    const input = '<artifact_create>' + ' '.repeat(119_000);
    const t0 = performance.now();
    expect(stripToolCalls(input, { descriptors })).toBe('<artifact_create>');
    expect(performance.now() - t0).toBeLessThan(2000);
  });
  it('replace-with-summary on unterminated tag fast', () => {
    const input = '<artifact_create>' + ' '.repeat(119_000);
    const t0 = performance.now();
    expect(replaceToolCallsWithSummary(input, { descriptors })).toBe(input);
    expect(performance.now() - t0).toBeLessThan(2000);
  });
  it('legacy block 120K whitespace without catastrophic backtracking', () => {
    const input = '<｜DSML｜tool_calls>' + ' '.repeat(119_000);
    const t0 = performance.now();
    expect(extractToolCalls(input, { descriptors })).toHaveLength(0);
    expect(performance.now() - t0).toBeLessThan(2000);
  });
  it('mismatched close tag without catastrophic backtracking', () => {
    const input = '<artifact_create>' + ' '.repeat(50_000) + '</artifact_creat>';
    const t0 = performance.now();
    extractToolCalls(input, { descriptors });
    expect(performance.now() - t0).toBeLessThan(2000);
  });
  it('recovers a mismatched-close call bounded by a foreign terminator fast (linear)', () => {
    // Deliberate expectation change (mismatched-close recovery task): the
    // foreign `</invoke>` terminator now BOUNDS the block, so the call is
    // recovered as tool_call_close_mismatched and stripped. Pure unterminated
    // input (tests above) keeps the 'kept verbatim' expectation.
    const input = '<artifact_create>' + ' '.repeat(120_000) + '</invoke>';
    const t0 = performance.now();
    const calls = extractToolCalls(input, { descriptors });
    expect(calls).toHaveLength(1);
    expect(calls[0].parseError?.code).toBe('tool_call_close_mismatched');
    expect(stripToolCalls(input, { descriptors })).toBe('');
    expect(performance.now() - t0).toBeLessThan(2000);
  });
  it('parses a well-formed call inside 120K text fast', () => {
    const input = 'x'.repeat(60_000) + '<artifact_create>{"filename":"a","content":"b"}</artifact_create>' + 'y'.repeat(60_000);
    const t0 = performance.now();
    const calls = extractToolCalls(input, { descriptors });
    expect(calls).toHaveLength(1);
    expect(performance.now() - t0).toBeLessThan(2000);
  });
});
