# Two-process model and IPC command reference

This guide elaborates on `VOKTTY.md`. If anything here conflicts with `VOKTTY.md`, `VOKTTY.md` wins.

## The split

Voktty is two processes: the Rust backend (`src-tauri/`) and the webview frontend (`src/`).

- **Rust owns all OS access**: PTY, file system, git, shell spawn, network, secrets, workspace authorization.
- **The webview never touches the FS, processes, or shells directly**. Every host operation goes through an `invoke()` call to a command registered in `src-tauri/src/lib.rs`.

This boundary is the root of the security model. Untrusted input (terminal escape sequences, file content, AI tool results) is parsed and validated in Rust or in carefully scoped frontend code, never executed by the renderer.

## Adding a new IPC command

1. Write the `#[tauri::command]` async function in the appropriate `src-tauri/src/modules/<area>/` module.
2. Register it in `src-tauri/src/lib.rs` inside the `tauri::generate_handler![...]` block (`src-tauri/src/lib.rs:191`).
3. If the command uses a Tauri plugin API (window, clipboard, dialog, etc.), add the plugin permission to `src-tauri/capabilities/default.json`.
4. Add a typed frontend wrapper in the matching `src/modules/<area>/lib/` directory and call it through Tauri's `invoke()` API.
5. If the command touches the file system, network, or shell, it must go through the existing guards (`security.ts` deny-list, workspace authorization registry, SSRF guard, AI tool approval).

Custom commands do not need to be listed one-by-one in `default.json`; the capability covers the window. Plugin permissions do.

## Command catalog

The commands registered in `src-tauri/src/lib.rs` are grouped below by module. Names are the Rust function names as seen by the frontend.

### PTY (`src-tauri/src/modules/pty/`)

Long-lived interactive terminal sessions.

- `pty_open` - create a new PTY session
- `pty_write` - send input bytes (text or control sequences)
- `pty_resize` - resize the PTY
- `pty_close` / `pty_close_all` - destroy one or all sessions
- `pty_has_foreground_process` / `pty_has_foreground_job` - detect whether a command is running
- `pty_shell_name` / `pty_list_shells` - shell detection and enumeration

Output streams from `pty_open` via a Tauri `Channel<PtyEvent>`.

### File system (`src-tauri/src/modules/fs/`)

#### Tree

- `list_subdirs` - list subdirectories
- `fs_read_dir` - read a directory

Local and WSL workspaces use these native commands with their `WorkspaceEnv`.
On Windows, Rust resolves POSIX WSL paths through the distro bridge before
accessing the filesystem. SSH workspaces use the authenticated remote
filesystem channel instead of sending SSH paths to the local commands.
The explorer keeps a visible navigation route separate from the active
terminal cwd. Its parent action can move through local, WSL and authorized
remote descendants, while refresh returns to the active terminal route. An
SSH session cannot leave the helper's authenticated workspace root.

#### File

- `fs_read_file` - read file contents
- `fs_write_file` - write file contents
- `fs_stat` - file metadata
- `fs_canonicalize` - canonical path

The frontend `ai/lib/native.ts` wrappers `readFile`, `writeFile`, `canonicalize`, `readDir` and `createDir` accept an optional explicit `WorkspaceEnv`. Explicit requests never consult the selected workspace: local and WSL use native commands, SSH retains the supplied authenticated session, and native Windows or UNC paths stay local. Unresolved project namespaces and unsupported Docker or serial filesystem targets reject before IO. Omitting the argument retains the legacy ambient routing. Callers must capture and retain their own environment across asynchronous stages; this optional argument does not itself bind a tool approval, queued plan or later operation to its original source.

The operation inspect, conditional write, file removal and empty-directory removal wrappers accept the same explicit scope. Plan entries retain a detached filesystem when enqueued, using the producer's explicit scope or the current scope for legacy producers. Preflight, apply, partial rollback and undo pass each entry's captured scope through the operation adapter. Transaction inputs are detached before asynchronous work. Duplicate detection includes filesystem identity and folds native Windows path aliases; different filesystems may contain the same path. Existing conditional-content checks and operation size limits remain in force. This binds deferred execution to its queue entry, not to an earlier tool approval or preview read; those producers must still supply their original scope.

The plan store admits one apply or undo at a time and publishes that reservation before observers or IO. Mounted review views share its pending state. Queue rejection controls retain entries already admitted through actual transaction settlement; new entries remain available after an older batch completes. Successful apply consumes only its captured entries and pending command provenance. Undo preserves command metadata added while it waited and updates only its original transaction. Presentation teardown does not cancel admitted native work or release the reservation early.

Successful `fs_write_file`, `fs_replace_apply` and `fs_workspace_edit_apply` writes publish `fs:file-written` with `{path, filesystem, source?}`. The filesystem is a credential-free native request scope: `{kind: "local"}` or `{kind: "wsl", distro}`. Native Windows and UNC paths retain local identity. Event construction bounds paths to 32,768 UTF-8 bytes, distro names to 255 bytes and optional sources to 128 bytes, without control characters. An invalid path or scope suppresses the advisory notification; an invalid source is omitted. The write result and existing filesystem authorization are unchanged. This scope does not establish canonical alias equivalence or grant filesystem authority.

Frontend readers require a validated filesystem identity and ignore unqualified events. Editor delivery matches that identity and the document path, with legacy documents retaining local ownership. Toolkit refresh matches its actual configuration target, including a local global configuration used by a remote project. Theme ingestion reads only qualified local saves through explicit local IO, serializes persistence and retains up to 256 unsettled requests. Automatic preview reloads target only the registered native HTTP server and matching root, with delayed delivery retired after navigation, server replacement or unmount. Remote watch notifications and external browser pages do not trigger native file reloads; the explicit manual preview reload action retains its separate behavior.

#### Mutate

- `fs_create_file` / `fs_create_dir`
- `fs_rename` / `fs_delete` / `fs_copy`

#### Watch

- `fs_watch_add` / `fs_watch_remove` - filesystem change notifications

#### Search

- `fs_search` - fuzzy file finder
- `fs_list_files` - recursive file listing

Explorer filename-search results retain their original root, filesystem,
query, hidden-file setting and mounted search lifetime. Changing that context
withdraws accepted rows immediately and retires their cached menu callbacks,
including after returning to the previous context. Unsettled native reads
remain counted against the shared 16-request budget until settlement.
This presentation guard does not cancel native scans.

SSH filename searches use the authenticated helper's independent
`fs.searchNames` capability. The helper validates a relative search directory
under its canonical workspace root and ranks regular files and directories
with the same path-aware, smart-case matcher as native search. Ignore rules,
hidden-file preferences and heavy-directory pruning apply without following
symlinks. Requests allow a 4096-byte query and at most 1000 results; scans visit
at most 50,000 entries and retain at most 8 MiB of result strings. The shared
independent-search pool holds eight jobs through response-write settlement,
with a 30-second cooperative deadline, 256 KiB request limit and 4 MiB response
budget. Blocking filesystem calls are not forcibly interrupted.

The Explorer captures its original helper session before lazy loading,
validates up to 200 relative results and reconstructs paths under its captured
search root. Missing capabilities and transport failures never fall back to
local IO or cancel interactive content searches. Remote results cannot invoke
the local file manager. Unresolved project namespaces, Docker and serial
filename searches remain unavailable; native Windows and UNC paths retain
their explicit local interpretation.

#### Grep

- `fs_grep` - content search
- `fs_grep_interactive` - interactive content search
- `fs_glob` - glob matching

### Git (`src-tauri/src/modules/git/`)

All git commands are gated through the workspace authorization registry.

- `git_resolve_repo` / `git_panel_snapshot`
- `git_status`
- `git_diff` / `git_diff_content`
- `git_stage` / `git_unstage` / `git_discard`
- `git_commit`
- `git_fetch` / `git_pull_ff_only` / `git_push`
- `git_log` / `git_show_commit` / `git_commit_files` / `git_commit_file_diff`
- `git_remote_url`
- `git_list_branches` / `git_checkout_branch`

### Shell (`src-tauri/src/modules/shell/`)

Three distinct surfaces:

- `shell_run_command` - one-shot subshell exec for AI tools
- `shell_session_open` / `shell_session_run` / `shell_session_close` - persistent agent shell with state across calls
- `shell_bg_spawn` / `shell_bg_logs` / `shell_bg_kill` / `shell_bg_list` - long-running background processes with bounded ring-buffer log capture

### Workspace (`src-tauri/src/modules/workspace.rs`)

- `workspace_authorize` / `workspace_current_dir` - the spawn/git/AI cwd authorization registry
- `wsl_list_distros` / `wsl_default_distro` / `wsl_home` - WSL bridge

### Harness OpenCode transport

OpenCode 1.x uses a Voktty-owned `serve` child. OpenCode 2.x uses the CLI's
shared background service and authenticated `/api` HTTP and SSE routes.
Rust performs every process and network operation; React translates v2
events into the existing harness transcript and correlates completion with
the admitted inbox item. Minimum supported versions are 1.14.19 and 2.0.15;
other major versions are rejected.

`harness_exec` accepts an optional `binaryProvider: "opencode"` for exactly
`service status`, `service start`, and `service get password`. Rust checks the
command against the resolved OpenCode path and requires an existing,
authorized local directory. The service password remains in memory and is
never persisted or logged. HTTP and SSE stay on loopback, reject URL
credentials, and never follow redirects. The shared daemon does not inherit Voktty's
orphan-cleanup ownership marker. Closing a harness session interrupts its
run and closes its event stream, without stopping the shared service;
temporary text-generation sessions are deleted after use.

The v2 shared service cannot enforce Voktty's per-session network allowlist.
Sandboxed v2 turns are rejected before starting or reusing the service.
The v1 owned server retains its network proxy. This desktop transport does
not add or deploy a remote Node host.

### Headless harness process adapter

`child.ts` accepts a `ChildBackend` once, before any bridge listener starts.
The desktop continues to use Tauri. `host/child-backend.ts` provides a Node
adapter for the same provider controllers, outside the webview. It requires
explicit canonical workspace registration before process spawn or service
commands, resolves provider executables without running ambiguous binaries,
and rejects network allowlists it cannot enforce. It does not expose a
remote command endpoint or generic filesystem reads.

Provider processes run behind an ownership pipe guard. Losing the host
terminates the provider tree; a cancelled pending spawn cannot create a
late process. HTTP stays on loopback with bounded responses and no redirects.
SSE replacement suppresses output and completion from the previous stream.
The shared OpenCode service is not owned by this guard.

Run `pnpm check-types:host` and `pnpm test:host` for this adapter. The latter
includes an authenticated OpenCode 2.x fixture using the existing controller
and real local process/HTTP transports. `host/upstream.json` records the
fixed source revision and local adaptations.

`host/store.ts` persists projects, session revisions, command receipts and
hashed device credentials using Node's built-in SQLite. A session snapshot
and its event are committed together; failed transactions invalidate cached
snapshots. Block revision stamps let clients reconstruct a transcript delta,
including removed blocks. `host/sync-transfer.ts` splits large serialized
revisions into bounded chunks without splitting Unicode surrogate pairs.
Transfers expire after two minutes and retain at most eight revisions.
Uploaded attachments use validated IDs, bounded chunks and sequential offsets.
The host rejects symlinked attachment directories and linked files before
reading or writing; image reads are tied to a saved session reference. The
execution engine must read verified attachment bytes through this host module.

These components require Node 22.13 or newer and run outside the webview.
`host/engine.ts` owns command validation, durable receipts, provider runs and
event flushes. A receipt records acceptance before dispatch. On restart, a
running turn becomes interrupted and is never replayed automatically. It
rejects replies for stale runs, stops the old provider before accepting a new
turn, and retains provider identity only for an explicit follow-up. Project
registration calls the configured workspace authorizer on a canonical path.
Git worktree selection accepts registered checkouts of that project.

The authenticated session server, private data-directory permissions and
release packaging remain pending; the desktop does not use this host yet.

### Network (`src-tauri/src/modules/net.rs`)

- `ai_http_request` / `ai_http_stream` - AI HTTP proxy with SSRF guard
- `lm_ping` - local-model ping

### Secrets (`src-tauri/src/modules/secrets.rs`)

- `secrets_get` / `secrets_set` / `secrets_delete` / `secrets_get_all` - OS keychain access, service `voktty-ai`

### Agent hooks (`src-tauri/src/modules/agent.rs`)

- `agent_enable_hooks` / `agent_hooks_status` - install/status terminal coding-agent hooks (Claude Code, Codex, Gemini CLI)

### History (`src-tauri/src/modules/history/`)

- `history_suggest` / `history_commands` / `history_record` / `history_list` - shell history integration

### Desktop launch and settings

- `launch_bootstrap` - returns the primary instance id and queued launch requests
- `launch_frontend_ready` - enables hot request events and redelivers unacknowledged requests
- `launch_acknowledge` - records a request id as applied for the process lifetime
- `app_exit_after_flush` - exits only after the frontend has promoted the clean session
- `open_settings_window` - open the separate settings webview (optional `tab` deep-link)

### CLI control plane

- `control_frontend_ready` - marks the restored main UI ready for routed CLI actions
- `control_respond` - completes a pending UI-bound CLI request

See [CLI control plane](cli-control.md) for the local protocol and packaging model.

## Invariants

- The webview must not spawn processes, read files, or make network calls except through the commands above.
- New commands must be registered in `lib.rs` and guarded at the boundary (workspace auth, deny-list, SSRF, approval flow).
- Plugin permissions must be added to `src-tauri/capabilities/default.json` if the command uses a plugin API.

## See also

- [`VOKTTY.md`](https://github.com/voktty/voktty/blob/main/VOKTTY.md) - the architecture source of truth
- [`docs/README.md`](../README.md) - index of contributor guides
- [PTY shell integration](pty-shell-integration.md) - how sessions and shell integration work
- [Security model](security-model.md) - the boundaries every command must respect
