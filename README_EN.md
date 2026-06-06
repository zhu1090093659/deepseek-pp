<p align="center">
  <img src="assets/readme-header.png" width="860" alt="DeepSeek++">
</p>

<h1 align="center">DeepSeek++</h1>

<p align="center">
  <strong>Turn DeepSeek Web into an AI agent workspace with memory, tools, MCP, Skills, and automation.</strong>
</p>

<p align="center">
  <a href="https://github.com/zhu1090093659/deepseek-pp/stargazers"><img alt="Stars" src="https://img.shields.io/github/stars/zhu1090093659/deepseek-pp?style=flat-square"></a>
  <a href="https://github.com/zhu1090093659/deepseek-pp/watchers"><img alt="Watchers" src="https://img.shields.io/github/watchers/zhu1090093659/deepseek-pp?style=flat-square"></a>
  <a href="https://github.com/zhu1090093659/deepseek-pp/network/members"><img alt="Forks" src="https://img.shields.io/github/forks/zhu1090093659/deepseek-pp?style=flat-square"></a>
  <a href="https://github.com/zhu1090093659/deepseek-pp/issues"><img alt="Issues" src="https://img.shields.io/github/issues/zhu1090093659/deepseek-pp?style=flat-square"></a>
</p>

<p align="center">
  <a href="https://github.com/zhu1090093659/deepseek-pp/releases"><img alt="Release" src="https://img.shields.io/github/v/release/zhu1090093659/deepseek-pp?style=flat-square&label=release"></a>
  <a href="#license"><img alt="License" src="https://img.shields.io/badge/license-MIT-2563eb?style=flat-square"></a>
  <a href="https://chat.deepseek.com"><img alt="DeepSeek" src="https://img.shields.io/badge/DeepSeek-web-4f46e5?style=flat-square"></a>
  <a href="https://linux.do"><img alt="LINUX DO" src="https://img.shields.io/badge/LINUX-DO-f59e0b?style=flat-square"></a>
</p>

<p align="center">
  <a href="README.md">Chinese README</a> ·
  <a href="#feature-overview">Feature Overview</a> ·
  <a href="#use-cases">Use Cases</a> ·
  <a href="#installation">Installation</a> ·
  <a href="#061-release-highlights">0.6.1 Highlights</a>
</p>

DeepSeek++ is a Chrome / Edge / Firefox browser extension for [DeepSeek Web](https://chat.deepseek.com). It adds side-panel chat, native-feeling tool execution, built-in web tools, MCP tools, long-term memory, Skills, system prompt presets, conversation export, agentic continuation, and automation tasks.

It can send selected web-page text to DeepSeek, keep working through multi-step tool tasks, search the web, read web pages, track scheduled tasks, and turn project context, personal preferences, and repeatable workflows into reusable memories and Skills.

## Table of Contents

- [Feature Overview](#feature-overview)
- [Use Cases](#use-cases)
- [Core Features](#core-features)
- [0.6.1 Release Highlights](#061-release-highlights)
- [Installation](#installation)
- [Friendly Links](#friendly-links)

## Feature Overview

| Need | What DeepSeek++ provides |
|------|--------------------------|
| DeepSeek Chrome extension | Adds side-panel chat, right-click text sending, tool-result rendering, and multi-browser support for DeepSeek Web. |
| DeepSeek MCP tools | Lets you manage MCP services, tool permissions, and execution status in the side panel, then sends tool results back into the same conversation. |
| DeepSeek memory | Automatically saves, filters, and injects long-term memory so different conversations can reuse user preferences, project context, and common facts. |
| DeepSeek Skills / `/skill` workflows | Switches quickly between built-in, custom, and GitHub-imported Skills for expert modes and task templates. |
| DeepSeek conversation export | Exports DeepSeek conversation history from the side panel as JSON, Markdown, or print-ready HTML, including attachment references and metadata. |
| DeepSeek automation | Runs fixed tasks in dedicated DeepSeek conversations with manual start, scheduled triggers, status tracking, and manual stop. |
| DeepSeek web search / web fetch | Searches the web or reads specified pages when current information or source material is needed, then continues to the final answer. |

## Use Cases

- Turn DeepSeek Web into an AI agent workspace with tool execution, MCP, memory, and automation.
- Use DeepSeek side-panel chat, selected-text actions, and reusable prompt scenarios directly in Chrome, Edge, or Firefox.
- Save project context, personal preferences, common workflows, and document-processing routines as long-term memory and reusable Skills.
- Back up your own DeepSeek conversation history locally as readable files for archive, migration, or later search.
- Let DeepSeek handle tasks that require multi-step tool execution, web search, page reading, or scheduled follow-up.

## Core Features

### Side-Panel Chat

- **Optional chat entry** - After it is enabled in settings, the side panel shows a Chat page where you can message DeepSeek directly.
- **Right-click selected text** - Select text on any page and send it to the side-panel chat for quick explanation, summary, or rewriting.
- **Right-click scenarios** - Configure reusable scenario templates that wrap selected text in fixed prompts.
- **Independent new conversations** - Create new side-panel conversations to avoid mixing with the current page conversation.
- **Streaming display** - Responses render continuously in the side panel. If login is missing, the extension prompts you to return to DeepSeek and sign in.

### Native-Feeling Tool Calls

- **Automatic detection and execution** - When the model asks to call a tool, the extension detects and runs it without requiring manual copying.
- **Clean visible output** - Technical call details stay hidden from the page; users see concise execution results.
- **Native-style rendering** - Tool results appear as collapsible blocks such as "Executed tools (2)" with itemized results.
- **Multiple tool calls per response** - A single answer can run multiple tool calls, which is useful for saving independent facts as separate memories.
- **Restored after refresh** - Tool execution records can be restored after the conversation page is refreshed.
- **Output speed indicator** - While a response is streaming, the input area shows live `tok/s` so you can tell whether the conversation is still producing output.

<p align="center">
  <img src="assets/yuansheng.jpg" width="300" alt="Tool execution display">
</p>

### Conversation Export

- **Full history export** - Export DeepSeek conversation records available to the current signed-in account from the side panel.
- **Multiple outputs** - JSON and Markdown are generated by default, with optional print-ready HTML for PDF archiving.
- **Two modes** - Readable mode hides extension-internal prompt and tool-call markup; raw mode keeps official raw payloads for private archival use.
- **Attachment manifest** - Includes file references, names, sizes, statuses, and message links. File body export stays disabled until the download path is verified.
- **Local saves** - Export files are saved through the browser's local download flow. DeepSeek++ does not operate a backend for collecting export data.

### Built-In Web Tools

- **Web search** - The model can call `web_search` when it needs current information, fact checking, or source links.
- **Web fetch** - The model can call `web_fetch` to read visible text from a user-provided page for further summary or analysis.
- **Automatic continuation** - After search or fetch completes, the result returns to the same conversation and the model continues to the final answer.
- **Tool toggles** - Built-in web tools can be enabled or disabled individually from the Tools page in the side panel.
- **Permission management** - Page fetching can request per-site permission from the side panel, while search uses built-in permissions for common search sources.
- **Diagnostics** - The side panel includes search diagnostics to confirm current network and permission status.

### Agentic Continuation

- **Keep progressing through tasks** - Like Claude Code or Codex, the model can inspect tool results and decide the next step instead of stopping after one tool call.
- **Step-by-step continuation** - MCP tool results are sent back into the same conversation until the task is done or no more tools are needed.
- **Pacing control** - Multi-step continuation leaves a short interval between requests to reduce interruptions during long tasks.
- **Step blocks** - Continuous execution is displayed by step; completed steps collapse automatically so long tasks do not bury the main answer.
- **Refresh recovery** - Recent tool execution progress and final status can be restored after the page is refreshed.
- **Manual stop** - Long-running continuation can be stopped manually.

<p align="center">
  <img src="assets/screenshot-inline-tools.svg" width="720" alt="Tool continuation and speed display">
</p>

### Floating Pet

- **State-aware feedback** - DeepSeek pages can show the DeepSeek whale pet, which reacts to thinking, streaming, tool execution, success, and failure states.
- **Speech bubble** - The pet shows short status lines and rotates them during long thinking, streaming, or tool-execution periods.
- **Adjustable position** - Pin it to the lower-left or lower-right corner, or drag it to a custom position.
- **Adjustable appearance** - Configure size, opacity, and floating animation in settings.
- **Local persistence** - The on/off state, position, and appearance are stored locally in the browser and survive refreshes.

<p align="center">
  <img src="public/pet/deepseek-whale-pet-states.png" width="420" alt="DeepSeek whale pet states">
</p>

### MCP Tool System

- **Flexible connections** - Add remote or local MCP services for browser-side tools, local commands, or team tools.
- **Automatic execution by default** - Newly added MCP services run automatically by default, with per-service and per-tool switches for manual execution.
- **Permission and status management** - Authorize tools, test connections, refresh tool lists, and inspect status from the side panel.
- **Results return automatically** - Tool results return to the same conversation so the model can keep generating.
- **Agentic continuation support** - MCP tool results can feed back into the original conversation, supporting multi-step long-running tasks.
- **Local security** - MCP configuration and secrets stay in browser-local storage. WebDAV sync does not sync sensitive data.

<p align="center">
  <img src="assets/screenshot-sidepanel-mcp.svg" width="300" alt="MCP management side panel">
</p>

### OfficeCLI Document Tools

- **Built-in `/officecli` Skill** - A controlled workflow for inspecting, locating issues, validating, and editing `.docx`, `.xlsx`, and `.pptx` files.
- **Official Skill library** - Includes official OfficeCLI Skills for DOCX, XLSX, PPTX, Pitch Deck, Academic Paper, Financial Model, Dashboard, Morph PPT, and more.
- **Official style library** - Includes the official OfficeCLI PPT styles index and style descriptions, with chainable loading such as `/officecli-pptx /officecli-styles ...`.
- **Runs through Shell MCP** - After creating the Shell preset in the side panel, the model can call command-based OfficeCLI through `shell_exec`.
- **Automatic command-line installation** - `deepseek-pp-shell-host` installs the command-based OfficeCLI binary from official iOfficeAI/OfficeCLI release assets according to your OS and processor type.
- **Command mode first** - The Skill checks that `officecli --help` exposes scriptable commands such as `view`, `get`, `set`, and `batch`.
- **Rejects hosted quota generation paths** - If the current binary only exposes hosted generation commands such as `new --prompt`, the Skill stops and asks you to switch to the command-based OfficeCLI binary.
- **Real local paths** - Document paths come from the user or from Shell MCP queries. The workflow does not guess placeholder directories.

Install the Shell Native Host:

```bash
npx deepseek-pp-shell-host install --browser chrome --extension-id <extension-id>
```

The side-panel MCP page automatically fills in the current extension ID. This command installs both the Shell Native Host and command-based OfficeCLI. The Shell MCP enables local command execution. After installation, restart the browser, open the MCP page in the side panel, create the Shell preset, then test and refresh tools. Command-based OfficeCLI can continue using scriptable commands such as `create`, `get`, `set`, `view`, `batch`, and `validate` without using hosted `new --prompt` quota.

When developing from source, you can also use:

```bash
npm run shell:install -- --browser chrome --extension-id <extension-id>
```

### Memory System

- **Automatic memory** - The AI can recognize important information during conversation and save it as long-term memory.
- **Smart injection** - Each conversation automatically receives relevant memories selected by keyword matching, pin weight, access frequency, and other signals.
- **Four memory types** - User profile (`user`), behavioral feedback (`feedback`), topic context (`topic`), and reference material (`reference`).
- **Side-panel management** - View, edit, pin, delete, filter by type, and manage tags.
- **Import and export** - Back up and restore memories in JSON format.

<p align="center">
  <img src="assets/screenshot-sidepanel-memory.png" width="300" alt="Memory management side panel">
</p>

### Skill System

- **Built-in Skills** - Includes ready-to-use general collaboration Skills and official OfficeCLI document Skills.
- **Custom Skills** - Create your own Skills in the side panel with system instructions and parameters.
- **GitHub import** - Preview and import third-party Skills from a GitHub repository, directory, or direct `SKILL.md` link.
- **Source and update metadata** - GitHub-imported Skills show source repository, version, license, sync time, and upstream update checks.
- **Enable control** - Custom and GitHub-imported Skills can be enabled, disabled, or deleted independently without affecting other local Skills.
- **Slash trigger** - Type `/` in the chat box to open autocomplete and inject the selected Skill's system prompt.
- **Memory integration** - Skills can choose whether to include memory context.

<p align="center">
  <img src="assets/screenshot-skill-popup.png" width="600" alt="Skill autocomplete popup">
  <br>
  <img src="assets/screenshot-sidepanel-skill.png" width="300" alt="Skill management side panel">
</p>

### System Prompt Presets

- **Custom presets** - Create multiple system prompt presets in the side panel for global roles or behavior instructions.
- **One-click activation** - Only one preset can be active at a time, and the active preset applies automatically.
- **First-message injection** - The active preset is injected before the first message of each new conversation.
- **Works with Skills and memory** - Preset content is layered together with Skill instructions and memory context.

### Automation Tasks

- **Manual or scheduled triggers** - Create tasks from the Automation page in the side panel, run them immediately, or schedule them with cron/RRULE.
- **Dedicated conversation per task** - The first run creates an independent conversation, and later runs reuse it for continuous tracking.
- **Flexible scheduling** - Supports manual runs, cron expressions such as `0 9 * * *`, and RRULE strings such as `FREQ=HOURLY;INTERVAL=1`. The minimum interval is 15 minutes.
- **Pause, edit, and delete** - Task cards support pause/enable, prompt and frequency editing, deletion, and opening the linked conversation.
- **Trackable run status** - Shows next run, previous run, latest status, and error messages.
- **Reuses the enhanced workflow** - Automation triggers the task; the resulting prompt can still use presets, memory, MCP tools, and agentic continuation.

<p align="center">
  <img src="assets/screenshot-sidepanel-automation.svg" width="300" alt="Automation task side panel">
</p>

## 0.6.1 Release Highlights

0.6.1 focuses on automation, Shell MCP, and side-panel organization. It improves scheduled task reliability, local command execution on Windows, and the discoverability of side-panel capabilities.

| Area | Main changes |
|------|--------------|
| Automation tasks | Scheduled tasks now connect to browser background scheduling, making recurring tracking, reminders, and periodic checks more reliable. |
| Shell MCP | Command execution and OfficeCLI / Shell Skill guidance are more consistent on Windows, reducing path and command differences across platforms. |
| Side-panel navigation | Capability-related entries are consolidated into one page, making MCP, tools, Skills, and automation easier to find. |
| Multilingual docs | The README now includes an English entry point for users who prefer English installation and feature guidance. |
| Release safeguards | Chrome, Edge, Firefox, and source packages receive stronger checks to reduce missing-asset or version-mismatch release risk. |

<details>
<summary>Show 0.6.0 release highlights</summary>

### 0.6.0 Release Highlights

0.6.0 focuses on side-panel chat and Skill workflow improvements. DeepSeek++ now moves beyond enhancing the page conversation: it can start tasks directly from the side panel, manage custom Skills, and import Skills from GitHub.

| Area | Main changes |
|------|--------------|
| Side-panel chat | After enabling it in settings, the side panel adds a Chat page where you can send messages, create new conversations, and stream replies. |
| Right-click scenarios | Selected web-page text can be sent to side-panel chat directly or wrapped with custom scenario templates. |
| Skill management | Custom Skills can be edited, enabled, disabled, and deleted for ongoing local Skill maintenance. |
| GitHub import | Skills can be previewed and imported from a GitHub repository, directory, or direct `SKILL.md` link. |
| Web fetch permissions | `web_fetch` supports per-site authorization when needed, and the Tools page can authorize page sources in batches. |
| Tool result display | Fixes tool output being attached to the wrong response node, reducing result misplacement during continuation. |

Thanks to this release's contributors: [@todayzhou](https://github.com/todayzhou) for side-panel chat and right-click scenarios, and [@IjalG](https://github.com/IjalG) for the `web_fetch` authorization experience.

</details>

<details>
<summary>Show 0.5.1 release highlights</summary>

### 0.5.1 Release Highlights

0.5.1 focuses on built-in web tools, letting DeepSeek search and read pages when current information or web-page content is needed, then continue generating.

| Area | Main changes |
|------|--------------|
| Built-in web tools | Adds `web_search` and `web_fetch` for web search and visible page-text retrieval. |
| Agentic continuation | Web tool results return to the same conversation, allowing the model to organize a final answer after search. |
| Tool management | Adds a Tools page in the side panel for toggling web tools, authorizing page sources, and running search diagnostics. |
| Search stability | Empty search results can continue trying available sources instead of treating unparseable pages as success. |
| Prompt consistency | When `web_search` is disabled, conversations no longer behave as if search is available. |
| Output display | Fixes duplicated final content after tool continuation while preserving step records and showing one final answer. |

</details>

<details>
<summary>Show 0.5.0 release highlights</summary>

### 0.5.0 Release Highlights

0.5.0 improves automation and tool-continuation stability, especially for long-running tasks, clean history display, and side-panel loading.

| Area | Main changes |
|------|--------------|
| Automation tasks | Automation runs now save more reliable conversation links, parent messages, and history snapshots for future runs. |
| Tool continuation | Automation tasks and manual agentic continuation now use a consistent tool execution and result-return cadence. |
| History display | Conversation history and local cache consistently hide internal prompts and raw tool-call markers while retaining restorable execution records. |
| Response feedback | Output speed display is consistent across streaming responses and compatible request paths, reducing stale speed state. |
| Side-panel performance | Memory, Skill, preset, automation, MCP, and settings pages load on demand, making the side panel lighter on first open. |
| Release safeguards | Adds release checks to keep tool behavior, continuation flow, and user-visible responses consistent before shipping. |

</details>

<details>
<summary>Show 0.4.4 release highlights</summary>

### 0.4.4 Release Highlights

0.4.4 fixes the Shell MCP store-install experience so users who install from browser stores can also follow side-panel guidance to configure the local Shell Host.

| Area | Main changes |
|------|--------------|
| Shell MCP installation | Adds the `deepseek-pp-shell-host` npm installer so users can install the Shell Native Host with `npx deepseek-pp-shell-host install ...`. |
| Store-user path | The Shell Host installs into the user profile directory instead of relying on the extension source directory. Chrome, Edge, Chromium, and Firefox all have matching installation commands. |
| Side-panel guidance | The MCP page automatically fills in the current extension ID and gives clear guidance when the Native Host is installed but the extension ID is not authorized. |
| Docs and release | README, Chrome Web Store copy, and MCP instructions are aligned to the user install path, while the source install command remains available for developers. |

</details>

<details>
<summary>Show 0.4.3 release highlights</summary>

### 0.4.3 Release Highlights

0.4.3 improves long-task stability and interaction feedback, especially DeepSeek validation compatibility, agentic continuation pacing, and floating pet state feedback.

| Area | Main changes |
|------|--------------|
| DeepSeek validation compatibility | Updates local validation behavior to reduce interruptions during long tasks, automation, and tool continuation. |
| Agentic continuation | Multi-step continuation leaves intervals between requests; empty continuation fails explicitly while preserving existing step state. |
| Floating pet | The DeepSeek whale pet gains status speech bubbles for thinking, streaming, tool execution, and idle states. |
| Issue intake | Adds standard issue forms and template checks; issues missing required information are closed automatically with guidance. |
| Release docs | Adds 0.4.3 highlights to README and keeps 0.4.2 / 0.4.1 / 0.4.0 / 0.3.0 / 0.2.0 as collapsed history. |

</details>

<details>
<summary>Show 0.4.2 release highlights</summary>

### 0.4.2 Release Highlights

0.4.2 prepares Chrome Web Store submission materials and improves privacy-related display by keeping internal prompts out of page output and history.

| Area | Main changes |
|------|--------------|
| Chrome Web Store | Adds store listing copy, privacy policy, submission workflow, screenshot assets, and Chrome package upload workflow. |
| Privacy display | Page output and history retain user-visible prompts and tool results while avoiding internal prompt and tool-format instruction echoes. |
| Cleaner output | Streaming replies more reliably keep user-visible answer text separate from background status updates. |
| Release docs | Adds 0.4.2 highlights to README and keeps 0.4.1 / 0.4.0 / 0.3.0 / 0.2.0 as collapsed history. |

</details>

<details>
<summary>Show 0.4.1 release highlights</summary>

### 0.4.1 Release Highlights

0.4.1 builds on 0.4.0 with experience improvements, especially the DeepSeek page floating pet and a collapsible README version history.

| Area | Main changes |
|------|--------------|
| Floating pet | Adds the DeepSeek whale pet on DeepSeek pages, with different feedback for thinking, streaming, tool execution, success, and failure. |
| Personalization | Adds pet on/off, lower-left/lower-right placement, draggable custom position, size, opacity, and floating animation controls. |
| State persistence | Pet on/off state, position, and appearance are stored locally and survive page refreshes. |
| Release docs | Adds floating pet documentation and 0.4.1 highlights while keeping 0.4.0 / 0.3.0 / 0.2.0 as collapsed history. |

</details>

<details>
<summary>Show 0.4.0 release highlights</summary>

### 0.4.0 Release Highlights

0.4.0 extends the 0.3.0 multi-browser baseline with local Shell / Office document tools, agentic continuation, automation triggers, speed display, and stability fixes.

| Area | Main changes |
|------|--------------|
| OfficeCLI document tools | Adds official OfficeCLI Skills and style libraries, plus a Shell MCP preset and install script so DeepSeek can inspect, read, edit, and validate Office files through command-based OfficeCLI. |
| Agentic continuation | MCP tool results can return to the same conversation, letting DeepSeek keep deciding next steps like Claude Code or Codex. Continuous execution is shown by step and supports stopping and refresh recovery. |
| Output speed display | Shows live `tok/s` while responses are generated, making output state easier to read. |
| Automation tasks | Supports manual or scheduled task triggers with independent conversations, immediate run, cron/RRULE scheduling, pause/edit/delete, and reuse of the continuation workflow. |
| Stability fixes | Reduces repeated execution, stale progress, and lost tool records in long tasks. |
| Validation scripts | Adds Shell MCP smoke check, MCP mock verification, and tool-continuation contract checks before compile, build, package, and local tool-chain release validation. |

</details>

<details>
<summary>Show 0.3.0 release highlights</summary>

### 0.3.0 Release Highlights

0.3.0 moves the extension from a Chrome-only release target to Chrome / Edge / Firefox delivery, while improving theme consistency, version display, and release assets.

| Area | Main changes |
|------|--------------|
| Cross-browser support | Adds Chrome, Edge, and Firefox MV3 build and packaging scripts with browser-specific output. |
| Release flow | Release workflow uploads Chrome, Edge, Firefox, and source zips in one pass; install docs and MCP instructions use browser-neutral wording. |
| Side-panel experience | Side-panel top navigation becomes a stable tab component with icons, current-page semantics, and compact layout for more browser side-panel widths. |
| Light/dark consistency | DeepSeek page theme is mirrored into the side panel. Memory, MCP, settings, Skill popup, tool execution cards, and custom background overlay support both themes. |
| Version consistency | The side panel, settings page, and MCP client info show the same extension version. |
| Documentation archive | Moves MCP rollout docs into the archive directory and adds Edge/Firefox support archive notes with validation records and manual test leads. |

</details>

<details>
<summary>Show 0.2.0 release highlights</summary>

### 0.2.0 Release Highlights

0.2.0 collects the major additions since 0.1.0 and upgrades DeepSeek++ from "memory + Skills" into a browser-side tool platform.

| Area | Main changes |
|------|--------------|
| MCP tool system | Adds MCP service configuration, tool discovery, health checks, call history, result size limits, and timeout controls. Manual chat and automation tasks can both run MCP tools and return results to the same conversation. |
| Tool experience | Expands from memory-only actions to a broader tool experience that supports built-in tools and MCP tools in both manual chat and automation. |
| Automation tasks | Adds side-panel automation, task editor, immediate run, cron/RRULE scheduling, pause/resume, independent DeepSeek conversations, run history, and failure-state display. |
| Memory system | Adds memory update/delete tools and improves related-memory selection, thinking mode, automatic cleanup, and collapsible tool execution display. Recently executed tool state can be restored after refresh. |
| Skill and presets | Adds `/skill` autocomplete, built-in and custom Skill management, system prompt presets, preset import, and DeepSeek Expert mode switching. |
| Sync and personalization | Adds WebDAV sync for memory, Skills, and presets; adds custom DeepSeek page background, dynamic transparency, and blur controls. |
| Docs and release | Adds side-panel screenshots, MCP instructions, mock validation scripts, TypeScript fixes, release workflow, and build/package flow. |

<p align="center">
  <img src="assets/screenshot-sidepanel-mcp.svg" width="300" alt="MCP management side panel">
  <img src="assets/screenshot-sidepanel-automation.svg" width="300" alt="Automation task side panel">
</p>

</details>

## Installation

### Build from Source

```bash
git clone https://github.com/zhu1090093659/deepseek-pp.git
cd deepseek-pp
npm install
npm run build
```

By default, `npm run build` creates the Chrome MV3 build. Cross-browser builds:

```bash
npm run build:chrome
npm run build:edge
npm run build:firefox
npm run build:all
```

Shell MCP host smoke check:

```bash
npm run smoke:shell
```

| Browser | Load entry | Build directory |
|---------|------------|-----------------|
| Chrome | `chrome://extensions/` -> Load unpacked | `dist/chrome-mv3/` |
| Edge | `edge://extensions/` -> Load unpacked | `dist/edge-mv3/` |
| Firefox | `about:debugging#/runtime/this-firefox` -> Load Temporary Add-on | `dist/firefox-mv3/manifest.json` |

## Friendly Links

- [OfficeCLI](https://github.com/iOfficeAI/OfficeCLI) - AI-friendly CLI for Office document processing
- [Spec Driven Develop](https://github.com/zhu1090093659/spec_driven_develop) - A spec-driven development method for AI coding agents
- [Awesome-Prompts Role Playing](https://github.com/dongshuyan/Awesome-Prompts/tree/master/%E8%A7%92%E8%89%B2%E6%89%AE%E6%BC%94) - Curated role-playing prompt collection
- [LINUX DO](https://linux.do) - A next-generation open-source technology community

## License

MIT
