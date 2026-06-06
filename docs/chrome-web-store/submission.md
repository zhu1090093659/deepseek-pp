# Chrome Web Store Submission Runbook

Last updated: 2026-06-06

This runbook covers the parts that can be prepared from the repository and the parts that must be confirmed in the Chrome Web Store Developer Dashboard.

Official references:

- Publish flow: https://developer.chrome.com/docs/webstore/publish/
- Privacy fields: https://developer.chrome.com/docs/webstore/cws-dashboard-privacy
- Image requirements: https://developer.chrome.com/docs/webstore/images
- Publish API: https://developer.chrome.com/docs/webstore/using-api
- Program policies: https://developer.chrome.com/docs/webstore/program-policies/policies

## Current Status

- Chrome MV3 package exists at `dist/deepseek-plus-plus-0.5.1-chrome.zip`.
- Package root contains `manifest.json`.
- Package size is below the Chrome Web Store package limit.
- Required icon exists at `public/icon/128.png`.
- Required small promo image exists at `docs/chrome-web-store/assets/small-promo.png`.
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
dist/deepseek-plus-plus-0.5.1-chrome.zip
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
Enhance the DeepSeek web chat experience with user-controlled memory, skills, prompt presets, MCP tool execution, local conversation export, and scheduled automation inside chat.deepseek.com.
```

### Data Type Disclosures

Conservative selections for the Chrome Web Store privacy form:

- Website content
- Personal communications
- Authentication information

Rationale:

- Website content: the extension runs on and reads/modifies the DeepSeek web chat UI to provide user-facing features.
- Personal communications: DeepSeek chat prompts and responses may include user communications and are processed to inject memory, skills, tool results, and user-requested local conversation exports.
- Authentication information: optional WebDAV credentials, MCP headers, and native/local tool settings may be stored when the user configures them.

Do not select financial/payment, health, location, or browsing history unless a future version adds those data types explicitly.

### Permission Justifications

Use these in the dashboard permission fields.

#### `storage`

```text
Stores extension data locally, including memories, custom skills, prompt presets, settings, automation tasks, MCP server configuration, and tool execution history. User-started conversation export artifacts are generated locally and saved through the browser download flow.
```

#### `alarms`

```text
Schedules and wakes user-created automation tasks. Automation runs only for tasks configured by the user.
```

#### `nativeMessaging`

```text
Connects to a user-configured local Native Messaging host for local MCP tools. The built-in Shell preset is disabled until the user installs the DeepSeek++ Shell host, configures it, and enables it.
```

#### `sidePanel`

```text
Provides the extension's management UI in Chrome's side panel for memories, skills, presets, MCP tools, conversation export, automation, sync, and settings.
```

#### Host permission: `*://chat.deepseek.com/*`

```text
Runs the extension on the DeepSeek web app so it can inject user-selected context, detect tool-call markup, render tool results, export user-requested conversation history, and support automation inside DeepSeek conversations.
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
- Uses handled data only for its disclosed user-facing features.
- Stores data locally unless the user enables sync or connects user-configured endpoints/hosts.

## Test Instructions

Use this reviewer note:

```text
1. Install the extension and open https://chat.deepseek.com/.
2. Sign in to DeepSeek if prompted.
3. Click the extension action to open the side panel.
4. Create a memory or skill in the side panel.
5. Send a DeepSeek message that uses the saved memory/skill. The extension should inject selected context and render tool execution results inline.
6. Open the Export page in the side panel and start a sanitized JSON/Markdown export. The extension should save local export files after reading the reviewer's own DeepSeek session.
7. Optional MCP/WebDAV/native messaging features require user-provided endpoints or a user-installed local Shell host and are disabled until configured by the user.
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
