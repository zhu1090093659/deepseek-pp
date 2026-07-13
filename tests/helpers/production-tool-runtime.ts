import { createRuntimeToolRuntime } from '../../core/tool/runtime';
import { createProductionToolProviderRegistry } from '../../entrypoints/background/tool-provider-composition';

const runtime = createRuntimeToolRuntime(createProductionToolProviderRegistry());

export const executeRuntimeToolCall = runtime.executeToolCall;
export const getRuntimeAuthorizationDescriptors = runtime.getAuthorizationDescriptors;
export const getRuntimeToolDescriptors = runtime.getToolDescriptors;
export const refreshRuntimeToolDescriptors = runtime.refreshToolDescriptors;
