# Roadmap

Voktty direction, what's shipped, what's coming, and what's deliberately out of scope.

This file is updated as direction evolves. For day-to-day work, see [GitHub Issues](https://github.com/voktty/voktty/issues) and the Projects board.

## What Voktty is

Voktty is an open-source desktop workspace for AI coding agents. Its center is the Agent Harness, which runs Claude Code, Codex, Gemini (through Antigravity), Cursor, Grok, OpenCode, Pi and any model you reach through an API, on local and SSH projects, and keeps their sessions, approvals, change review, memory and teamwork in one place. Around it sit a native PTY terminal, a code editor, source control, previews, and local, WSL, SSH, Docker, serial and remote-desktop environments. No telemetry, no account, keys stored in the OS keychain. Installers are 25 to 36 MB (v1.0.27; the Linux AppImage is about 118 MB).

The product is opinionated: agents are a primitive and not a sidebar, you stay in control of what they may do, the terminal stays correct, and every dependency has to earn its place.

## What Voktty is not

- Not an IDE clone. Voktty selectively integrates high-value editor capabilities such as LSP, AI autocomplete, formatting, source control, and previews without adopting the heavyweight runtime and always-on background services of a traditional IDE.
- Not a browser. Web preview exists for local dev servers and lightweight doc viewing only.
- Not a general workspace. Tools and formats that pull the product away from developing with agents and terminals are out of scope.
- Not a hosted service. Agents run on your machines, with your accounts and your keys.

## Themes

The themes below frame every scope decision.

1. **Agents as a native primitive.** Sessions, approvals, review, memory and teams are first-class, not a panel bolted onto a terminal.
2. **You stay in control.** Every write and command asks first unless you grant full access, and every secret path stays protected.
3. **Terminal fidelity.** xterm.js correctness, PTY fidelity and TUI app compatibility are non-negotiable.
4. **Lean by design.** Every dependency is justified, the startup bundle has an enforced budget, and heavy surfaces load on demand.
5. **Cross-platform parity.** macOS, Linux, Windows and WSL, with no platform-specific exclusives.
6. **Security by default.** Path guards, SSRF protection, OSC trust and IPC sandboxing. Defaults are safe out of the box.

## Shipped

### Agent Harness

- [x] Sessions for Claude Code, Codex, Antigravity (Gemini), Cursor, Grok, OpenCode and Pi, side by side, using each tool's own login
- [x] API models as agents, with file, search and shell tools, per-action approval and the chat's workspace and secret-path checks (local and SSH projects)
- [x] Local Ollama, LM Studio and MLX models as Harness agents once configured
- [x] Supervised and full-access modes, with change review, keep and undo
- [x] Agents on SSH hosts through the remote helper, with reconnection that keeps the agent running
- [x] Choose or reuse a tmux session when connecting over SSH
- [x] Agent teams: roster, roles and rules, board, orchestrator control through the CLI, Git worktrees and SSH hosts
- [x] Team communications log, hide-closed filter and notifications when an agent waits for you
- [x] Project memory inspection and restoration, locally and over SSH
- [x] Model picker across every configured provider, with favorites and recents
- [x] Project terminals docked in the Harness, including adoption of an existing terminal tab
- [x] Dynamic Notch for running agents (alpha, opt-in)
- [x] Android companion app (preview) paired by QR code over the local network

### Terminal

- [x] Multi-tab terminal with WebGL renderer
- [x] Native PTY backend (zsh, bash, pwsh, fish, cmd)
- [x] Split panes
- [x] Shell integration (cwd, prompt markers)
- [x] Inline search, link detection, true-color
- [x] Inline terminal auto-suggestions (history-based suggest with ghost text, search filter, and settings toggle)
- [x] Serial Terminal support (COM / TTY ports with baud rate and parity controls)
- [x] SSH and remote workspace environments
- [x] Drag and drop files into terminal panes as shell-safe quoted paths
- [x] Private terminal tabs with AI-context redaction
- [x] WSL bridge as workspace environment
- [x] Spaces with restored tabs, working directories, and split-pane layouts
- [x] Terminal collaboration with secure quick tunnels and permission roles

### Editor

- [x] Multi-language support (TypeScript / JavaScript, Rust, Python, HTML / CSS, JSON, Markdown, Go, C / C++ / Java / C#, PHP)
- [x] Inline AI autocomplete with automatic and manual triggering, multiline suggestions, and local-model support
- [x] AI edit diffs
- [x] Opt-in LSP support with diagnostics, navigation, completion, formatting, and custom servers
- [x] Opt-in debug sessions through the Debug Adapter Protocol in local and WSL workspaces
- [x] Vim mode

### Themes and Customization

- [x] Fluent Design System with carbon palette and native Mica backdrop support
- [x] Prebuilt and custom app and terminal themes with import and sharing
- [x] Background images with adjustable opacity and blur
- [x] App-theme-aware and independently selectable editor themes
- [x] Mica, Mica Alt and Acrylic window materials driven by a single opacity control
- [x] Interface size scale that leaves editor and terminal text untouched

### File Explorer & Workspaces

- [x] Icon theme with full file-type coverage
- [x] Fuzzy search, keyboard navigation, inline rename, context actions
- [x] Live filesystem updates in the explorer and open editor tabs
- [x] Docker containers explorer and workspace management

### Git / Source Control

- [x] Source control panel (stage, commit, branch)
- [x] Git history with commit graph
- [x] Per-file diffs

### AI & Agentic Tools

- [x] Multiple cloud and local providers (BYOK)
- [x] MCP client for local stdio and remote Streamable HTTP servers, with approval-gated tools
- [x] Multi-agent and sub-agents
- [x] Approval-gated Claude Code orchestration with spawn, output inspection, and follow-up
- [x] Voice input
- [x] Reusable prompt snippets via `#handle`
- [x] Project memory and per-project configuration
- [x] Tools with per-action approval gating (file write / edit, bash, and filesystem mutations)
- [x] Workspace file picker
- [x] Auto-compact for long context

### Tools & Previews

- [x] Integrated API Client with cURL parser and response inspection
- [x] Auto-detected local dev server preview, also over SSH through a tunnel
- [x] Image, video, audio, and PDF viewers
- [x] Rendered Markdown preview with raw and rendered views
- [x] Sandboxed iframe

### Platform Integration & Localization

- [x] macOS, Linux (.deb / .rpm / AppImage), Windows (NSIS), WSL
- [x] Full internationalization in 12 languages (EN, ES, DE, FR, IT, JA, KO, PT, RU, ZH, AR, HI) with RTL/LTR support
- [x] AUR (Arch)
- [x] Windows Explorer context-menu integration
- [x] Auto-updater
- [x] OS keychain for API keys
- [x] No telemetry

### Security

- [x] Hardened AI tool surface (file system, network, IPC)
- [x] SSRF and DNS rebinding defenses on outbound HTTP
- [x] Trust gating in terminal escape-sequence handling
- [x] Sandboxed preview surface

### Engineering

- [x] Regression coverage across critical PTY, security, AI tool, editor, explorer, theme, and native-boundary behavior
- [x] Enforced startup and total client bundle budgets with heavy editor, AI, Markdown, and source-control surfaces loaded on demand

## Planned

### Coming next

- [ ] **Agentic Memory & Durable Runs (`voktty-agent-core`):**
  - 4-tier memory engine (Working, Episodic, Semantic, Procedural) with SQLite + FTS5 (<4 MiB RSS, <1ms search).
  - Scoped persistent identity (global-user, git-root workspace, agent persona).
  - Durable executions with atomic checkpoints and idempotency to scale to **Hermes Agent** autonomous loops.
  - Transparent chat memory badges and portable `.voktty-memory.json` export/import.
- [ ] Unified capability policy and per-tool trust levels across agents and MCP servers.
- [ ] Agents that can use the computer (see and drive other applications), opt-in per session, with a visible indicator, a stop button and an action log.
- [ ] Complete, extensible slash-command and reusable skills system.
- [ ] Project-scoped approval policies and per-tool trust.
- [ ] One search for files, commands and conversations.
- [ ] One project panel that follows the active view.
- [ ] Tools for API-model agents in WSL projects, and conversation memory that survives restarts.
- [ ] Persistent terminal processes across app restarts.

### Longer horizon

- [ ] Selective TS → Rust migration where the profiler shows measurable wins
- [ ] AI tools / skills as installable bundles

## Wanted contributions

Strategic areas where help is welcome. Pick something and propose an approach in Discord or via an issue first.

- **Regression tests.** Add focused coverage for bug fixes and critical PTY, security, AI tool, and native-boundary invariants.
- **Measured performance work.** Profile first and propose focused changes that preserve startup time, bundle size, memory use, and hot-path latency.
- **Platform-specific bugs.** Rendering issues on niche distros, shell quirks, WSL edge cases.
- **Documentation and translations.** Improvements, screenshots, examples, non-English README sections.
- **Themes.** Terminal and editor themes, UI accent palettes that fit the lightweight aesthetic.
- **Provider integrations.** Only providers that add unique value beyond existing coverage. Justify the case before implementing.

See `good-first-issue` and `help-wanted` labels on GitHub Issues for concrete tasks.

## Out of scope

Categories that will not be built into Voktty. Individual feature requests in these categories will be closed.

- **Heavyweight IDE infrastructure.** Profiler suites, unbounded background indexing, and always-resident extension hosts are out of scope. Debugging stays limited to opt-in Debug Adapter Protocol sessions. Focused LSP, autocomplete, formatting, and editor workflows remain in scope when they are opt-in, lazy, and resource-bounded.
- **Notebook and document workspaces.** Anything that turns Voktty into a document host rather than a terminal.
- **Package manager and toolchain UIs.** Use `npm`, `pip`, `cargo` and friends in the terminal directly.
- **Full web browser features.** Preview pane stays scoped to local dev servers and lightweight doc viewing. No navigation history, no bookmarks, no dev tools.
- **Telemetry, analytics, accounts.** Voktty stays BYOK and offline-respectful.
- **Extension marketplaces at IDE scale.** Narrowly-scoped AI tool / skill bundles may happen eventually. Arbitrary UI or behavior extensions will not.
- **Third-party subscription session bridges.** Forwarding cloud subscription auth (provider-managed login sessions) through Voktty is not technically feasible for third-party clients.

## Decision authority

Direction and scope decisions are made by [@sergewinters](https://github.com/sergewinters). Trusted reviewers (informal, no fixed roles yet) provide input on security, performance, and platform-specific areas.

If a PR is closed and you disagree, raise it in Discord. Happy to discuss, not happy to be ambushed in a PR comment thread.

This will likely formalize over time as the project grows.
