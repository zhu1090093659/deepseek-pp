#!/usr/bin/env node
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TOOL_DEFINITIONS } from './contracts.mjs';
import { createFileToolHandlers } from './file-provider.mjs';
import { createNativeMessageChannel, NATIVE_EOF } from './framing.mjs';
import { createHostLogger } from './logger.mjs';
import { initializeHostEnvironment } from './os-adapter.mjs';
import { createPickerToolHandlers } from './picker-provider.mjs';
import { createProcessToolHandlers } from './process-provider.mjs';
import { createNativeRouter, jsonRpcError } from './router.mjs';
import { createSessionProvider } from './session-provider.mjs';
import { createSkillToolHandlers } from './skill-provider.mjs';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const logger = createHostLogger();
initializeHostEnvironment(packageRoot, logger.logLine);

const sessionProvider = createSessionProvider({ logLine: logger.logLine });
const router = createNativeRouter({
  toolDefinitions: TOOL_DEFINITIONS,
  toolHandlerGroups: [
    createProcessToolHandlers(),
    createSkillToolHandlers(),
    createPickerToolHandlers(),
    createFileToolHandlers({ logLine: logger.logLine }),
    sessionProvider.handlers,
  ],
  logger,
});
const channel = createNativeMessageChannel({ logLine: logger.logLine });

async function main() {
  while (true) {
    const envelope = await channel.readMessage();
    if (envelope === NATIVE_EOF) break;
    try {
      const response = await router.handleEnvelope(envelope);
      if (response) await channel.writeMessage(response);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.logLine(`Error: ${message}`);
      await channel.writeMessage(jsonRpcError(null, -32603, message || 'Internal error'));
    }
  }
  sessionProvider.shutdown();
}

main().catch(error => {
  const message = error instanceof Error ? error.message : String(error);
  logger.logLine(`Fatal: ${message}`);
  sessionProvider.shutdown();
  process.exit(1);
});
