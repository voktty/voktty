# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Handoff: switching providers mid-session continues the chat on the next send. The new message goes to the incoming provider with a short recap of what happened and any files this chat edited. The divider shows a spinner and “Preparing a handoff” until that provider starts, then its logo and name.

### Fixed

- Read and Find rows show the file or search query next to the verb, instead of a bare Read/Find. Every provider uses the same nested-arg extraction; Cursor also recovers Glob/Grep from its session store when ACP sends empty input.

## [0.1.5] - 2026-08-23

### Fixed

- Updater archives now use immutable, versioned URLs so Cloudflare cannot pair a cached previous release with the latest signature.

## [0.1.4] - 2026-08-23

### Added

- Project files now show their Git status with color in the file tree.

### Fixed

- fx sessions no longer stall after the first turn or when starting another session; fast ACP responses are registered before they can be delivered, and failed transports are recycled cleanly.
- fx now exposes the model selected by its TUI even when `fx models --json` omits it, including GLM 5.2.
- fx tool activity shows useful file, search, command, output, and failure details instead of empty or misleading rows.
- Finder-launched builds pass the user environment and available Gateway credentials to fx instead of hanging on an invisible Keychain prompt.
- The access-mode control is hidden for fx because fx always runs in its automatic mode.

## [0.1.3] - 2026-08-23

### Added

- fx as a harness: if `fx` is installed and logged in, it shows up next to Claude Code, Codex, Cursor, OpenCode, and Pi. Live sessions spawn `fx acp` and talk Agent Client Protocol. fx does not accept image or audio attachments, so the attach button is disabled with a tooltip. Follow-up messages while a turn is running are not steered - wait for the turn to finish.
- Model picker shortcuts: `⌘.` (`Ctrl+.`) opens or closes it, and left/right arrows move between provider tabs.

### Fixed

- Closing a title-bar tab no longer flashes the sidebar session list. The cards stay on screen while history refreshes instead of disappearing and popping back.
- Git diff gutter and the Changes sidebar update live when files are modified externally, including after discarding a change, without closing and reopening the tab.
- The title-bar `+n -n` badge clears when the Changes sidebar shows no uncommitted files, instead of keeping stale addition/deletion counts.
- Launch no longer flashes a fully clear window: the boot splash uses the same `background-base` / glass tint as the loaded app.

## [0.1.2] - 2026-08-22

### Added

- Editor diff hunks show a centered gutter pill with revert and stage. Plus stages that hunk (or the selected lines) so you can commit some changes and leave the rest unstaged.
- Pi Coding Agent as a harness: if `pi` is installed, it shows up next to Claude Code, Codex, Cursor, and OpenCode. Live sessions spawn `pi --mode rpc` with the user's existing config and extensions loaded, so globally installed Pi packages (todos, subagents, custom tools) still run. Project-local `.pi` resources follow Pi's saved trust file. TUI-only widgets do not appear in MonoCode; extension confirm/select dialogs use the existing approval UI. MonoCode's runtime-mode control does not gate Pi tools - Pi has no native permission prompts.
- Closing the window no longer kills a running chat: MonoCode hides instead, and reopening the app brings the same window back mid-turn.
- Quit (⌘Q) asks first if chats are still running, then restores those sessions the next time you open the app and continues the turn.
- Reopening the app restores the last window: tabs, splits, and open file or terminal panes, instead of always starting on a blank homepage.

### Fixed

- Quitting during a later turn still resumes: a previous interrupt note no longer blocks Continue on the next quit.
- Opening a file scrolls its tab into view when the pane's tab strip overflows.
- Editor syntax lint no longer underlines valid TypeScript (arrow type predicates, typed `catch`, JSX comments, `typeof import()`) or Tailwind `@source` rules. Rust files are still highlighted but are not linted - the highlighter grammar was marking real code as errors.

## [0.1.1] - 2026-08-21

### Added

- Light mode: toggle Dark/Light in the appearance panel. Terminal, editor, markdown (including Mermaid), and sidebar all follow the scheme; preference persists across restarts.
- Editor syntax linting for supported source files (JavaScript, TypeScript, JSON, CSS, HTML, Rust, and Python): lightweight diagnostics straight from the Lezer parse tree, with wavy red underlines and hover tooltips. Catches unclosed brackets, stray quotes, and other typo-class mistakes - not a type checker or language server.
- File tabs show syntax problems: the label turns red and the tooltip appends a problem count, similar to VS Code.
- Context meter in the composer: a ring showing how much of the model context window the session is using, with exact token counts on hover. It turns amber at 75% and red at 90%.
- Context usage is read from each CLI rather than estimated, so the window matches whatever model the session actually runs. Claude Code, Codex, and OpenCode report it; Cursor does not expose token usage over ACP, so no meter is shown for Cursor sessions.
- The last context reading is stored with the session, so reopening a closed session shows its meter right away instead of waiting for the next turn.
- Tab back/forward, like a browser: ⌘[ and ⌘] walk the tabs you actually visited, not the order they sit in the strip. Buttons live in the sidebar header, or in the title bar when the sidebar is closed. View menu: Go Back / Go Forward. Closed tabs drop out of the stack; visiting a different tab after going back clears forward.
- Empty terminal panes grow a tiny snake on the grid. It hunts provider logos and pops a pixel speech bubble when it catches one.

### Fixed

- A tab is removed from its group when its session's project no longer matches the other tabs in that group.

## [0.1.0] - 2026-08-20

First public release. macOS (Apple Silicon) only.

### Added

- Desktop UI for the coding agent CLIs already installed on your machine: Claude Code, Codex, Cursor, and OpenCode. Tabs are sessions, the composer is the input.
- Project file tree, editor with diff view, and full-text search.
- Git surface: staged and unstaged diffs, commit, push, pull, branch switching, and pull request creation.
- Session checkpoints with undo.
- Embedded terminal panes.
- In-app updater.

### Security

- `harness_exec` only runs resolver-produced harness CLIs with a fixed argument allowlist.
- Content Security Policy enabled on the webview. Production CSP excludes the Vite dev server; `devCsp` covers `tauri dev`.
- Agent markdown does not load remote images (`data:` images still work).
- Updater endpoint and minisign public key are injected at release time rather than committed, so forks do not inherit the maintainer's update channel.
- macOS release builds sign with `APPLE_SIGNING_IDENTITY` via a config overlay; the committed default remains ad-hoc `-` for community builds.

[Unreleased]: https://github.com/hardbeat920/monocode/compare/v0.1.5...HEAD
[0.1.5]: https://github.com/hardbeat920/monocode/compare/v0.1.4...v0.1.5
[0.1.4]: https://github.com/hardbeat920/monocode/compare/v0.1.3...v0.1.4
[0.1.3]: https://github.com/hardbeat920/monocode/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/hardbeat920/monocode/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/hardbeat920/monocode/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/hardbeat920/monocode/releases/tag/v0.1.0
