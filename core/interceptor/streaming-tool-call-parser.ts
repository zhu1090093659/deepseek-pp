import type { ToolCall, ToolDescriptor, ToolError } from '../types';
import {
  createToolCallFromInvocation,
  createToolInvocationCatalog,
  getToolCloseTag,
  type ToolInvocationCatalog,
} from '../tool';
import { createExternalizedToolPayload } from '../tool/externalized-payload';
import {
  findFirstXmlToolTag,
  getPartialXmlToolTagTailLength,
} from '../tool/xml-tags';

const STREAM_TOOL_RAW_MAX_LENGTH = 2048;
const TRUNCATION_SUFFIX = '\n...[truncated]';
const EXTERNALIZE_BODY_THRESHOLD_CHARS = 64_000;

export interface StreamingToolCallParserEvent {
  started: ToolCall[];
  completed: ToolCall[];
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

export function createStreamingToolCallParser(
  descriptors: readonly ToolDescriptor[],
): StreamingToolCallParser {
  return new XmlStreamingToolCallParser(createToolInvocationCatalog(descriptors));
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
  } | null = null;

  constructor(private readonly catalog: ToolInvocationCatalog) {
    this.invocationNames = new Set(catalog.invocationNames);
  }

  append(chunk: string): StreamingToolCallParserEvent {
    const event: StreamingToolCallParserEvent = { started: [], completed: [], streamed: [] };
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
    this.state = 'NORMAL';
    this.pendingNormal = '';
    this.pendingSuppressed = '';
    this.current = null;
    return { started: [], completed: [], streamed: [] };
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

    if (!closeTag) {
      const tailLength = getPartialXmlToolTagTailLength(text, new Set([current.invocationName]), { closing: true });
      this.appendBody(text.slice(0, text.length - tailLength), event);
      this.pendingSuppressed = tailLength > 0 ? text.slice(-tailLength) : '';
      return '';
    }

    this.appendBody(text.slice(0, closeTag.index), event);
    event.completed.push(this.createCompletedCall({ ...current, closeTag: closeTag.raw }));
    this.state = 'NORMAL';
    this.pendingSuppressed = '';
    this.current = null;
    return text.slice(closeTag.endIndex);
  }

  private appendBody(value: string, event: StreamingToolCallParserEvent): void {
    if (!value || !this.current) return;
    this.current.bodyLength += value.length;
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
        { id: current.id },
      );
    }

    const body = current.bodyParts.join('');
    const raw = createBoundedRaw(current, body);

    try {
      const parsed = body.length === 0 ? {} : JSON.parse(body);
      if (!isToolPayload(parsed)) {
        return createToolCallFromInvocation(current.invocationName, {}, raw, this.catalog, {
          id: current.id,
          parseError: createToolParseError(
            'tool_call_payload_invalid',
            current.invocationName,
            'Tool call body must be a JSON object.',
          ),
        });
      }
      return createToolCallFromInvocation(current.invocationName, parsed, raw, this.catalog, {
        id: current.id,
      });
    } catch (error) {
      return createToolCallFromInvocation(current.invocationName, {}, raw, this.catalog, {
        id: current.id,
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
