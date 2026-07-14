import {
  startChatLauncher,
  type ChatLauncherController,
} from './chat-launcher';

export interface ChatLauncherPageLifecycle {
  stop(): void;
}

export interface ChatLauncherPageLifecycleDependencies {
  startLauncher(): ChatLauncherController;
  addPageListener(type: 'pagehide' | 'pageshow', listener: (event: PageTransitionEvent) => void): void;
  removePageListener(type: 'pagehide' | 'pageshow', listener: (event: PageTransitionEvent) => void): void;
}

let activeLifecycleStop: (() => void) | null = null;

export function startChatLauncherPageLifecycle(
  dependencies: ChatLauncherPageLifecycleDependencies = browserPageLifecycleDependencies,
): ChatLauncherPageLifecycle {
  activeLifecycleStop?.();
  let launcher: ChatLauncherController | null = dependencies.startLauncher();
  let disposed = false;

  const onPageHide = () => {
    launcher?.stop();
    launcher = null;
  };
  const onPageShow = (event: PageTransitionEvent) => {
    if (!disposed && event.persisted && !launcher) {
      launcher = dependencies.startLauncher();
    }
  };
  const stop = () => {
    if (disposed) return;
    disposed = true;
    launcher?.stop();
    launcher = null;
    dependencies.removePageListener('pagehide', onPageHide);
    dependencies.removePageListener('pageshow', onPageShow);
    if (activeLifecycleStop === stop) activeLifecycleStop = null;
  };

  dependencies.addPageListener('pagehide', onPageHide);
  dependencies.addPageListener('pageshow', onPageShow);
  activeLifecycleStop = stop;
  return { stop };
}

const browserPageLifecycleDependencies: ChatLauncherPageLifecycleDependencies = {
  startLauncher: startChatLauncher,
  addPageListener(type, listener) {
    window.addEventListener(type, listener);
  },
  removePageListener(type, listener) {
    window.removeEventListener(type, listener);
  },
};
