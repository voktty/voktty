# CLI control plane

This guide elaborates on `VOKTTY.md`. If anything here conflicts with `VOKTTY.md`, `VOKTTY.md` wins.

## Current surface

Voktty bundles a small Rust client internally named `voktty-cli`. Native terminal panes expose it as the public `voktty` command:

```text
voktty <file> [--line <n>] [--no-focus] [--json]
voktty open <file> [--line <n>] [--no-focus] [--json]
voktty ping [--json]
voktty capabilities [--json]
voktty identify [--json]
voktty alias list|path|edit [--json]
voktty alias run|test <name> [--] [args...] [--json]
voktty alias import <file> [--json]
voktty alias export <file> [--force] [--json]
voktty ipme [--public] [--json]
```

The app must already be running. A command launched inside a Voktty pane targets that pane's space, even if another space or tab has UI focus. An external client without pane context falls back to the active UI context.

## Components

- `src-tauri/crates/voktty-control-protocol` contains dependency-light request, response, error, descriptor, and method types shared by the app and CLI.
- `src-tauri/crates/voktty-cli` contains the standalone console client. It intentionally avoids Clap, Tokio and Tauri. Its blocking `reqwest` client is used only by the explicit `ipme --public` action.
- `src-tauri/crates/voktty-aliases` contains the dependency-light schema, validation, merge, context and atomic configuration core shared by the app and CLI.
- `src-tauri/src/modules/control.rs` owns endpoint discovery, authentication, message limits, concurrency limits, timeouts, path canonicalization, and request routing.
- `src/modules/control/` maps a caller pane to its tab and space, then performs the small set of UI-only actions.
- `scripts/build-cli.mjs` builds the target-specific helper expected by Tauri's `externalBin` bundler.

Rust handles `ping`, `capabilities`, authentication, and file validation directly. Actions that must mutate React state are emitted to the main webview and completed through `control_respond`. This keeps OS validation in Rust without duplicating the tab model outside React.

## Transport and authentication

The app binds an ephemeral loopback TCP port and writes a discovery descriptor to the user cache directory under `voktty/control.json`. The descriptor contains the protocol version, address, process id, app version, and a random 256-bit token.

Security properties:

- The listener binds only to `127.0.0.1`.
- The Unix control directory is mode `0700`; the descriptor is atomically replaced with mode `0600`. Windows uses the current user's inherited profile ACL.
- Every request carries the token and is rejected using a constant-time comparison when it does not match.
- Messages are newline-delimited JSON and capped at 64 KiB.
- Request ids are bounded and restricted to log-safe ASCII.
- Connections and pending UI requests are capped at 32, with bounded read, write, and UI response timeouts.
- The CLI verifies that a cache descriptor still names a live Voktty process before sending its token.
- File paths are canonicalized and required to reference a regular file inside an authorized workspace before the editor is opened.
- Accepted `open` calls are converted to `LaunchRequest` with source `controlCli` and use the same frontend dispatcher as file associations and second-instance delivery. The authenticated control response channel remains responsible for returning line, tab and focus results.
- The descriptor is removed only when it still belongs to the exiting process, so an older instance cannot delete a newer instance's endpoint.

The token is injected into Voktty-spawned native shells together with `VOKTTY_PANE_ID`. Child coding agents inherit the caller context intentionally, which gives them the same local UI-control capability as the terminal that launched them. Tokens must never be logged or added to command output.

## Command discovery inside a PTY

The packaged helper is named `voktty-cli` because a macOS app bundle places sidecars beside the GUI executable, which is already named `voktty`. At app startup Voktty creates a user-private, per-process `bin/voktty` hard link to the packaged helper, falling back to a symlink on Unix or a copy on Windows. That directory is prepended to the PTY `PATH`.

The same directory contains generated launchers for enabled terminal aliases whose names do not already resolve on the host `PATH`. Launchers contain only validated alias identifiers and delegate to `voktty alias run`; executable paths and arguments remain structured data resolved by the CLI. Configuration changes affect explicit CLI execution immediately and direct launchers after an application restart.

Existing Bash, Zsh, Fish, and PowerShell integration also defines an interactive `voktty` function that executes `$VOKTTY_CLI`. The real PATH entry is still required because non-interactive child shells do not reliably inherit shell functions.

Launcher directories for exited processes are removed at the next control-server startup. Live process ids are preserved regardless of directory age.

## Packaging and size

`tauri.conf.json` declares `binaries/voktty-cli` as an external binary. Tauri selects the file with the current target-triple suffix and signs or packages it with the app. The release workflow passes its explicit Rust target to `scripts/build-cli.mjs`, which prevents an x86_64 macOS release from accidentally bundling an arm64 helper from the host.

The release profile uses one codegen unit, fat LTO, size optimization, abort-on-panic, and stripping. Always measure the actual target artifacts after changing dependencies.

## Current limits

- WSL panes do not receive the control credentials or CLI launcher yet. Windows path translation and WSL networking must be implemented and tested together.
- SSH and Docker panes also do not receive the host CLI, alias configuration or control credentials. Aliases require a compatible installation inside the target environment.
- Voktty does not yet install a global command for external Terminal.app, PowerShell, or other terminals. The bundled helper and cache descriptor already support that future installer step.
- The CLI does not launch a stopped Voktty app yet.
- Split, tab, agent, screen-read, and input commands are not part of protocol version 1 yet.

These limits are explicit so unsupported paths fail as unavailable instead of silently targeting the wrong pane or exposing a credential for a command that cannot connect.

## Extending the protocol

1. Add the method constant and typed parameters to `voktty-control-protocol`.
2. Validate authentication, protocol version, bounds, and OS-facing inputs in Rust.
3. Handle the method in Rust when it does not require React state. Route only UI-bound work to the frontend.
4. Resolve the explicit caller pane before falling back to active UI state.
5. Return structured errors and keep `--json` output stable.
6. Add protocol, parser, routing, platform, and size checks.

## See also

- [`VOKTTY.md`](https://github.com/voktty/voktty/blob/main/VOKTTY.md) - architecture source of truth
- [Two-process model](two-process-model.md) - Tauri IPC boundary
- [PTY shell integration](pty-shell-integration.md) - environment injection and shell startup
- [Security model](security-model.md) - workspace and secret boundaries
- [Internal aliases](internal-aliases.md) - schema, execution and shell compatibility
