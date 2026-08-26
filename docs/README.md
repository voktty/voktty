# Voktty contributor documentation

This directory holds long-form contributor and maintainer guides. `VOKTTY.md` at the repo root is the living architecture doc and the source of truth; these guides elaborate on specific areas without duplicating it.

If a guide conflicts with `VOKTTY.md`, `VOKTTY.md` wins.

## Official screenshots

- [Screenshot gallery](screenshots.md) - current product captures grouped by feature.
- [Screenshot assets](images/README.md) - purpose, storage rules, and Markdown paths for `docs/images`.

## Getting started

- [VOKTTY.md](https://github.com/voktty/voktty/blob/main/VOKTTY.md) - the architecture source of truth; read this first
- [CONTRIBUTING.md](https://github.com/voktty/voktty/blob/main/CONTRIBUTING.md) - how to contribute, quality bar, project layout

## Architecture guides

- [Remote PTY multiplexing](architecture/adr-001-remote-pty-multiplexing.md) - session ownership, remote transport and multiplexing decisions.
- [Workspace replace transactions](architecture/adr-002-workspace-replace-transactions.md) - preview-first, conflict-aware multi-file replacement.
- [Two-process model and IPC command reference](architecture/two-process-model.md) - Rust owns all OS access; the webview talks through `invoke()`. Command catalog and how to add a new command.
- [PTY shell integration](architecture/pty-shell-integration.md) - PTY sessions, shell init scripts, OSC 7 / 133, ConPTY, SPAWN_LOCK, Job Object, WSL.
- [Path portability](architecture/path-portability.md) - local, WSL, UNC, Windows-drive and POSIX path contracts.
- [Security model](architecture/security-model.md) - deny-list, SSRF guard, workspace authorization, AI tool approval, IPC allowlist, OSC trust, keychain handling.
- [AI subsystem](architecture/ai-subsystem.md) - providers, agent, sub-agents, sessions, composer, tools, edit diffs, live context bridge. Includes a walkthrough for adding a new provider.
- [Agent avatar](architecture/agent-avatar.md) - local SVG profiles, chat and CLI presence states, accessibility, semantic sounds and performance evidence.
- [Terminal renderer pool](architecture/terminal-renderer-pool.md) - slot pooling, the DormantRing, and the never-serialize-mid-command invariant.
- [CLI control plane](architecture/cli-control.md) - bundled CLI, authenticated local protocol, caller targeting, packaging, and current platform limits.
- [Internal terminal aliases](architecture/internal-aliases.md) - versioned structured commands, safe argument forwarding, `ipme` and remote limits.
- [Terminal collaboration](architecture/terminal-collaboration.md) - completed terminal-sharing MVP with host authority, temporary tunnels, roles and read-only remote citations.
- [Editor IDE workbench](architecture/editor-ide-workbench.md) - CodeMirror-based IDE architecture, model roles, performance boundaries and agentic edit safety.
- [Git change review](architecture/git-change-review.md) - safe discard, semantic staging and workspace-authorized Git mutations.
- [Development-server capture](architecture/dev-server-capture.md) - command-scoped loopback detection and native preview linking.
- [Cortex portability baseline](architecture/cortex-portability-baseline.md) - Task 1 provenance, SQLite/FTS5 measurements, supply-chain evidence and exact reuse boundaries before the agent core is introduced.
- [MCP client architecture](architecture/mcp-client.md) - transports, capability policy, threat model, adversarial coverage and measured performance baseline.
- [ADR-003: LSP diagnostics ownership](architecture/adr-003-lsp-diagnostics-ownership.md) - why detailed Problems state belongs to language-server sessions instead of mounted editor views.
- [ADR-004: LSP workspace edit transactions](architecture/adr-004-lsp-workspace-edit-transactions.md) - why symbol rename uses structural UTF-16 edits with preview, conflict detection and rollback.
- [ADR-005: bounded LSP semantic presentation](architecture/adr-005-lsp-semantic-presentation.md) - capability-gated semantic tokens, viewport-scoped inlay hints and stale-response protection.
- [ADR-006: multiprovider AI completion adapters](architecture/adr-006-multiprovider-ai-completion.md) - protocol profiles, bounded recovery, local capability discovery and visible health checks.
- [ADR-007: composite spaces, stable tab identity and session ownership](architecture/adr-007-composite-spaces-and-session-ownership.md) - persistent resource identity, visual membership, stable slots and single session authority.
- [ADR-008: MCP capability boundary](architecture/adr-008-mcp-capability-boundary.md) - immutable tool snapshots, exact read trust and native one-use mutation grants.
- [Workspace search and replace](guides/workspace-search-replace.md) - Preview-first project search and transactional replacement for local, WSL and SSH workspaces.
- [Connect MCP servers](guides/mcp-servers.md) - configure local or remote servers, understand permissions and recover from connection errors.
- [Filesystem and connection stability](guides/filesystem-connections-stability.md) - document identity, explorer ownership, safe terminal cwd, connection lifecycle, long-chat rendering and release smokes.

These guides describe shipped behavior and its boundaries. In particular, MCP is a client-only integration today, terminal collaboration uses an experimental external Quick Tunnel, and editor collaboration is not part of the current contract.

## Contributing guides

- [Testing](contributing/testing.md) - the testing contract, how to run checks, and what makes a good core-subsystem test.

## Project origin

Voktty is an independent hard fork and derivative work based on Terax,
originally developed by Crynta. It is maintained independently by
sergewinters and is not affiliated with or endorsed by Crynta.

- [Attribution and origin](https://github.com/voktty/voktty/blob/main/NOTICE)
- [Apache-2.0 license](https://github.com/voktty/voktty/blob/main/LICENSE)
