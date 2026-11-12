# Voktty features

The complete feature list. The [README](../README.md) has the short version and the [roadmap](../ROADMAP.md) lists what is coming next.

## Agent Harness

The Harness is where coding agents run. Each session is a conversation with one agent, in one project, with its own model, access mode and history.

- **Many agents, one place:** Run Claude Code, Codex, Antigravity (Gemini), Cursor, Grok, OpenCode and Pi sessions side by side. Voktty drives each tool's own CLI and its existing login, so your subscriptions and accounts keep working and no API key is copied into Voktty.
- **API models as agents:** Models from the providers you configure appear in the model picker under **API**: OpenAI, Anthropic, Google, xAI, Cerebras, Groq, DeepSeek, Mistral, OpenRouter, custom and third-party endpoints, and local Ollama, LM Studio or MLX models. In a local project they can read, search, edit and run commands under the same workspace authorization and secret-path checks as the AI chat. The agent loop and your key stay on your computer.
- **Access modes:** Supervised sessions ask before every write or command and full-access sessions do not. Cancelling a turn resolves pending approvals without running anything.
- **Review and undo:** Session changes open as per-file diffs, with keep and undo for agent edits on local projects, and Git source control in a shared panel.
- **Project terminals:** Dock terminals to the project, or drag an existing terminal tab onto the Harness to adopt it without losing its process or its window tab.
- **Model picker:** Models from every configured provider and agent, with reasoning controls, favorites, recents and a search box.
- **Agents on SSH hosts:** For SSH projects, Claude Code, Codex and OpenCode run on the host through Voktty's remote helper. A detached supervisor keeps the agent alive and logs its output, so a dropped connection neither stops it nor loses output. Connecting to a host can reuse or create a tmux session. API models read, search and edit remote files and run bounded commands when the remote helper is current; the loop and the key stay local.
- **Agent teams:** Declare a roster with roles and rules, follow a board of who is working or waiting, let an orchestrator agent start and message the others through the bundled CLI, use Git worktrees, and run agents on local or SSH hosts. See the [agent teams guide](guides/agent-teams.md).
- **Team communications:** A live log of what agents tell each other and you, with filters by agent, kind and time range, a switch to hide closed agents, and a floating window you can drag.
- **Attention:** An agent that waits for you on any open host raises an in-app notification, and the Notch (alpha, opt-in) shows running agents in an always-on-top window.
- **Project memory:** Inspect, preserve and restore what agents remember about a project, locally and over SSH.
- **Phone companion (preview):** An Android app pairs with the desktop by QR code to follow and steer AI sessions over the local network.

## Terminal and workspace

- **Raw and block terminal modes:** Switch a live PTY between a conventional xterm.js surface and command-aware blocks without restarting the shell or losing foreground processes.
- **Native shells and shell integration:** PowerShell 7, Windows PowerShell, Command Prompt, Bash, Zsh, and Fish, with native cwd, prompt-boundary, command, and exit-code tracking through OSC 7 and OSC 133.
- **Fast rendering with bounded resources:** WebGL rendering, searchable scrollback, interactive links, and a renderer pool that keeps active jobs alive while idle hidden panes release expensive rendering resources.
- **Terminal AI:** Generate context-aware commands with the inline Copilot, enter natural-language tasks from the terminal input, preview before execution, and explain or fix failed command blocks.
- **Smart command entry:** History-based ghost suggestions, full or word-by-word acceptance, multiline editor-like input, and a per-tab authorization option for generated commands.
- **Project scripts:** Detect and run scripts from `package.json`, `Cargo.toml`, `Makefile`, Compose files, `pyproject.toml`, and Go projects.
- **Private terminals:** Open a terminal whose buffer and live context are unavailable to Voktty AI tools and agent process tracking.
- **Tabs, panes, and spaces:** Horizontal or vertical tab bars, tab search, locking and colors, up to eight split panes with keyboard navigation and swapping, plus persistent flat visual spaces configurable for 2, 4, 6, or 8 views.
- **Flat composite spaces:** Keep standalone tabs separate from named spaces, reorder members deterministically, dismantle a space without destroying its tabs, and prevent nested spaces or unlimited pane matryoshkas.
- **Desktop drag and drop:** Insert files from the explorer or operating system into a terminal as shell-safe paths.

## Editor and IDE workbench

- **CodeMirror 6 editor:** Lazy language support for TypeScript and JavaScript, Rust, Python, Go, C and C++, Java, PHP, Vue, Svelte, HTML, CSS, JSON, Markdown, shell files, and more.
- **Quick Open (`Ctrl+P` / `Cmd+P`):** Fuzzy file discovery with workspace-scoped recent files across local, WSL, and SSH projects. Files open as preview tabs until pinned.
- **Workspace search and replace (`Ctrl+Shift+F` / `Cmd+Shift+F`):** Persistent search with regex, case, whole-word, include and exclude globs, ignore-file support, exact result navigation, and preview-first transactional replacement across local, WSL, and SSH workspaces.
- **Workbench navigation:** Independent Back and Forward history across files and spaces, go to line, content search, a configurable `F1` command palette, and a separate active-tab launchpad.
- **Outline and symbols:** Document symbols from LSP with a bounded local fallback for common languages, plus workspace symbols when the active language server supports them.
- **Problems panel:** Workspace diagnostics grouped by file, with severity and text filters, exact navigation, bounded storage, and live cleanup when language-server sessions end.
- **Opt-in LSP:** Diagnostics, completion, formatting, code actions, definitions, references, document and workspace symbols, semantic presentation, installation hints, and custom stdio servers. Sessions are scoped to a workspace root, reference-counted, crash-aware, and bounded; no language server starts until enabled.
- **Run and Debug:** Launch local or WSL debug sessions through the Debug Adapter Protocol when a supported adapter is configured, with explicit transport and capability feedback.
- **AI-assisted editing:** Low-latency inline completion with multiline ghosts, local-model support, selection-based Ask and Edit actions, and reversible side-by-side AI diffs with per-hunk acceptance.
- **Explicit model roles:** Choose one configured chat model for reasoning and editing, and a separate autocomplete model for low-latency ghosts. Both roles work with supported cloud providers, OpenAI-compatible endpoints, and local runtimes.
- **Safe file handling:** External-change conflict detection, original line-ending and indentation preservation, configurable format-on-save tools, large-file safeguards, and a live diff gutter.
- **Editing extras:** In-file find and replace with regex, Vim mode, GFM Markdown with task checkboxes and links, rendered Markdown, media and PDF previews, breadcrumbs, and line, column, language, indent, and EOL status.
- **Independent editor themes:** Follow the application theme automatically or choose a dedicated CodeMirror theme such as Kanagawa, Catppuccin, Rosé Pine, Everforest, Dracula, Solarized, Nord, Tokyo Night, GitHub, or Xcode.

## Files, Git, and previews

- **File explorer:** Material and Catppuccin icons, fuzzy filtering, keyboard navigation, hidden-file control, create, rename, copy, delete, context actions, and live filesystem updates.
- **Source control:** Repository discovery and initialization, flat or tree views, stage or unstage files and all changes, reviewed discard actions, commit, fetch, fast-forward pull, and upstream-aware push.
- **AI semantic staging:** Group changed files into logical Conventional Commits and generate concise commit subjects in the configured language.
- **Branches and worktrees:** Current branch and detached HEAD status, branch checkout, ahead and behind state, divergence handling, and linked worktree navigation.
- **Git history:** Searchable commit history with merge and branch lanes, refs, changed-file lists, per-commit diffs, and remote commit links.
- **Web preview:** Detect local development servers, manage background preview servers, and open local or external URLs in native child webviews.
- **Media tabs:** View images, video, audio, PDFs, and Markdown without leaving the workspace.

## Remote systems and infrastructure

- **First-class environments:** Local shells, installed WSL distributions, SSH hosts, and Docker containers can own terminals and workspace context.
- **SSH workspaces:** Saved connections, OpenSSH config import, identity-file or encrypted-vault keys, initial remote directories, remote file browsing and editing, uploads and downloads, latency checks, and CPU, memory, disk, network, load, and session metrics.
- **SSH tunnels:** Visual local (`-L`), remote (`-R`), and dynamic SOCKS5 (`-D`) forwarding with saved profiles and live start, stop, and status controls.
- **Docker dashboard:** Daemon status, searchable container inventory, CPU and memory statistics, port and Compose metadata, logs, start, stop, restart, and terminal access inside running containers.
- **Serial terminal:** COM and TTY connections with baud rate, data bits, parity, stop bits, flow control, DTR and RTS signals, and reset pulse support.
- **Remote desktop:** Saved RDP profiles, host probing, embedded sessions where supported, and native-client launch support.
- **Consistent connection lifecycle:** Local, WSL, SSH, Docker, and serial environments expose resolving, connecting, ready, reconnecting, failed, and disconnected states without allowing stale attempts to replace a newer connection.

## AI chat and tools

- **Bring your own model:** OpenAI, Anthropic, Google Gemini, xAI, Cerebras, Groq, DeepSeek, Mistral, OpenRouter, and arbitrary OpenAI-compatible endpoints.
- **Local inference:** LM Studio, MLX, and Ollama can power chat, agent work, or editor autocomplete without a cloud model.
- **Persistent conversations:** Named sessions in the docked panel or mini window, model selection, reasoning controls, reusable `#handle` prompt snippets, text, image and selection attachments, and voice input.
- **Approval-gated tools:** Read and search project files, propose writes, create or rename files, run foreground or background commands, maintain task lists, and delegate bounded work to custom sub-agents.
- **Reviewable edits:** Proposed file mutations open as diffs and require explicit acceptance before writing.
- **Plan mode and custom agents:** Confirm multi-step execution plans and define agents with their own instructions and tool subsets.
- **MCP client:** Connect optional local stdio or remote Streamable HTTP servers. Rust owns transport, OAuth, schemas, validation, cancellation, audit, and one-use approval grants; each AI run receives an immutable tool snapshot and remote descriptions/results stay marked as untrusted data.
- **Terminal coding-agent launcher:** Start one to four balanced panes for Claude Code, Codex, Gemini CLI, Pi, OpenCode, or Grok with customizable launch commands.
- **Agent supervision:** Track working, waiting, finished, and failed states; receive in-app or operating-system notifications; review changed-file summaries; and jump directly to the agent that needs attention.

## Encrypted terminal collaboration

- **Temporary sharing without a Voktty account:** Publish a host-owned terminal through an external Cloudflare Quick Tunnel and invite up to seven guests with a separate URL and short-lived code.
- **End-to-end protected sessions:** HMAC-authenticated joins and directional AES-256-GCM encryption for terminal and control payloads, in addition to the tunnel's TLS transport.
- **Host-controlled roles:** Every guest starts as an observer. The host can grant or revoke the single controller role, remove participants, or stop the session immediately.
- **Resilient terminal state:** Bounded snapshots and sequenced replay keep the shared terminal consistent across joins and transient reconnects without silently dropping output.
- **Optional remote citations:** The host can authorize read-only `@` file search and text citations inside one workspace. Writes, secret paths, binary files, and paths outside that root remain blocked.

## Customization, extensions, and desktop integration

- **Application themes:** Bundled light and dark themes, validated custom theme files, live theme editing, import and sharing, plus per-theme terminal palettes and typography.
- **Background and window effects:** Background images with opacity and blur controls, plus native transparent Mica or vibrancy chrome where the operating system supports it.
- **Personalized UI:** Terminal font family, weight and size, editor font size, cursor and scrollback settings, horizontal or vertical tabs, zoom, Zen mode, searchable settings, and fully editable keyboard shortcuts.
- **Multilingual interface:** English, Spanish, Portuguese, French, German, Italian, Simplified Chinese, Japanese, Korean, Russian, Arabic and Hindi, with right-to-left layout.
- **Configuration backup:** Export, copy, validate, and import preferences, SSH profiles, and tunnel definitions while excluding passwords, keys, and other sensitive fields.
- **Native extension runtime:** Load JavaScript extensions from `~/.voktty/extensions/`, enable or disable them without restarting, and contribute commands, keybindings, AI tools, notifications, shell execution, and workspace-aware behavior. This is a Voktty API, not VS Code extension compatibility.
- **Agent presence and local feedback:** Optional offline UI sounds cover navigation, saves, Git, Problems, tasks, debugging, and agent responses. Built-in role avatars and animated external-agent tab icons reflect activity while respecting reduced-motion and visibility settings.
- **Desktop lifecycle:** Automatic updates, optional launch at login, system tray controls, restored window state, and native notifications.
- **Local `voktty` command:** From a Voktty terminal, open an authorized workspace file at a line and query the running app's identity and capabilities.

## Privacy and security

- **No account and no Voktty telemetry:** Voktty runs no first-party telemetry service. Enabled AI features communicate only with the cloud or local provider you select.
- **Protected credentials:** AI provider keys use the operating-system keychain. On Linux, Voktty uses Secret Service when available and a private mode-0600 file only when the session bus or service is absent. The optional encrypted vault stores SSH keys, passphrases, API keys, tokens, and generic secrets with a master password and automatic locking.
- **Workspace boundaries:** Native filesystem access is authorized per workspace, and local control requests can open only regular files inside an authorized root.
- **Secret and endpoint safeguards:** AI file tools reject sensitive paths, mutating tools require approval, and local or compatible model endpoints are used only after you configure them.
