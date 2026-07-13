import { readFileSync } from 'node:fs';
import * as ts from 'typescript';
import { describe, expect, it } from 'vitest';
import {
  authorizeRuntimeMessage,
  BACKGROUND_RUNTIME_PATHNAMES,
  createExtensionRuntimeMessageContext,
  createRuntimeBoundaryErrorResponse,
  createRuntimeMessageContext,
  decodeRuntimeMessageEnvelope,
  DEEPSEEK_CONTENT_RUNTIME_COMMANDS,
  RUNTIME_BOUNDARY_ERROR_CODES,
  type RuntimeMessageSenderLike,
} from '../core/messaging/runtime-boundary';

const POLICY = {
  runtimeId: 'runtime-contract',
  extensionOrigin: 'chrome-extension://runtime-contract/',
  deepSeekOrigin: 'https://chat.deepseek.com',
} as const;

const EXTENSION_SENDER: RuntimeMessageSenderLike = {
  id: POLICY.runtimeId,
  url: 'chrome-extension://runtime-contract/sidepanel.html',
  origin: 'chrome-extension://runtime-contract',
  documentId: 'extension-document-1',
  documentLifecycle: 'active',
};

const DEEPSEEK_SENDER: RuntimeMessageSenderLike = {
  id: POLICY.runtimeId,
  url: 'https://chat.deepseek.com/a/chat/s/session-contract',
  origin: 'https://chat.deepseek.com',
  frameId: 0,
  documentId: 'deepseek-document-1',
  documentLifecycle: 'active',
  tab: {
    id: 17,
    url: 'https://chat.deepseek.com/a/chat/s/session-contract',
  },
};

describe('runtime sender and envelope boundary', () => {
  it('preserves a legal extension sender and browser-owned document context', () => {
    expect(createRuntimeMessageContext(EXTENSION_SENDER, POLICY)).toEqual({
      runtimeId: POLICY.runtimeId,
      surface: 'extension_context',
      senderUrl: 'chrome-extension://runtime-contract/sidepanel.html',
      senderOrigin: 'chrome-extension://runtime-contract',
      tabId: undefined,
      tabUrl: undefined,
      frameId: undefined,
      documentId: 'extension-document-1',
      documentLifecycle: 'active',
      documentSessionId: 'extension-document-1',
    });
    expect(createExtensionRuntimeMessageContext(EXTENSION_SENDER, POLICY).surface)
      .toBe('extension_context');
    expect(() => createExtensionRuntimeMessageContext(DEEPSEEK_SENDER, POLICY))
      .toThrow('not an extension context');
    expect(() => createExtensionRuntimeMessageContext(EXTENSION_SENDER, {
      ...POLICY,
      allowedPathnames: BACKGROUND_RUNTIME_PATHNAMES,
    })).toThrow('path is not authorized');
    expect(createExtensionRuntimeMessageContext({
      ...EXTENSION_SENDER,
      url: 'moz-extension://runtime-contract/_generated_background_page.html',
      origin: 'moz-extension://runtime-contract',
    }, {
      runtimeId: POLICY.runtimeId,
      extensionOrigin: 'moz-extension://runtime-contract/',
      allowedPathnames: BACKGROUND_RUNTIME_PATHNAMES,
    }).senderUrl).toBe('moz-extension://runtime-contract/_generated_background_page.html');
  });

  it('preserves a legal DeepSeek top-frame sender and derives its route session', () => {
    expect(createRuntimeMessageContext(DEEPSEEK_SENDER, POLICY)).toEqual({
      runtimeId: POLICY.runtimeId,
      surface: 'deepseek_content',
      senderUrl: 'https://chat.deepseek.com/a/chat/s/session-contract',
      senderOrigin: 'https://chat.deepseek.com',
      tabId: 17,
      tabUrl: 'https://chat.deepseek.com/a/chat/s/session-contract',
      frameId: 0,
      documentId: 'deepseek-document-1',
      documentLifecycle: 'active',
      documentSessionId: 'deepseek-document-1',
      chatSessionId: 'session-contract',
    });
  });

  it('accepts a missing Firefox frameId only with matching top-level tab evidence', () => {
    const context = createRuntimeMessageContext({ ...DEEPSEEK_SENDER, frameId: undefined }, POLICY);
    expect(context.frameId).toBe(0);
    expect(() => createRuntimeMessageContext({
      ...DEEPSEEK_SENDER,
      frameId: undefined,
      tab: { id: 17 },
    }, POLICY)).toThrow('no top-level frame evidence');
  });

  it.each([
    ['other extension id', { ...EXTENSION_SENDER, id: 'other-extension' }],
    ['native application', { ...EXTENSION_SENDER, nativeApplication: 'native-host' }],
    ['inactive document', { ...EXTENSION_SENDER, documentLifecycle: 'cached' }],
    ['origin mismatch', { ...EXTENSION_SENDER, origin: 'chrome-extension://other-extension' }],
    ['invalid document id', { ...EXTENSION_SENDER, documentId: '' }],
    ['invalid extension tab id', { ...EXTENSION_SENDER, tab: { id: -1 } }],
    ['web origin', { ...EXTENSION_SENDER, url: 'https://example.test/sidepanel.html', origin: 'https://example.test' }],
    ['DeepSeek child frame', { ...DEEPSEEK_SENDER, frameId: 2 }],
    ['DeepSeek tab mismatch', { ...DEEPSEEK_SENDER, tab: { id: 17, url: 'https://chat.deepseek.com/a/chat/s/other' } }],
  ] as const)('rejects unauthorized sender context: %s', (_name, sender) => {
    expect(() => createRuntimeMessageContext(sender, POLICY)).toThrow();
  });

  it.each([
    null,
    [],
    'GET_MEMORIES',
    {},
    { type: '' },
    { type: 7 },
  ])('rejects malformed runtime envelope: %j', (message) => {
    expect(() => decodeRuntimeMessageEnvelope(message)).toThrow(
      'Runtime message must be a plain object with a non-empty type.',
    );
  });

  it('authorizes only the frozen content command surface before routing', () => {
    const extensionContext = createRuntimeMessageContext(EXTENSION_SENDER, POLICY);
    const contentContext = createRuntimeMessageContext(DEEPSEEK_SENDER, POLICY);
    expect(DEEPSEEK_CONTENT_RUNTIME_COMMANDS.size).toBe(30);
    expect(() => authorizeRuntimeMessage({ type: 'GET_MEMORIES' }, contentContext)).not.toThrow();
    expect(() => authorizeRuntimeMessage({ type: 'GET_SYNC_CONFIG' }, contentContext))
      .toThrow('not authorized for DeepSeek content');
    expect(() => authorizeRuntimeMessage({ type: 'GET_SYNC_CONFIG' }, extensionContext)).not.toThrow();
  });

  it('matches the exact command literals emitted by DeepSeek content producers', () => {
    const producerFiles = [
      'entrypoints/content.ts',
      'entrypoints/content/adapters/project-sidebar-organizer.ts',
      'core/ui/tool-result-renderer.ts',
    ];
    const produced = new Set(producerFiles.flatMap(extractContentRuntimeCommands));

    expect([...DEEPSEEK_CONTENT_RUNTIME_COMMANDS].sort()).toEqual([...produced].sort());
  });

  it('returns a non-retryable ToolResult-shaped boundary rejection for execution commands', () => {
    const context = createRuntimeMessageContext(DEEPSEEK_SENDER, POLICY);
    let error: unknown;
    try {
      authorizeRuntimeMessage({ type: 'GET_SYNC_CONFIG' }, context);
    } catch (caught) {
      error = caught;
    }
    expect(createRuntimeBoundaryErrorResponse(error, { type: 'EXECUTE_TOOL_CALL' })).toEqual({
      ok: false,
      summary: 'Runtime request rejected',
      detail: 'Runtime command GET_SYNC_CONFIG is not authorized for DeepSeek content.',
      error: {
        code: RUNTIME_BOUNDARY_ERROR_CODES.unauthorizedSender,
        message: 'Runtime command GET_SYNC_CONFIG is not authorized for DeepSeek content.',
        retryable: false,
      },
    });
  });

  it('gates background and content dispatch before their privileged handlers', () => {
    const background = readFileSync('entrypoints/background.ts', 'utf8');
    const content = readFileSync('entrypoints/content.ts', 'utf8');
    const projectSidebar = readFileSync('entrypoints/content/adapters/project-sidebar-organizer.ts', 'utf8');
    const offscreen = readFileSync('entrypoints/sandbox-offscreen/main.ts', 'utf8');

    expectInOrder(background, [
      'decodeRuntimeMessageEnvelope(message)',
      'createRuntimeMessageContext(sender',
      'authorizeRuntimeMessage(envelope, context)',
      'handleMessage(envelope, context)',
    ]);
    expectInOrder(content, [
      'decodeRuntimeMessageEnvelope(message)',
      'createExtensionRuntimeMessageContext(sender',
      "if (message.type === 'STATE_UPDATED')",
    ]);
    expect(projectSidebar).toContain('createExtensionRuntimeMessageContext(sender');
    expect(offscreen).toContain('createExtensionRuntimeMessageContext(port.sender ?? {}');
  });
});

function expectInOrder(source: string, fragments: string[]): void {
  let previous = -1;
  for (const fragment of fragments) {
    const index = source.indexOf(fragment);
    expect(index, `missing ${fragment}`).toBeGreaterThan(previous);
    previous = index;
  }
}

function extractContentRuntimeCommands(path: string): string[] {
  const source = readFileSync(path, 'utf8');
  const sourceFile = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const commands: string[] = [];

  const inspect = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && isContentRuntimeSend(node.expression, sourceFile)) {
      const [message] = node.arguments;
      if (message && ts.isObjectLiteralExpression(message)) {
        const typeProperty = message.properties.find((property): property is ts.PropertyAssignment =>
          ts.isPropertyAssignment(property) && property.name.getText(sourceFile) === 'type',
        );
        if (typeProperty && ts.isStringLiteral(typeProperty.initializer)) {
          commands.push(typeProperty.initializer.text);
        }
      }
    }
    ts.forEachChild(node, inspect);
  };
  inspect(sourceFile);
  return commands;
}

function isContentRuntimeSend(expression: ts.LeftHandSideExpression, sourceFile: ts.SourceFile): boolean {
  if (ts.isIdentifier(expression)) {
    return expression.text === 'sendRuntimeMessage' ||
      expression.text === 'sendRuntimeMessageStrict' ||
      expression.text === 'sendMessage';
  }
  return ts.isPropertyAccessExpression(expression) &&
    expression.getText(sourceFile) === 'chrome.runtime.sendMessage';
}
