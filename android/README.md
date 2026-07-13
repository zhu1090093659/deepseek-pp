# DeepSeek++ Android

This is the Android WebView baseline for DeepSeek++. It loads `chat.deepseek.com` and injects the staged DeepSeek++ web bundle only when the WebView can expose an exact-origin WebMessage bridge.

## Build

From the repository root:

```bash
npm run build:android
npm run android:assemble:debug
```

`npm run build:android` builds the Chrome MV3 bundle and stages it under `android/app/src/main/assets/dpp/`. The Gradle task writes the debug APK under `android/app/build/outputs/apk/debug/`.

## Developer Scope

The Android target is a WebView baseline for capability validation, not a replacement for the browser extension store packages. It keeps user-visible DeepSeek++ features that can run in a WebView and explicitly disables browser-extension-only surfaces.

Unsupported on Android:

- Browser side panel APIs.
- Native Messaging and Shell Native Host.
- Browser context menus.
- Background alarms.
- Browser-extension download and file-picker APIs when no native bridge equivalent exists.

Supported validation target:

- Web bundle staging.
- Native bridge capability wiring.
- Parsed origin and structured bridge contract tests.
- Login/session smoke after an APK can be built.
- Clear unsupported-status messaging for gated features.

## Validation Levels

- TypeScript contract tests validate the shared platform capability boundary.
- `npm run build:android` validates web bundle staging.
- `npm run android:assemble:debug` requires a local JDK and Gradle or Gradle wrapper.
- `npm run test:android` requires the same local JDK and Android Gradle environment.
- Emulator/WebView login smoke is a separate manual check after the APK builds.

Unsupported browser-extension features are intentionally capability-gated on Android, including Native Messaging, Shell Native Host, browser side panel APIs, context menus, and alarms.

## Current Local Evidence

As of 2026-07-13:

- JavaScript/static Android contract tests cover the exact origin, versioned bridge, allowlists, response correlation, and unsupported paths.
- `java -version` fails on this machine because no Java Runtime is installed.
- `npm run android:assemble:debug` and `npm run test:android` stop at the explicit JDK check.

Install a local JDK before claiming APK or Android unit-test validation.
