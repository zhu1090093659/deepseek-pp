import type { ToolCall, ToolError } from '../types';
import {
  createToolCallFromInvocation,
  createToolInvocationCatalog,
  getToolInvocationLabel,
  type ToolInvocationCatalog,
  type ToolParsingInput,
} from '../tool';
import { MISMATCHED_TOOL_CALL_ERROR_CODE } from '../tool/execution-error';
import { findFirstXmlToolTag, type XmlToolTagMatch } from '../tool/xml-tags';

export const LEGACY_TOOL_CALLS_OPEN_TAG = '<｜DSML｜tool_calls>';
export const LEGACY_TOOL_CALLS_CLOSE_TAG = '</｜DSML｜tool_calls>';

const LEGACY_INVOKE_OPEN_PREFIX = '<｜DSML｜invoke name="';
const LEGACY_INVOKE_CLOSE_TAG = '</｜DSML｜invoke>';
const LEGACY_PARAMETER_OPEN_PREFIX = '<｜DSML｜parameter name="';
const LEGACY_PARAMETER_TYPE_PREFIX = '" string="';
const LEGACY_PARAMETER_CLOSE_TAG = '</｜DSML｜parameter>';
// Foreign close emitted by models trained on a generic `<invoke>` wire format.
const PLAIN_INVOKE_CLOSE_TAG = '</invoke>';

export function extractToolCalls(text: string, input?: ToolParsingInput): ToolCall[] {
  const catalog = createToolInvocationCatalog(input?.descriptors);
  return [
    ...extractXmlToolCalls(text, catalog),
    ...extractLegacyToolCallsForCatalog(text, catalog),
  ];
}

/**
 * Extracts ONLY legacy `｜DSML｜tool_calls` blocks (linear scan). The StreamFn
 * fallback uses this when the streaming parser already emitted XML calls, so a
 * recovered or complete XML call can never be re-emitted by the fallback.
 */
export function extractLegacyToolCalls(text: string, input?: ToolParsingInput): ToolCall[] {
  const catalog = createToolInvocationCatalog(input?.descriptors);
  return extractLegacyToolCallsForCatalog(text, catalog);
}

/**
 * Linear-time XML tool-call extraction. The previous `[\s\S]*?` regex family
 * exhibited catastrophic backtracking on long whitespace runs without a
 * matching closing tag (ReDoS, H1); the scanner below is strictly linear and
 * preserves the regex semantics: the first complete `<name>…</name>` block
 * with a matching name, scanning forward for the first closing tag of the
 * same name. One deliberate extension: a block closed by a FOREIGN terminator
 * (mismatched close) is recovered as a parseError record instead of being
 * dropped — bounded by the terminator, so the scan stays linear.
 */
function extractXmlToolCalls(text: string, catalog: ToolInvocationCatalog): ToolCall[] {
  const calls: ToolCall[] = [];
  const names = catalog.invocationNames;
  if (names.length === 0 || !text) return calls;
  const nameSet = new Set(names);
  let fromIndex = 0;

  while (fromIndex < text.length) {
    const open = findFirstXmlToolTag(text, nameSet, { closing: false, fromIndex });
    if (!open) break;
    const close = findFirstXmlToolTag(
      text,
      new Set([open.name]),
      { closing: true, fromIndex: open.endIndex },
    );
    if (!close) {
      // Bounded mismatched-close recovery: when the same-name close is absent
      // but a foreign terminator bounds the block, recover the call as a
      // parseError record so the loop sees it instead of silently dropping it.
      // A pure unterminated block (no terminator) keeps the old skip.
      const terminator = findXmlToolCallTerminator(text, nameSet, open.endIndex);
      if (!terminator) {
        fromIndex = open.endIndex;
        continue;
      }
      calls.push(createMismatchedCloseToolCall(open, terminator, text, catalog));
      fromIndex = terminator.endIndex;
      continue;
    }

    const raw = text.slice(open.index, close.endIndex);
    const body = text.slice(open.endIndex, close.index).trim();
    const invocationName = open.name;
    let payload: Record<string, unknown>;
    try {
      const parsed = body.length === 0 ? {} : JSON.parse(body);
      if (!isToolPayload(parsed)) {
        calls.push(createToolCallFromInvocation(invocationName, {}, raw, catalog, {
          parseError: createToolParseError(
            'tool_call_payload_invalid',
            invocationName,
            'Tool call body must be a JSON object.',
          ),
        }));
        fromIndex = close.endIndex;
        continue;
      }
      payload = parsed;
    } catch (err) {
      calls.push(createToolCallFromInvocation(invocationName, {}, raw, catalog, {
        parseError: createToolParseError(
          'tool_call_json_invalid',
          invocationName,
          [
            'Tool call body is not valid JSON.',
            'Use double quotes for strings and escape backslashes in local file paths, for example "D:\\\\project\\\\file.txt" or "D:/project/file.txt".',
            err instanceof Error ? err.message : String(err),
          ].join(' '),
        ),
      }));
      fromIndex = close.endIndex;
      continue;
    }
    calls.push(createToolCallFromInvocation(invocationName, payload, raw, catalog));
    fromIndex = close.endIndex;
  }

  return calls;
}

/**
 * A foreign tag that bounds a mismatched-close tool-call block. Recovery is
 * BOUNDED: only a terminator found by a single forward scan claims the block;
 * a pure unterminated block (no terminator ahead) stays unclaimed.
 */
interface XmlToolCallTerminator {
  /** Start of the terminator tag inside the scanned text. */
  index: number;
  /** Exclusive end of the recovered block: the terminator tag's end for a
   * closing terminator, the terminator's start for a next-open terminator so
   * the following block re-parses from that open tag. */
  endIndex: number;
  /** Canonical tag text for parse-error messages. */
  label: string;
  closing: boolean;
}

/**
 * Earliest terminator after `fromIndex`: any catalog closing tag (foreign,
 * because the same-name close was already searched in vain), the legacy
 * `</｜DSML｜invoke>` or plain `</invoke>` close, or the next known open tag.
 * Every candidate is one linear forward scan with an advancing start, so the
 * caller's loop stays linear (ReDoS H1 constraint).
 */
function findXmlToolCallTerminator(
  text: string,
  nameSet: ReadonlySet<string>,
  fromIndex: number,
): XmlToolCallTerminator | null {
  let best: XmlToolCallTerminator | null = null;
  const consider = (candidate: XmlToolCallTerminator) => {
    if (!best || candidate.index < best.index) best = candidate;
  };

  const foreignClose = findFirstXmlToolTag(text, nameSet, { closing: true, fromIndex });
  if (foreignClose) {
    consider({
      index: foreignClose.index,
      endIndex: foreignClose.endIndex,
      label: `</${foreignClose.name}>`,
      closing: true,
    });
  }
  const legacyCloseIdx = text.indexOf(LEGACY_INVOKE_CLOSE_TAG, fromIndex);
  if (legacyCloseIdx !== -1) {
    consider({
      index: legacyCloseIdx,
      endIndex: legacyCloseIdx + LEGACY_INVOKE_CLOSE_TAG.length,
      label: LEGACY_INVOKE_CLOSE_TAG,
      closing: true,
    });
  }
  const plainCloseIdx = text.indexOf(PLAIN_INVOKE_CLOSE_TAG, fromIndex);
  if (plainCloseIdx !== -1) {
    consider({
      index: plainCloseIdx,
      endIndex: plainCloseIdx + PLAIN_INVOKE_CLOSE_TAG.length,
      label: PLAIN_INVOKE_CLOSE_TAG,
      closing: true,
    });
  }
  const nextOpen = findFirstXmlToolTag(text, nameSet, { closing: false, fromIndex });
  if (nextOpen) {
    consider({
      index: nextOpen.index,
      endIndex: nextOpen.index,
      label: `<${nextOpen.name}>`,
      closing: false,
    });
  }

  return best;
}

/**
 * Builds the recovered ToolCall for a block whose closing tag is foreign or
 * missing ahead of a terminator. The payload is best-effort: a body that is
 * not valid JSON keeps the empty payload because the mismatched close is
 * already the single reported parse error (no compound error codes).
 */
function createMismatchedCloseToolCall(
  open: XmlToolTagMatch,
  terminator: XmlToolCallTerminator,
  text: string,
  catalog: ToolInvocationCatalog,
): ToolCall {
  const raw = text.slice(open.index, terminator.endIndex);
  const body = text.slice(open.endIndex, terminator.index).trim();
  let payload: Record<string, unknown> = {};
  try {
    const parsed = body.length === 0 ? {} : JSON.parse(body);
    if (isToolPayload(parsed)) payload = parsed;
  } catch {
    // Keep the empty payload; the close mismatch is the reported error.
  }
  const expectedClose = `</${open.name}>`;
  const message = terminator.closing
    ? `Tool call <${open.name}> was closed by ${terminator.label} instead of ${expectedClose}.`
    : `Tool call <${open.name}> reached the next tool tag ${terminator.label} without ${expectedClose}.`;
  return createToolCallFromInvocation(open.name, payload, raw, catalog, {
    parseError: createToolParseError(MISMATCHED_TOOL_CALL_ERROR_CODE, open.name, message),
  });
}

/**
 * Linear-time legacy `｜DSML｜tool_calls` extraction. Replaces the
 * `[\s\S]*?`-based legacy regexes (same ReDoS class as the XML parser).
 */
function extractLegacyToolCallsForCatalog(text: string, catalog: ToolInvocationCatalog): ToolCall[] {
  const calls: ToolCall[] = [];
  let fromIndex = 0;

  while (fromIndex < text.length) {
    const openIdx = text.indexOf(LEGACY_TOOL_CALLS_OPEN_TAG, fromIndex);
    if (openIdx === -1) break;
    const closeIdx = text.indexOf(
      LEGACY_TOOL_CALLS_CLOSE_TAG,
      openIdx + LEGACY_TOOL_CALLS_OPEN_TAG.length,
    );
    if (closeIdx === -1) break;
    const blockEnd = closeIdx + LEGACY_TOOL_CALLS_CLOSE_TAG.length;
    const blockContent = text.slice(openIdx, blockEnd);
    extractLegacyInvokes(blockContent, catalog, calls);
    fromIndex = blockEnd;
  }

  return calls;
}

function extractLegacyInvokes(
  blockContent: string,
  catalog: ToolInvocationCatalog,
  calls: ToolCall[],
): void {
  let idx = 0;

  while (idx < blockContent.length) {
    const invokeOpenStart = blockContent.indexOf(LEGACY_INVOKE_OPEN_PREFIX, idx);
    if (invokeOpenStart === -1) break;
    const nameStart = invokeOpenStart + LEGACY_INVOKE_OPEN_PREFIX.length;
    // The released regex name class was [^"]+ terminated by `">`: the first
    // quote after the name must be followed immediately by `>`, otherwise the
    // whole tag is malformed and the engine skipped it while continuing the
    // scan. Mirror that instead of accepting quotes inside the name.
    const quoteIdx = blockContent.indexOf('"', nameStart);
    if (quoteIdx === -1 || blockContent[quoteIdx + 1] !== '>') {
      idx = invokeOpenStart + LEGACY_INVOKE_OPEN_PREFIX.length;
      continue;
    }
    const nameEnd = quoteIdx;
    // The released regex required a non-empty name ([^"]+); skip empty ones.
    if (nameEnd === nameStart) {
      idx = nameStart + 1;
      continue;
    }
    const invocationName = blockContent.slice(nameStart, nameEnd);
    const invokeCloseIdx = blockContent.indexOf(LEGACY_INVOKE_CLOSE_TAG, nameEnd + 2);
    if (invokeCloseIdx === -1) {
      // Unterminated invoke: BOUNDED recovery — the enclosing legacy block end
      // terminates the raw block and the parsed parameters become the payload,
      // so the call surfaces as tool_call_close_mismatched instead of being
      // silently dropped. The scan ends with the block.
      calls.push(createToolCallFromInvocation(
        invocationName,
        extractLegacyParameters(blockContent.slice(nameEnd + 2)),
        blockContent.slice(invokeOpenStart),
        catalog,
        {
          parseError: createToolParseError(
            MISMATCHED_TOOL_CALL_ERROR_CODE,
            invocationName,
            `Tool invoke <｜DSML｜invoke name="${invocationName}"> ended without ${LEGACY_INVOKE_CLOSE_TAG}.`,
          ),
        },
      ));
      idx = blockContent.length;
      continue;
    }
    const invokeContent = blockContent.slice(nameEnd + 2, invokeCloseIdx);
    const invokeEnd = invokeCloseIdx + LEGACY_INVOKE_CLOSE_TAG.length;
    const raw = blockContent.slice(invokeOpenStart, invokeEnd);
    calls.push(createToolCallFromInvocation(
      invocationName,
      extractLegacyParameters(invokeContent),
      raw,
      catalog,
    ));
    idx = invokeEnd;
  }
}

function extractLegacyParameters(invokeContent: string): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  let idx = 0;

  while (idx < invokeContent.length) {
    const openStart = invokeContent.indexOf(LEGACY_PARAMETER_OPEN_PREFIX, idx);
    if (openStart === -1) break;
    const nameStart = openStart + LEGACY_PARAMETER_OPEN_PREFIX.length;
    // The released regex required `name="([^"]+)" string="(true|false)"`: the
    // first quote after the name must be followed exactly by ` string="`,
    // otherwise the parameter is malformed and the regex skipped it while
    // continuing the scan.
    const quoteIdx = invokeContent.indexOf('"', nameStart);
    if (
      quoteIdx === -1
      || !invokeContent.startsWith(LEGACY_PARAMETER_TYPE_PREFIX, quoteIdx)
    ) {
      idx = openStart + LEGACY_PARAMETER_OPEN_PREFIX.length;
      continue;
    }
    const nameEnd = quoteIdx;
    // The released regex required a non-empty name ([^"]+); skip empty ones.
    if (nameEnd === nameStart) {
      idx = nameStart + 1;
      continue;
    }
    const paramName = invokeContent.slice(nameStart, nameEnd);
    const typeStart = nameEnd + LEGACY_PARAMETER_TYPE_PREFIX.length;
    // The released regex required `string="(true|false)">` with no intervening
    // characters. Match the exact token instead of searching for a distant
    // `">` (which could swallow a later well-formed parameter).
    const isString = invokeContent.startsWith('true">', typeStart);
    if (!isString && !invokeContent.startsWith('false">', typeStart)) {
      idx = openStart + LEGACY_PARAMETER_OPEN_PREFIX.length;
      continue;
    }
    // The value starts right after the '>': 'true">' is 6 chars, 'false">' 7.
    const valueStart = typeStart + (isString ? 6 : 7);
    const valueEnd = invokeContent.indexOf(LEGACY_PARAMETER_CLOSE_TAG, valueStart);
    if (valueEnd === -1) {
      // Unterminated parameter value: the released regex matched nothing here
      // and kept scanning; continue instead of dropping later parameters.
      idx = valueStart;
      continue;
    }
    const value = invokeContent.slice(valueStart, valueEnd);
    if (isString) {
      payload[paramName] = value;
    } else {
      try {
        payload[paramName] = JSON.parse(value);
      } catch {
        payload[paramName] = value;
      }
    }
    idx = valueEnd + LEGACY_PARAMETER_CLOSE_TAG.length;
  }

  return payload;
}

interface ToolCallBlockRange {
  start: number;
  end: number;
}

/**
 * Collects every complete XML tool-call block in the text (linear scan).
 * A block is the first closing tag of the same name after an opening tag, or
 * — when that close is missing — the block bounded by the earliest foreign
 * terminator (same bounded recovery as extractXmlToolCalls).
 */
function collectXmlToolCallBlocks(text: string, catalog: ToolInvocationCatalog): ToolCallBlockRange[] {
  const blocks: ToolCallBlockRange[] = [];
  const names = catalog.invocationNames;
  if (names.length === 0 || !text) return blocks;
  const nameSet = new Set(names);
  let fromIndex = 0;

  while (fromIndex < text.length) {
    const open = findFirstXmlToolTag(text, nameSet, { closing: false, fromIndex });
    if (!open) break;
    const close = findFirstXmlToolTag(
      text,
      new Set([open.name]),
      { closing: true, fromIndex: open.endIndex },
    );
    if (!close) {
      // Same bounded recovery as extractXmlToolCalls: the recovered block ends
      // at the terminator, so stripToolCalls removes the stray tags and
      // replaceToolCallsWithSummary renders them (display + history cleanup).
      const terminator = findXmlToolCallTerminator(text, nameSet, open.endIndex);
      if (!terminator) {
        fromIndex = open.endIndex;
        continue;
      }
      blocks.push({ start: open.index, end: terminator.endIndex });
      fromIndex = terminator.endIndex;
      continue;
    }
    blocks.push({ start: open.index, end: close.endIndex });
    fromIndex = close.endIndex;
  }

  return blocks;
}

/** Collects every legacy `｜DSML｜tool_calls` block (linear scan). */
function collectLegacyToolCallBlocks(text: string): ToolCallBlockRange[] {
  const blocks: ToolCallBlockRange[] = [];
  let fromIndex = 0;

  while (fromIndex < text.length) {
    const openIdx = text.indexOf(LEGACY_TOOL_CALLS_OPEN_TAG, fromIndex);
    if (openIdx === -1) break;
    const closeIdx = text.indexOf(
      LEGACY_TOOL_CALLS_CLOSE_TAG,
      openIdx + LEGACY_TOOL_CALLS_OPEN_TAG.length,
    );
    if (closeIdx === -1) break;
    blocks.push({ start: openIdx, end: closeIdx + LEGACY_TOOL_CALLS_CLOSE_TAG.length });
    fromIndex = blocks[blocks.length - 1].end;
  }

  return blocks;
}

function replaceBlocksWithSummaries(
  text: string,
  blocks: readonly ToolCallBlockRange[],
  catalog: ToolInvocationCatalog,
): string {
  if (blocks.length === 0) return text;
  let output = '';
  let cursor = 0;
  for (const block of blocks) {
    output += text.slice(cursor, block.start);
    output += replaceMatchWithSummary(text.slice(block.start, block.end), catalog);
    cursor = block.end;
  }
  return output + text.slice(cursor);
}

function removeBlocks(text: string, blocks: readonly ToolCallBlockRange[]): string {
  if (blocks.length === 0) return text;
  let output = '';
  let cursor = 0;
  for (const block of blocks) {
    output += text.slice(cursor, block.start);
    cursor = block.end;
  }
  return output + text.slice(cursor);
}

export function stripToolCalls(text: string, input?: ToolParsingInput): string {
  const catalog = createToolInvocationCatalog(input?.descriptors);
  const withoutXml = removeBlocks(text, collectXmlToolCallBlocks(text, catalog));
  return removeBlocks(withoutXml, collectLegacyToolCallBlocks(withoutXml)).trim();
}

export function replaceToolCallsWithSummary(text: string, input?: ToolParsingInput): string {
  const catalog = createToolInvocationCatalog(input?.descriptors);
  const withXmlSummary = replaceBlocksWithSummaries(
    text,
    collectXmlToolCallBlocks(text, catalog),
    catalog,
  );
  return replaceBlocksWithSummaries(
    withXmlSummary,
    collectLegacyToolCallBlocks(withXmlSummary),
    catalog,
  );
}

function replaceMatchWithSummary(match: string, catalog: ToolInvocationCatalog): string {
  const calls = extractToolCalls(match, { descriptors: catalog.descriptors });
  if (calls.length === 0) return '';
  const lines = calls.map(call => {
    const name = call.name;
    if (call.parseError) return `• ${getToolInvocationLabel(name, catalog)}：格式错误`;
    const detail = (call.payload as any).name || (call.payload as any).content || (call.payload as any).id || '';
    return `• ${getToolInvocationLabel(name, catalog)}${detail ? '：' + detail : ''}`;
  });
  const executedCount = calls.filter(call => !call.parseError).length;
  const header = executedCount === calls.length
    ? `🔧 已调用工具（${calls.length}次）`
    : `🔧 已调用工具（${executedCount}次，${calls.length - executedCount}次格式错误）`;
  return '\n\n---\n' + header + '\n' + lines.join('\n') + '\n---';
}

function isToolPayload(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function createToolParseError(code: string, invocationName: string, message: string): ToolError {
  return {
    code,
    message,
    retryable: false,
    details: { invocationName },
  };
}
