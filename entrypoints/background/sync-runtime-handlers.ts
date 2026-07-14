import {
  createSyncCommandErrorResponse,
  type SyncDownloadResult,
  type SyncOperationCoordinator,
} from '../../core/sync/operation-coordinator';
import type { RuntimeMessageContext } from '../../core/messaging/runtime-boundary';
import {
  definePayloadlessRuntimeCommandHandler,
  type RuntimeCommandHandler,
} from '../../core/messaging/runtime-command-registry';
import { defineBackgroundPayloadRuntimeCommandHandler } from './runtime-handler';

export interface SyncRuntimeHandlerDependencies {
  coordinator: SyncOperationCoordinator;
  notifyDownloadedState(
    result: SyncDownloadResult,
    context: RuntimeMessageContext,
  ): Promise<void>;
}

export function createSyncRuntimeHandlers(
  dependencies: SyncRuntimeHandlerDependencies,
): readonly RuntimeCommandHandler[] {
  return Object.freeze([
    definePayloadlessRuntimeCommandHandler('GET_SYNC_CONFIG', () => (
      dependencies.coordinator.getConfig()
    )),
    defineBackgroundPayloadRuntimeCommandHandler('SAVE_SYNC_CONFIG', (target) => (
      runSyncCommand(() => dependencies.coordinator.save(target))
    )),
    defineBackgroundPayloadRuntimeCommandHandler('WEBDAV_TEST', (target) => (
      runSyncCommand(() => dependencies.coordinator.test(target))
    )),
    defineBackgroundPayloadRuntimeCommandHandler('SYNC_AUTHORIZE', (target) => (
      runSyncCommand(() => dependencies.coordinator.authorize(target))
    )),
    defineBackgroundPayloadRuntimeCommandHandler('WEBDAV_UPLOAD_LOCAL', (target) => (
      runSyncCommand(() => dependencies.coordinator.upload(target))
    )),
    defineBackgroundPayloadRuntimeCommandHandler(
      'WEBDAV_DOWNLOAD_REMOTE',
      (target, context) => runSyncCommand(() => dependencies.coordinator.download(
        target,
        (result) => dependencies.notifyDownloadedState(result, context),
      )),
    ),
  ]);
}

async function runSyncCommand<T>(operation: () => Promise<T>) {
  try {
    return await operation();
  } catch (error) {
    const response = createSyncCommandErrorResponse(error);
    if (response) return response;
    throw error;
  }
}
