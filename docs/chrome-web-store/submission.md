# Chrome Web Store Submission Runbook

Last updated: 2026-06-19

This runbook covers the parts that can be prepared from the repository and the parts that must be confirmed in the Chrome Web Store Developer Dashboard.

Official references:

- Publish flow: https://developer.chrome.com/docs/webstore/publish/
- Privacy fields: https://developer.chrome.com/docs/webstore/cws-dashboard-privacy
- Image requirements: https://developer.chrome.com/docs/webstore/images
- Publish API: https://developer.chrome.com/docs/webstore/using-api
- Program policies: https://developer.chrome.com/docs/webstore/program-policies/policies

## Current Status

- Chrome MV3 package exists at `dist/deepseek-plus-plus-1.0.2-chrome.zip`.
- Package root contains `manifest.json`.
- Package size is below the Chrome Web Store package limit.
- Required icon exists at `assets/chrome-web-store-icon-128.png`.
- Required small promo image exists at `assets/chrome-web-store-promo-small-440x280.png`.
- Optional top promo image exists at `assets/chrome-web-store-promo-top-1400x560.png`.
- Required screenshot exists at `docs/chrome-web-store/assets/screenshot-inline-tools-1280x800.png`.
- Remote worker execution has been removed from the PoW path; the extension now uses packaged local code for PoW solving.

## Manual Dashboard Requirements

These cannot be fully automated for the first listing:

1. Sign in to the Chrome Web Store Developer Dashboard with the publisher account.
2. Ensure the Google account has 2-step verification enabled.
3. Complete developer account registration and contact details.
4. Upload the Chrome zip as a new item.
5. Fill Store Listing, Privacy, Distribution, and Test Instructions tabs.
6. Confirm the privacy/data-use certification.
7. Click Submit for Review.

The Chrome Web Store API can upload and publish updates after the first item exists, but the initial listing still requires dashboard setup.

## Upload Package

Use:

```bash
npm run zip:chrome
```

Upload:

```text
dist/deepseek-plus-plus-1.0.2-chrome.zip
```

## Store Listing Fields

Use `docs/chrome-web-store/listing.md` for:

- Name
- Short description
- Detailed description
- zh-CN localization draft
- Homepage and support URLs
- Asset paths

Suggested category:

```text
Productivity
```

## Privacy Tab

### Single Purpose

```text
Enhance the DeepSeek web chat experience with English and Simplified Chinese UI, user-controlled memory, Skills, project context, saved snippets, prompt presets, MCP tool execution, multimodal media analysis, browser control tools, local exports, downloadable artifacts, and scheduled automation inside chat.deepseek.com.
```

### Data Type Disclosures

Conservative selections for the Chrome Web Store privacy form:

- Website content
- Personal communications
- Authentication information

Rationale:

- Website content: the extension runs on and reads/modifies the DeepSeek web chat UI to provide user-facing features.
- Personal communications: DeepSeek chat prompts and responses may include user communications and are processed to inject memory, skills, tool results, multimodal analysis results, and user-requested local conversation exports. User-selected images or videos may also be processed when the user explicitly attaches them for multimodal analysis.
- Authentication information: optional DeepSeek API Key, OpenAI/Gemini API keys for multimodal analysis, WebDAV credentials, MCP headers, and native/local tool settings may be stored when the user configures them.

Do not select financial/payment, health, location, or browsing history unless a future version adds those data types explicitly.

### Permission Justifications

Use these in the dashboard permission fields.

#### `storage`

```text
Stores extension data locally, including memories, custom skills, projects, saved items, prompt presets, settings, automation tasks, MCP server configuration, and tool execution history. User-started exports and generated artifacts are created locally and saved through the browser download flow.
```

#### `alarms`

```text
Schedules and wakes user-created automation tasks. Automation runs only for tasks configured by the user.
```

#### `contextMenus`

```text
Adds right-click actions for selected page text so the user can send the selection to side-panel chat or a configured scenario. Without a DeepSeek API Key, these actions are limited to chat.deepseek.com; with a user-configured API Key, they are available on normal web pages.
```

#### `nativeMessaging`

```text
Connects to user-configured local Native Messaging hosts for local MCP tools, including the Shell host and optional Multimodal Native Host. Built-in native presets remain disabled until the user installs the matching host, configures it, and enables it.
```

#### `offscreen`

```text
Creates an invisible extension document for isolated JavaScript, TypeScript, Python, and HTML sandbox runs. This keeps sandbox execution outside chat.deepseek.com so long-running or timed-out code cannot block the visible DeepSeek chat page.
```

#### `debugger`

```text
Enables the optional Browser Control feature. When the user enables Browser Control, DeepSeek++ attaches to the selected browser tab to read an Accessibility Tree snapshot and perform visible browser actions requested through browser_* tools. Users can disable Browser Control or detach from the selected tab in the side panel.
```

#### `tabs`

```text
Lists browser tabs and lets the user choose which tab Browser Control should operate on. Tab titles and URLs are shown only in the extension side panel and returned as browser-control tool context when the user enables the feature. If the browser exposes tab group metadata without an additional permission, DeepSeek++ may show group names only to help users identify the target tab.
```

#### `sidePanel`

```text
Provides the extension's management UI in Chrome's side panel for memories, skills, presets, MCP tools, automation, sync, and settings.
```

#### Host permission: `*://chat.deepseek.com/*`

```text
Runs the extension on the DeepSeek web app so it can apply user-selected context, render tool results, export user-requested conversation history, support local downloads, and support automation inside DeepSeek conversations.
```

#### Host permission: `https://api.deepseek.com/*`

```text
Allows side-panel chat to send user-entered prompts to the official DeepSeek API when the user configures their own DeepSeek API Key. The extension stores the API Key locally and does not use this host unless the user enables the API-key path.
```

#### Optional host permissions: `http://*/*`, `https://*/*`

```text
Allows users to connect to their own WebDAV or MCP endpoints. The extension requests access to a specific origin only when the user configures, tests, syncs, or executes a tool against that endpoint.
```

### Data Use Certification

Use the privacy policy in `docs/chrome-web-store/privacy-policy.md`. The policy states that DeepSeek++:

- Does not sell user data.
- Does not use user data for advertising.
- Does not transfer user data to advertising platforms, data brokers, or information resellers.
- Uses handled data only for its disclosed user-facing features, including user-requested multimodal media analysis.
- Stores data locally unless the user enables sync or connects user-configured endpoints/hosts.

## Test Instructions

Use this reviewer note:

```text
1. Install the extension and open https://chat.deepseek.com/.
2. Sign in to DeepSeek if prompted.
3. Click the extension action to open the side panel.
4. Open Settings and switch Language between English and Simplified Chinese; the side-panel labels and built-in tool guidance should update.
5. Create a memory or Skill in the side panel.
6. Send a DeepSeek message that uses the saved memory/Skill. The extension should use the selected language for extension UI while preserving the user-authored memory/Skill text.
7. In a DeepSeek conversation, use the DeepSeek++ export button next to the official reply actions such as copy and share. The extension should show format choices, default to HTML, and save the selected current-conversation export formats locally.
8. In the side panel, create a saved snippet and insert it into chat, then export saved items as Markdown or JSON.
9. In Capabilities > Browser, enable Browser Control, choose a normal web tab, and verify the page shows a selected target. Browser Control can be disabled or detached from the same page.
10. Optional MCP/WebDAV/native messaging features require user-provided endpoints or a user-installed local Shell host and are disabled until configured by the user.
11. Optional multimodal media analysis requires the user to install the Multimodal Native Host, configure OpenAI/Gemini settings in Settings > Multimodal API, and attach media manually. If it is not configured, the feature remains unavailable and shows setup guidance.
```

No test account is included because the extension works with the reviewer's own DeepSeek session.

## Update Automation After First Listing

After the first Chrome Web Store item exists, set these GitHub repository secrets:

```text
CHROME_EXTENSION_ID
CHROME_CLIENT_ID
CHROME_CLIENT_SECRET
CHROME_REFRESH_TOKEN
```

Then run the `Chrome Web Store` workflow manually.

Recommended first workflow run:

- `dry_run`: `true`
- `submit_review`: `false`

Upload without review:

- `dry_run`: `false`
- `submit_review`: `false`

Upload and submit for review:

- `dry_run`: `false`
- `submit_review`: `true`

Local equivalents:

```bash
npm run zip:chrome
npm run submit:chrome:dry
npm run submit:chrome:upload
npm run submit:chrome
```

The local commands read Chrome Web Store credentials from environment variables or an ignored `.env.submit` file.
