import type { RuntimeCommandHandler } from '../../core/messaging/runtime-command-registry';
import {
  createBrowserToolRuntimeHandlers,
  type BrowserToolRuntimeHandlerDependencies,
} from './browser-tool-handlers';
import {
  createMcpRuntimeHandlers,
  type McpRuntimeHandlerDependencies,
} from './mcp-handlers';
import {
  createToolExecutionRuntimeHandlers,
  type ToolExecutionRuntimeHandlerDependencies,
} from './tool-execution-handlers';

export interface ToolRuntimeHandlerDependencies {
  mcp: McpRuntimeHandlerDependencies;
  browser: BrowserToolRuntimeHandlerDependencies;
  execution: ToolExecutionRuntimeHandlerDependencies;
}

export function createToolRuntimeHandlers(
  dependencies: ToolRuntimeHandlerDependencies,
): readonly RuntimeCommandHandler[] {
  return Object.freeze([
    ...createMcpRuntimeHandlers(dependencies.mcp),
    ...createBrowserToolRuntimeHandlers(dependencies.browser),
    ...createToolExecutionRuntimeHandlers(dependencies.execution),
  ]);
}
