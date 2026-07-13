import { readFileSync } from 'node:fs';
import * as ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { createBackgroundErrorResponse } from '../core/messaging/background-error';
import { decodeRuntimeMessageEnvelope } from '../core/messaging/runtime-boundary';
import {
  RUNTIME_CURRENT_GAPS,
  RUNTIME_COMMAND_CONTRACTS,
  RUNTIME_ERROR_FIXTURES,
  RUNTIME_NOTIFICATION_TYPES,
  RUNTIME_REQUEST_FIXTURES,
  RUNTIME_RESOLVED_BOUNDARY_CASES,
  RUNTIME_RESPONSE_FIXTURES,
  RUNTIME_TAB_RPC_TYPES,
  RUNTIME_TOPOLOGY,
  type RuntimeErrorFamily,
  type RuntimePayloadPresence,
  type RuntimeRequestBoundary,
} from './fixtures/runtime-contract/runtime';

const backgroundSource = readFileSync('entrypoints/background.ts', 'utf8');
const typesSource = readFileSync('core/types.ts', 'utf8');
const inventorySource = readFileSync('docs/compatibility/runtime-command-inventory.md', 'utf8');

describe('runtime command compatibility contract', () => {
  it('matches the live router, MessageAction union, and checked-in human inventory', () => {
    const liveContracts = extractHandleMessageContracts(backgroundSource);
    const live = liveContracts.map((contract) => contract.type);
    const declaredContracts = extractMessageActionContracts(typesSource);
    const declared = declaredContracts.map((contract) => contract.type);
    const shared = live.filter((type) => declared.includes(type));
    const liveOnly = live.filter((type) => !declared.includes(type));
    const declaredOnly = declared.filter((type) => !live.includes(type));
    const registryEntries = Object.entries(RUNTIME_COMMAND_CONTRACTS);
    const registryLive = registryEntries
      .filter(([, contract]) => contract.surface !== 'declared-only')
      .map(([type]) => type);
    const registryDeclared = registryEntries
      .filter(([, contract]) => contract.surface !== 'live-only')
      .map(([type]) => type);

    expectSortedEqual(live, readInventoryList('Live Background Router'));
    expectSortedEqual(declared, readInventoryList('Declared `MessageAction` Union'));
    expectSortedEqual(liveOnly, readInventoryList('Live Router Only'));
    expectSortedEqual(declaredOnly, readInventoryList('Declared Only'));
    expectSortedEqual(registryLive, live);
    expectSortedEqual(registryDeclared, declared);
    expect(registryEntries).toHaveLength(123);
    for (const contract of liveContracts) {
      const registered = RUNTIME_COMMAND_CONTRACTS[contract.type as keyof typeof RUNTIME_COMMAND_CONTRACTS];
      expect(registered.request.access).toBe(contract.requestAccess);
      expect(registered.error).toBe(contract.error);
    }
    for (const contract of declaredContracts) {
      const registered = RUNTIME_COMMAND_CONTRACTS[contract.type as keyof typeof RUNTIME_COMMAND_CONTRACTS];
      expect(registered.request.presence).toBe(contract.payloadPresence);
    }
    expect({
      liveCommands: live.length,
      declaredActions: declared.length,
      shared: shared.length,
      liveOnly: liveOnly.length,
      declaredOnly: declaredOnly.length,
      readsPayload: liveContracts.filter((contract) => contract.readsPayload).length,
      ignoresPayload: liveContracts.filter((contract) => !contract.readsPayload).length,
      directPayloadCasts: liveContracts.filter((contract) => contract.directPayloadCast).length,
    }).toEqual(RUNTIME_TOPOLOGY);
    expect(new Set(live).size).toBe(live.length);
    expect(new Set(declared).size).toBe(declared.length);
  });

  it('freezes serializable request and response families without creating a second router', () => {
    for (const fixture of RUNTIME_REQUEST_FIXTURES) {
      expect(JSON.parse(JSON.stringify(fixture.message))).toEqual(fixture.message);
    }
    for (const fixture of RUNTIME_RESPONSE_FIXTURES) {
      expect(JSON.parse(JSON.stringify(fixture.response))).toEqual(fixture.response);
    }

    expect(new Set(RUNTIME_REQUEST_FIXTURES.map((fixture) => fixture.family))).toEqual(new Set([
      'none',
      'required',
      'optional',
      'tool-call',
      'sandbox-request',
    ]));
    expect(new Set(RUNTIME_RESPONSE_FIXTURES.map((fixture) => fixture.family))).toEqual(new Set([
      'value',
      'nullable-value',
      'ack',
      'status',
      'tool-result',
      'domain-error',
      'status-or-domain-error',
      'value-or-domain-error',
    ]));
    const responseFixtureFamilies = new Set(RUNTIME_RESPONSE_FIXTURES.map((fixture) => fixture.family));
    for (const contract of Object.values(RUNTIME_COMMAND_CONTRACTS)) {
      if (contract.response !== 'unrouted') expect(responseFixtureFamilies.has(contract.response)).toBe(true);
    }
  });

  it('freezes handler-level error responses independently of localized copy', () => {
    const nonObject = RUNTIME_ERROR_FIXTURES.nonObjectMessage;
    const tool = RUNTIME_ERROR_FIXTURES.toolHandlerRejection;
    const generic = RUNTIME_ERROR_FIXTURES.genericHandlerRejection;

    expect(createBackgroundErrorResponse(nonObject.message, nonObject.error, 'Tool execution failed'))
      .toEqual(nonObject.response);
    expect(createBackgroundErrorResponse(tool.message, new Error(tool.error), tool.response.summary))
      .toEqual(tool.response);
    expect(createBackgroundErrorResponse(generic.message, new Error(generic.error), 'unused'))
      .toEqual(generic.response);
  });

  it('characterizes malformed routing gaps without treating them as target behavior', () => {
    expect(RUNTIME_CURRENT_GAPS.map((gap) => gap.target)).toEqual([
      'explicit-rejection-after-T3.1',
      'decoded-command-contract-after-T3.1',
      'single-exhaustive-command-map-after-T3.1',
    ]);
    expect(extractHandleMessageDefaultReturnsNull(backgroundSource)).toBe(true);
    for (const resolved of RUNTIME_RESOLVED_BOUNDARY_CASES) {
      expect(resolved.target).toBe('explicit-rejection-at-T2.1-boundary');
      expect(() => decodeRuntimeMessageEnvelope(resolved.input)).toThrow();
    }
  });

  it('freezes all runtime notifications and tab RPC names', () => {
    const broadcastTypes = matches(backgroundSource, /broadcastToTabs\(\{\s*type:\s*'([^']+)'/g);
    const runtimeNotificationTypes = matches(backgroundSource, /chrome\.runtime\.sendMessage\(\{\s*type:\s*'([^']+)'/g);
    const notificationTypes = [...broadcastTypes, ...runtimeNotificationTypes];
    const directTabRpcTypes = matches(
      backgroundSource,
      /chrome\.tabs\.sendMessage\([^,]+,\s*\{\s*type:\s*'([^']+)'/g,
    );
    const refreshAuthType = backgroundSource.match(/const REFRESH_AUTH_MESSAGE = \{ type: '([^']+)' \}/)?.[1];

    expect(new Set(notificationTypes)).toEqual(new Set(RUNTIME_NOTIFICATION_TYPES));
    expect(notificationTypes).toHaveLength(RUNTIME_NOTIFICATION_TYPES.length);
    expect([refreshAuthType, ...directTabRpcTypes]).toEqual([...RUNTIME_TAB_RPC_TYPES]);
  });
});

interface RuntimeCaseContract {
  type: string;
  readsPayload: boolean;
  directPayloadCast: boolean;
  requestAccess: RuntimeRequestBoundary;
  error: RuntimeErrorFamily;
}

function extractHandleMessageContracts(source: string): RuntimeCaseContract[] {
  const sourceFile = ts.createSourceFile('background.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  let handleMessage: ts.FunctionDeclaration | undefined;

  sourceFile.forEachChild((node) => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === 'handleMessage') {
      handleMessage = node;
    }
  });
  if (!handleMessage?.body) throw new Error('handleMessage function not found');

  const switchStatement = handleMessage.body.statements.find(ts.isSwitchStatement);
  if (!switchStatement) throw new Error('handleMessage switch not found');

  return switchStatement.caseBlock.clauses.flatMap((clause) => {
    if (!ts.isCaseClause(clause) || !ts.isStringLiteral(clause.expression)) return [];
    let readsPayload = false;
    let directPayloadCast = false;
    const inspect = (node: ts.Node) => {
      if (isMessagePayloadAccess(node)) readsPayload = true;
      if (ts.isAsExpression(node) && isMessagePayloadAccess(node.expression)) directPayloadCast = true;
      ts.forEachChild(node, inspect);
    };
    clause.statements.forEach(inspect);
    const type = clause.expression.text;
    return [{
      type,
      readsPayload,
      directPayloadCast,
      requestAccess: readsPayload ? directPayloadCast ? 'payload-cast' : 'payload-delegated' : 'none',
      error: type === 'EXECUTE_TOOL_CALL' ? 'tool-error' : 'background-error',
    }];
  });
}

interface MessageActionContract {
  type: string;
  payloadPresence: RuntimePayloadPresence;
}

function extractMessageActionContracts(source: string): MessageActionContract[] {
  const sourceFile = ts.createSourceFile('types.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  let actionAlias: ts.TypeAliasDeclaration | undefined;

  sourceFile.forEachChild((node) => {
    if (ts.isTypeAliasDeclaration(node) && node.name.text === 'MessageAction') {
      actionAlias = node;
    }
  });
  if (!actionAlias || !ts.isUnionTypeNode(actionAlias.type)) {
    throw new Error('MessageAction union not found');
  }

  return actionAlias.type.types.map((member) => {
    if (!ts.isTypeLiteralNode(member)) throw new Error('MessageAction member is not a type literal');
    const typeProperty = member.members.find((candidate): candidate is ts.PropertySignature =>
      ts.isPropertySignature(candidate) && candidate.name.getText(sourceFile) === 'type',
    );
    const literal = typeProperty?.type;
    if (!literal || !ts.isLiteralTypeNode(literal) || !ts.isStringLiteral(literal.literal)) {
      throw new Error('MessageAction member has no string-literal type');
    }
    const payloadProperty = member.members.find((candidate): candidate is ts.PropertySignature =>
      ts.isPropertySignature(candidate) && candidate.name.getText(sourceFile) === 'payload',
    );
    return {
      type: literal.literal.text,
      payloadPresence: payloadProperty ? payloadProperty.questionToken ? 'optional' : 'required' : 'none',
    };
  });
}

function extractHandleMessageDefaultReturnsNull(source: string): boolean {
  const sourceFile = ts.createSourceFile('background.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  let returnsNull = false;
  const inspect = (node: ts.Node) => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === 'handleMessage' && node.body) {
      const switchStatement = node.body.statements.find(ts.isSwitchStatement);
      const defaultClause = switchStatement?.caseBlock.clauses.find(ts.isDefaultClause);
      returnsNull = Boolean(defaultClause?.statements.some(
        (statement) => ts.isReturnStatement(statement) && statement.expression?.kind === ts.SyntaxKind.NullKeyword,
      ));
      return;
    }
    ts.forEachChild(node, inspect);
  };
  inspect(sourceFile);
  return returnsNull;
}

function isMessagePayloadAccess(node: ts.Node): node is ts.PropertyAccessExpression {
  return ts.isPropertyAccessExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === 'message' &&
    node.name.text === 'payload';
}

function readInventoryList(heading: string): string[] {
  const escapedHeading = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const fence = '`'.repeat(3);
  const block = inventorySource.match(
    new RegExp(`## ${escapedHeading}[^\\n]*\\n\\n${fence}text\\n([\\s\\S]*?)\\n${fence}`),
  )?.[1];
  if (!block) throw new Error(`Inventory block not found: ${heading}`);
  return block.split('\n').filter(Boolean);
}

function matches(source: string, pattern: RegExp): string[] {
  return [...source.matchAll(pattern)].map((match) => match[1]);
}

function expectSortedEqual(actual: readonly string[], expected: readonly string[]): void {
  expect([...actual].sort()).toEqual([...expected].sort());
}
