import type { ToolCall, ToolDescriptor, ToolError } from '../types';
import {
  createToolCallFromInvocation,
  createToolInvocationCatalog,
  getToolCloseTag,
  type ToolInvocationCatalog,
} from '../tool';
import { createExternalizedToolPayload } from '../tool/externalized-payload';
import {
  INCOMPLETE_TOOL_CALL_ERROR_CODE,
  MISMATCHED_TOOL_CALL_ERROR_CODE,
} from '../tool/execution-error';
import {
  findFirstXmlToolTag,
  getPartialXmlToolTagTailLength,
} from '../tool/xml-tags';

const STREAM_TOOL_RAW_MAX_LENGTH = 2048;
const TRUNCATION_SUFFIX = '\n...[truncated]';
const EXTERNALIZE_BODY_THRESHOLD_CHARS = 64_000;
const STREAM_TOOL_BODY_MAX_CHARS = 1_048_576;
// Foreign close literals emitted by models trained on a generic `<invoke>`
// wire format. Kept local so the streaming bundle stays independent of the
// batch tool-parser module (main-world/content entrypoints import only this).
const INVOKE_CLOSE_TERMINATOR_LEGACY = '</｜DSML｜invoke>';
const INVOKE_CLOSE_TERMINATOR_PLAIN = '</invoke>';

export interface StreamingToolCallParserEvent {
  started: ToolCall[];
  completed: ToolCall[];
  failed: ToolCall[];
  streamed: ToolCallPayloadChunk[];
}

export interface StreamingToolCallParser {
  append(chunk: string): StreamingToolCallParserEvent;
  flush(): StreamingToolCallParserEvent;
}

export interface ToolCallPayloadChunk {
  id: string;
  invocationName: string;
  chunk: string;
  requestId?: string;
}

export interface StreamingToolCallParserOptions {
  // The active local skill's skillDir for the request owning the current response; when non-empty, parsed
  // shell_exec / shell_session_begin calls carry localSkillDir as the "initial cwd hint" at the background
  // runtime (not a hard persistent binding; Review #4 Route A).
  activeLocalSkillDir?: string;
}

export function createStreamingToolCallParser(
  descriptors: readonly ToolDescriptor[],
  options?: StreamingToolCallParserOptions,
): StreamingToolCallParser {
  return new XmlStreamingToolCallParser(createToolInvocationCatalog(descriptors), options);
}

class XmlStreamingToolCallParser implements StreamingToolCallParser {
  private readonly invocationNames: ReadonlySet<string>;
  private state: 'NORMAL' | 'SUPPRESSING' = 'NORMAL';
  private pendingNormal = '';
  private pendingSuppressed = '';
  private current: {
    id: string;
    invocationName: string;
    openTag: string;
    closeTag: string;
    bodyParts: string[];
    bodyLength: number;
    externalized: boolean;
    externalizable: boolean;
    failed: boolean;
  } | null = null;

  constructor(
    private readonly catalog: ToolInvocationCatalog,
    options?: StreamingToolCallParserOptions,
  ) {
    this.invocationNames = new Set(catalog.invocationNames);
    this.activeLocalSkillDir = options?.activeLocalSkillDir || undefined;
  }

  private readonly activeLocalSkillDir: string | undefined;

  append(chunk: string): StreamingToolCallParserEvent {
    const event = createEmptyParserEvent();
    if (!chunk || this.invocationNames.size === 0) return event;

    let remaining = chunk;
    while (remaining.length > 0) {
      remaining = this.state === 'SUPPRESSING'
        ? this.consumeSuppressedText(remaining, event)
        : this.consumeNormalText(remaining, event);
    }
    return event;
  }

  flush(): StreamingToolCallParserEvent {
    const event = createEmptyParserEvent();
    if (this.current && !this.current.failed) {
      event.failed.push(this.createIncompleteCall(this.current, this.pendingSuppressed));
    }
    this.state = 'NORMAL';
    this.pendingNormal = '';
    this.pendingSuppressed = '';
    this.current = null;
    return event;
  }

  private consumeNormalText(input: string, event: StreamingToolCallParserEvent): string {
    const text = this.pendingNormal + input;
    this.pendingNormal = '';

    const found = findFirstXmlToolTag(text, this.invocationNames, { closing: false });
    if (!found) {
      const tailLength = getPartialXmlToolTagTailLength(text, this.invocationNames, { closing: false });
      this.pendingNormal = tailLength > 0 ? text.slice(-tailLength) : '';
      return '';
    }

    const id = crypto.randomUUID();
    this.state = 'SUPPRESSING';
    this.pendingSuppressed = '';
    this.current = {
      id,
      invocationName: found.name,
      openTag: found.raw,
      closeTag: getToolCloseTag(found.name),
      bodyParts: [],
      bodyLength: 0,
      externalized: false,
      externalizable: isExternalizableInvocation(found.name),
      failed: false,
    };
    event.started.push(createToolCallFromInvocation(
      found.name,
      {},
      found.raw,
      this.catalog,
      { id },
    ));
    return text.slice(found.endIndex);
  }

  private consumeSuppressedText(input: string, event: StreamingToolCallParserEvent): string {
    const current = this.current;
    if (!current) {
      this.state = 'NORMAL';
      return input;
    }

    const text = this.pendingSuppressed + input;
    this.pendingSuppressed = '';
    const closeTag = findFirstXmlToolTag(text, new Set([current.invocationName]), { closing: true });
    // Fail-fast mismatched-close recovery: whichever comes first between the
    // same-name close (complete path below) and a foreign terminator bounds the
    // call. Without this, one malformed call swallowed every following parallel
    // call until EOF.
    const foreign = this.findForeignTerminator(text, closeTag?.index);

    if (closeTag && (!foreign || closeTag.index < foreign.index)) {
      this.appendBody(text.slice(0, closeTag.index), event);
      if (!current.failed) {
        event.completed.push(this.createCompletedCall({ ...current, closeTag: closeTag.raw }));
      }
      this.state = 'NORMAL';
      this.pendingSuppressed = '';
      this.current = null;
      return text.slice(closeTag.endIndex);
    }

    if (foreign) {
      this.appendBody(text.slice(0, foreign.index), event);
      if (!current.failed) {
        event.failed.push(this.createMismatchedCloseCall(current, foreign.label));
      }
      this.state = 'NORMAL';
      this.pendingSuppressed = '';
      this.current = null;
      // Re-consume from the terminator index in NORMAL state so the stray close
      // is dropped and the following parallel tool call parses.
      return text.slice(foreign.index);
    }

    // No close and no foreign terminator: keep buffering, but hold back every
    // bounded suffix that could still complete into a terminator (same-name or
    // foreign closing tag, next known open tag, legacy/plain `</invoke>`
    // literals) so a terminator split across chunks stays contiguous here.
    const tailLength = Math.max(
      getPartialXmlToolTagTailLength(text, this.invocationNames, { closing: true }),
      getPartialXmlToolTagTailLength(text, this.invocationNames, { closing: false }),
      getInvokeCloseTailLength(text),
    );
    this.appendBody(text.slice(0, text.length - tailLength), event);
    this.pendingSuppressed = tailLength > 0 ? text.slice(-tailLength) : '';
    return '';
  }

  /**
   * Earliest foreign terminator in the suppressed buffer: any catalog closing
   * tag other than the pending call's own close (same-name index excluded), a
   * legacy/plain `</invoke>` close, or the next known open tag. Every
   * candidate is a single linear scan over the pending buffer (no
   * chunk-boundary lookahead), so consumption stays O(n).
   */
  private findForeignTerminator(
    text: string,
    sameNameCloseIndex: number | undefined,
  ): { index: number; label: string } | null {
    let best: { index: number; label: string } | null = null;
    const consider = (index: number, label: string) => {
      if (index === -1) return;
      if (sameNameCloseIndex !== undefined && index === sameNameCloseIndex) return;
      if (!best || index < best.index) best = { index, label };
    };

    const foreignClose = findFirstXmlToolTag(text, this.invocationNames, { closing: true });
    if (foreignClose) consider(foreignClose.index, `</${foreignClose.name}>`);
    consider(text.indexOf(INVOKE_CLOSE_TERMINATOR_LEGACY), INVOKE_CLOSE_TERMINATOR_LEGACY);
    consider(text.indexOf(INVOKE_CLOSE_TERMINATOR_PLAIN), INVOKE_CLOSE_TERMINATOR_PLAIN);
    const nextOpen = findFirstXmlToolTag(text, this.invocationNames, { closing: false });
    if (nextOpen) consider(nextOpen.index, `<${nextOpen.name}>`);

    return best;
  }

  // createIncompleteCall-style raw bounding: the recovered call keeps its
  // streamed body (truncated) but never claims the foreign terminator.
  private createMismatchedCloseCall(
    current: NonNullable<XmlStreamingToolCallParser['current']>,
    terminatorLabel: string,
  ): ToolCall {
    return createToolCallFromInvocation(
      current.invocationName,
      current.externalized
        ? createExternalizedToolPayload(current.id, current.invocationName)
        : {},
      createIncompleteRaw(current, ''),
      this.catalog,
      {
        id: current.id,
        localSkillDir: this.activeLocalSkillDir,
        parseError: createToolParseError(
          MISMATCHED_TOOL_CALL_ERROR_CODE,
          current.invocationName,
          `Tool call <${current.invocationName}> was interrupted by ${terminatorLabel} instead of ${current.closeTag}.`,
        ),
      },
    );
  }

  private appendBody(value: string, event: StreamingToolCallParserEvent): void {
    if (!value || !this.current) return;
    if (this.current.failed) return;

    this.current.bodyLength += value.length;
    if (this.current.bodyLength > STREAM_TOOL_BODY_MAX_CHARS) {
      this.current.failed = true;
      this.current.bodyParts = [];
      event.failed.push(this.createOversizedCall(this.current));
      return;
    }

    if (this.current.externalized) {
      event.streamed.push({ id: this.current.id, invocationName: this.current.invocationName, chunk: value });
      return;
    }

    this.current.bodyParts.push(value);
    if (this.current.externalizable && this.current.bodyLength > EXTERNALIZE_BODY_THRESHOLD_CHARS) {
      this.current.externalized = true;
      const buffered = this.current.bodyParts.join('');
      this.current.bodyParts = [];
      if (buffered) {
        event.streamed.push({
          id: this.current.id,
          invocationName: this.current.invocationName,
          chunk: buffered,
        });
      }
    }
  }

  private createCompletedCall(current: NonNullable<XmlStreamingToolCallParser['current']>): ToolCall {
    if (current.externalized) {
      return createToolCallFromInvocation(
        current.invocationName,
        createExternalizedToolPayload(current.id, current.invocationName),
        createExternalizedRaw(current),
        this.catalog,
        { id: current.id, localSkillDir: this.activeLocalSkillDir },
      );
    }

    const body = current.bodyParts.join('');
    const raw = createBoundedRaw(current, body);

    try {
      const parsed = body.length === 0 ? {} : JSON.parse(body);
      if (!isToolPayload(parsed)) {
        return createToolCallFromInvocation(current.invocationName, {}, raw, this.catalog, {
          id: current.id,
          localSkillDir: this.activeLocalSkillDir,
          parseError: createToolParseError(
            'tool_call_payload_invalid',
            current.invocationName,
            'Tool call body must be a JSON object.',
          ),
        });
      }
      return createToolCallFromInvocation(current.invocationName, parsed, raw, this.catalog, {
        id: current.id,
        localSkillDir: this.activeLocalSkillDir,
      });
    } catch (error) {
      return createToolCallFromInvocation(current.invocationName, {}, raw, this.catalog, {
        id: current.id,
        localSkillDir: this.activeLocalSkillDir,
        parseError: createToolParseError(
          'tool_call_json_invalid',
          current.invocationName,
          [
            'Tool call body is not valid JSON.',
            'Use double quotes for strings and escape backslashes in local file paths, for example "D:\\\\project\\\\file.txt" or "D:/project/file.txt".',
            error instanceof Error ? error.message : String(error),
          ].join(' '),
        ),
      });
    }
  }

  private createIncompleteCall(
    current: NonNullable<XmlStreamingToolCallParser['current']>,
    pendingTail: string,
  ): ToolCall {
    return createToolCallFromInvocation(
      current.invocationName,
      current.externalized
        ? createExternalizedToolPayload(current.id, current.invocationName)
        : {},
      createIncompleteRaw(current, pendingTail),
      this.catalog,
      {
        id: current.id,
        localSkillDir: this.activeLocalSkillDir,
        parseError: createToolParseError(
          INCOMPLETE_TOOL_CALL_ERROR_CODE,
          current.invocationName,
          `Tool call ended before the closing tag ${current.closeTag}.`,
        ),
      },
    );
  }

  private createOversizedCall(
    current: NonNullable<XmlStreamingToolCallParser['current']>,
  ): ToolCall {
    return createToolCallFromInvocation(
      current.invocationName,
      {},
      createOversizedRaw(current),
      this.catalog,
      {
        id: current.id,
        localSkillDir: this.activeLocalSkillDir,
        parseError: createToolParseError(
          'tool_call_payload_too_large',
          current.invocationName,
          createOversizedToolCallMessage(current.invocationName),
        ),
      },
    );
  }

}

function createEmptyParserEvent(): StreamingToolCallParserEvent {
  return { started: [], completed: [], failed: [], streamed: [] };
}

/**
 * Longest suffix of `text` that is a proper prefix of a legacy/plain
 * `</invoke>` close literal, so a foreign terminator split across chunks stays
 * in the pending buffer until complete. Bounded by the literal lengths (≤14
 * chars), i.e. constant work per chunk.
 */
function getInvokeCloseTailLength(text: string): number {
  let longest = 0;
  for (const literal of [INVOKE_CLOSE_TERMINATOR_LEGACY, INVOKE_CLOSE_TERMINATOR_PLAIN]) {
    const max = Math.min(text.length, literal.length - 1);
    for (let length = max; length > longest; length -= 1) {
      if (literal.startsWith(text.slice(text.length - length))) {
        longest = length;
        break;
      }
    }
  }
  return longest;
}

function createBoundedRaw(
  current: { openTag: string; closeTag: string },
  body: string,
): string {
  const rawLength = current.openTag.length + body.length + current.closeTag.length;
  if (rawLength <= STREAM_TOOL_RAW_MAX_LENGTH) return `${current.openTag}${body}${current.closeTag}`;
  return [
    current.openTag,
    `...[payload ${body.length} chars omitted]`,
    current.closeTag,
    TRUNCATION_SUFFIX,
  ].join('\n');
}

function createExternalizedRaw(
  current: { openTag: string; closeTag: string; bodyLength: number },
): string {
  return [
    current.openTag,
    `...[payload ${current.bodyLength} chars externalized]`,
    current.closeTag,
    TRUNCATION_SUFFIX,
  ].join('\n');
}

function createIncompleteRaw(
  current: {
    openTag: string;
    bodyParts: string[];
    bodyLength: number;
    externalized: boolean;
  },
  pendingTail: string,
): string {
  const bodyLength = current.bodyLength + pendingTail.length;
  if (current.externalized) {
    return [
      current.openTag,
      `...[payload ${bodyLength} chars externalized before EOF]`,
      TRUNCATION_SUFFIX,
    ].join('\n');
  }

  const body = current.bodyParts.join('') + pendingTail;
  const raw = current.openTag + body;
  if (raw.length <= STREAM_TOOL_RAW_MAX_LENGTH) return raw;
  return [
    current.openTag,
    `...[incomplete payload ${bodyLength} chars omitted]`,
    TRUNCATION_SUFFIX,
  ].join('\n');
}

function createOversizedRaw(
  current: { openTag: string; bodyLength: number },
): string {
  return [
    current.openTag,
    `...[payload exceeded ${STREAM_TOOL_BODY_MAX_CHARS} chars; ${current.bodyLength} chars received]`,
    TRUNCATION_SUFFIX,
  ].join('\n');
}

function createOversizedToolCallMessage(invocationName: string): string {
  const limit = `Tool call body exceeded the safe streaming limit of ${STREAM_TOOL_BODY_MAX_CHARS} characters.`;
  if (invocationName === 'artifact_create' || invocationName === 'artifact_bundle_create') {
    return [
      limit,
      'Do not embed binary or base64 file data in artifact calls.',
      'Keep files produced by Shell or OfficeCLI at their local path and report that path to the user.',
    ].join(' ');
  }
  return `${limit} Split the operation into smaller tool calls.`;
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

function isExternalizableInvocation(invocationName: string): boolean {
  return invocationName === 'artifact_create' ||
    invocationName === 'artifact_bundle_create' ||
    invocationName === 'shell_exec' ||
    invocationName === 'shell_session_exec' ||
    invocationName === 'local_file_write';
}
