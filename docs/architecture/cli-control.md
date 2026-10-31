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
voktty memory status [--project <directory>] [--json]
voktty memory init [--project <directory>] [--set <name=value>]...
                   [--link-agents] [--link-claude]
                   [--preview | --yes [--accept-plan <sha256>]] [--json]
voktty memory use --always|--never|--manual [--project <directory>]
                  [--preview] [--json]
```

App control commands require Voktty to be running. A command launched inside a Voktty pane targets that pane's space, even if another space or tab has UI focus. An external client without pane context falls back to the active UI context. `memory status` runs independently and uses its process directory or explicit `--project`, without control credentials or UI focus.

## Components

- `src-tauri/crates/voktty-control-protocol` contains dependency-light request, response, error, descriptor, and method types shared by the app and CLI.
- `src-tauri/crates/voktty-cli` contains the standalone console client. It has no Clap or Tauri dependency and does not create an async runtime for memory discovery. It reuses the synchronous native memory reader and embedded kit validation resources; Tokio remains a transitive dependency of the existing HTTP and memory libraries.
- `src-tauri/crates/voktty-memory-local` owns local memory path qualification, bounded native discovery and installation preferences. The CLI uses the same scope resolver, root bindings and secret-path protections as the desktop.
- `src-tauri/crates/voktty-aliases` contains the dependency-light schema, validation, merge, context and atomic configuration core shared by the app and CLI.
- `src-tauri/src/modules/control.rs` owns endpoint discovery, authentication, message limits, concurrency limits, timeouts, path canonicalization, and request routing.
- `src/modules/control/` maps a caller pane to its tab and space, then performs the small set of UI-only actions.
- `scripts/build-cli.mjs` builds the target-specific helper expected by Tauri's `externalBin` bundler.

Rust handles `ping`, `capabilities`, authentication, and file validation directly. Actions that must mutate React state are emitted to the main webview and completed through `control_respond`. This keeps OS validation in Rust without duplicating the tab model outside React.

## Standalone memory status

`memory status` inspects the selected directory and its ancestor markers on the qualified local filesystem. It performs no descendant scan, instruction read, initialization, policy change or model call. Explicit invocation authorizes only ancestor directory metadata, bounded `.voktty` entry names and `kit.json` content. It does not register a desktop workspace or grant instruction access. Native reads reject links, unsupported filesystems, secret paths, invalid or oversized markers and incomplete ancestry through the existing reader. Discovery and verification share a five-second cooperative deadline; this cannot interrupt a blocked OS call.

Discovery works without private state. The native stateless inspector uses invocation-local directory keys for the common pure resolver; these keys are omitted from CLI output and cannot identify a persistent project or grant trust. If a ready kit has existing private state, the CLI opens the fixed `dev.voktty/project-memory` directory beneath the native local application-data directory, matching Tauri's storage origin. It observes only that root's effective policy and whether an accepted instruction digest is stored, including native root-instance checks and final revalidation. Existing state may acquire its normal preferences lock; the command creates no application directories, installation identity or project files. Missing state reports the default `manual` policy separately from an unavailable state origin. Corrupt or inaccessible existing state is preserved and fails explicitly.

Trust reports `not_checked`, `not_accepted` or `stored_not_checked`. The last value confirms only a stored digest, not that current instructions still match it. The command never prints instruction text, persistent project keys, installation IDs or other projects' preferences. Its current capabilities declare discovery, explicit initialization and persistent policy management. CLI session permissions and delivery remain unavailable and are not enabled by an `always` preference alone.

With `--json`, stdout contains `{ "ok": true, "result": { "schema": 1, ... } }` for a completed observation. The result includes `transport`, canonical `directory`, a uniquely resolved `root` or null, `scope`, `policy`, `trust` and `capabilities`. `scope` includes state, ancestry completeness, ancestor-kit paths, blocked count and `descendantsChecked: false`. An ambiguous scope lists every observed ancestor kit and returns no selected root. Exit 0 means a complete `ready`, `absent` or `reserved` observation; exit 5 means an invalid, partial, ambiguous or incomplete scope, with the observation still on stdout. Usage errors exit 2; unavailable or refused native/state IO exits 3. Errors use the existing `{ "ok": false, "error": { "code", "message" } }` stderr envelope with redacted messages. `memory --help` describes the currently available command; unsupported subcommands fail before filesystem or control-plane IO.

The local binary does not translate `remote://`, UNC, WSL or Docker destinations into local paths. Running a compatible CLI inside another environment uses that process's own native filesystem and installation state; it does not borrow the desktop's authorization or state. Native Windows and macOS runtime qualification remains required.

## Standalone memory initialization

`memory init` uses the desktop's embedded renderer, integrity lock and native initialization preview/publication implementation. It does not generate a second filesystem deployment plan. `--set name=value` supplies one of the nine editable template inputs listed by `memory --help`; repeated keys, unknown inputs, NULs and values above 16 KiB fail before private-state creation. Defaults use the canonical folder name, current UTC date and the shared template's remaining defaults, including English. Equal explicit values produce the same template bytes and integrity hashes as the panel. Root links are off unless `--link-agents` or `--link-claude` is selected; the existing CLAUDE link dependency and conflict checks still apply.

An interactive invocation displays each planned change, including before/after bytes and known recovery cleanup. It accepts only the complete word `yes`; EOF and other replies cancel without project writes. Answers are bounded to 1024 bytes. Repository control characters, including terminal escapes and bidi overrides, are escaped in human previews. Native previews retain their original two-minute lifetime while waiting for a response and hold no deployment lock during user review.

Without both interactive stdin and stdout, or with `--json`, initialization requires an explicit `--project` and either `--preview` or `--yes`. Missing decisions fail with usage exit 2 before project or application-state IO. `--preview` alone prepares and displays a schema-1 native review, but changes no project file. Explicit initialization or preview may create the fixed private application directory and installation identity; this is separate from creating a kit. `--yes` accepts new-file creation. Existing root-rule and private-ignore migrations, or known recovery cleanup, additionally require `--accept-plan <sha256>` from a prior preview. A supplied digest is checked even for creation-only plans. Unknown file conflicts remain blocked and have no force option.

The digest covers the native origin and destination identities, installation-bound project keys, preference revision, complete expected/proposed plan bytes and recovery contents. Fresh migration transaction UUIDs are excluded so independent unchanged previews agree. Replaced roots, changed rules, changed values or preference revisions require another review. The digest is an acceptance check, not write authority or a durable trust grant; the original native object and publisher still revalidate root handles, scopes, preferences, bytes and expiration. CLI write access is created only after acceptance and permits the native inventory, its required directories, canonical UUID-v4 staging names in the relevant parents, exact migrations and exact recovery names. It does not authorize arbitrary files in the project.

Publication retains the existing installation-wide deployment lock, descendant-scope checks, no-replace creation, platform-specific migrations, marker-last ordering and partial recovery contract. Linked, unverified, overlapping or incomplete scopes cannot be forced. Windows and other non-Linux/Android targets retain their existing explicit migration blocker. Local Linux process tests cover the implemented flow; other native platform runtime qualification remains outstanding.

Successful `--json` output uses the normal `ok/result` envelope with schema 1, root, plan digest and acknowledged `created`, `skipped`, `migrated` and `cleaned` paths. `contextActivated`, `capturesActivated` and `policyChanged` are false: initialization preserves existing policy and trust and starts no model. A publication failure exits 5 and writes one `ok: false` stderr envelope with its redacted error and acknowledged changes plus possible recovery paths. It preserves partial files and private recovery state; a failure is not proof that no write occurred. Preparation, scope, stale-review, unsupported migration and consent errors also fail explicitly. Reload and obtain a new concrete review before retrying.

## Persistent memory policy

`memory use` requires exactly one explicit `--always`, `--never` or `--manual` choice. The selected directory defaults to the process cwd; `--project` selects another native local directory. The command resolves a single valid ancestor kit before opening private state. Missing, reserved, invalid, ambiguous or incomplete scopes fail without initializing state or changing preferences. Unresolved environments never fall back to the desktop filesystem. Once a valid scope is established, the command may explicitly initialize the same native private installation state used by the panel.

The CLI calls `MemoryPolicyReview::prepare` and its consuming `accept` method synchronously, without creating an async runtime. The desktop worker delegates to those same native operations while retaining its existing admission, cancellation and settlement wrapper. Reviews retain the original root instances, installation, preference snapshot and two-minute lifetime. Scope and root checks run again before storing by revision compare-and-swap; changed roots or concurrent preferences require another review. An IO error after admission may occur after a policy write has completed, so reload status before retrying.

`--preview` reports the resolved root, prior and requested modes, and stored-trust status without accepting the choice. It may initialize previously absent private installation state, but creates no project preference. Explicit mode flags apply without a second terminal prompt and work without a TTY or running Desktop. The policy is local to this machine and native project root, outside Git. Choosing a policy preserves valid existing instruction trust, never reads or accepts new instruction bytes, grants no session/capture permission and starts no model. `stored_not_checked` does not confirm that current instructions match the accepted digest. Existing linked rules and context already delivered to a runtime remain outside this policy change's removal authority.

Successful JSON output uses the existing `ok/result` envelope with schema 1, canonical memory `root`, `scope: "project-on-this-machine"`, `previousMode`, `mode`, `policyStored` and `trust`. `contextActivated`, `capturesActivated` and `projectFilesChanged` are false. Preview has `policyStored: false`; successful acceptance has `policyStored: true`. Usage errors exit 2, unavailable native/state IO exits 3, and unavailable or changed review scopes exit 5. No private project keys, installation IDs or unrelated preferences enter the output. The command cannot erase an admitted write or reset corrupt state automatically.

`--session` outside a launch requires an addressable conversation. This CLI does not yet expose that binding and rejects the option before filesystem or private-state IO, with an action to use Project Memory in the actual conversation. It never stores a global choice disguised as temporary permission. Standalone session launch, instruction-trust acceptance and provider delivery remain pending.

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

The release profile uses one codegen unit, fat LTO, optimization level 3, abort-on-panic, and debug-info stripping. Reusing the native memory reader and embedded schema validation increased the Linux x86_64 CLI from 3,528,952 to 8,781,328 bytes for standalone status. Initialization and the shared native publisher measured 9,161,928 bytes; persistent policy management brings the measured build to 9,208,400 bytes. This trades additional artifact size for the same scope, path, publication and preference rules as the desktop. No external package versions change. Other target sizes require their own builds; always measure the actual artifacts after changing dependencies.

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
