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
voktty memory recover [--project <directory>]
                      --preview | --accept-review <sha256> [--json]
voktty memory migrate-storage --preview | --accept-review <sha256> [--json]
voktty memory use --always|--never|--manual [--project <directory>]
                  [--preview] [--json]
voktty memory trust [--project <directory>] [--role .voktty/team/roles/<name>.md]
                    --preview | --accept-review <sha256> [--json]
voktty memory run [--project <directory>] [--session|--no-memory]
                  codex|claude|agy [-- <agent-args...>]
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

Discovery works without private state. The native stateless inspector uses invocation-local directory keys for the common pure resolver; these keys are omitted from CLI output and cannot identify a persistent project or grant trust. If a ready kit has existing private state, the CLI opens the fixed `app.voktty.voktty/project-memory` directory beneath the native local application-data directory, matching Tauri's `app_local_data_dir` and configured identifier. It observes only that root's effective policy and whether an accepted instruction digest is stored, including native root-instance checks and final revalidation. Existing state may acquire its normal preferences lock; the command creates no application directories, installation identity or project files. Missing state reports the default `manual` policy separately from an unavailable state origin. Corrupt or inaccessible existing state is preserved and fails explicitly.

Ordinary state-dependent CLI memory commands use this Desktop origin. Earlier builds used `dev.voktty/project-memory`. An existing legacy entry, including empty, corrupt or linked state, refuses with `memory_legacy_state_requires_review` and exit 5 before opening either store or launching an agent. Inaccessible, linked or non-directory legacy application parents also refuse inspection. An ordinary legacy application directory without a `project-memory` entry does not block memory. Explicit `migrate-storage` is the only operation that moves legacy state; state-dependent commands never move, merge or discard installation identities, recovery journals, policies or trust. Project initialization does not inspect either global origin. After reviewed migration, a qualified permanent legacy marker permits the matching canonical store. Automatic migration is unavailable. Desktop retains its existing origin and behavior. `memory measure`, help and explicit `memory run --no-memory` remain independent of private state. The identifier equality is checked against the actual Desktop configuration by a regression test; platform bases remain native local data, including LocalAppData on Windows rather than roaming data.

Trust reports `not_checked`, `not_accepted` or `stored_not_checked`. The last value confirms only a stored digest, not that current instructions still match it. The command never prints instruction text, persistent project keys, installation IDs or other projects' preferences. Capabilities declare discovery, explicit initialization, persistent policy management and Linux initial-prompt delivery. `initialPromptLaunch` qualifies the latter by platform and adapter version; it does not probe the installed agent or grant permission. Capture, managed resume and compaction remain unavailable.

With `--json`, stdout contains `{ "ok": true, "result": { "schema": 1, ... } }` for a completed observation. The result includes `transport`, canonical `directory`, a uniquely resolved `root` or null, `scope`, `policy`, `trust` and `capabilities`. `scope` includes state, ancestry completeness, ancestor-kit paths, blocked count and `descendantsChecked: false`. An ambiguous scope lists every observed ancestor kit and returns no selected root. Exit 0 means a complete `ready`, `absent` or `reserved` observation; exit 5 means an invalid, partial, ambiguous or incomplete scope, with the observation still on stdout. Usage errors exit 2; unavailable or refused native/state IO exits 3. Errors use the existing `{ "ok": false, "error": { "code", "message" } }` stderr envelope with redacted messages. `memory --help` describes the currently available command; unsupported subcommands fail before filesystem or control-plane IO.

The local binary does not translate `remote://`, UNC, WSL or Docker destinations into local paths. Running a compatible CLI inside another environment uses that process's own native filesystem and installation state; it does not borrow the desktop's authorization or state. Native Windows and macOS runtime qualification remains required.

## Explicit private storage migration

`memory migrate-storage` acts on this execution machine's complete legacy memory
installation, including every project's stored preference. It requires exactly
one `--preview` or `--accept-review <sha256>`, including on a TTY. There is no
project selection, application-path override, force or blind acceptance option.
Linux and Android have the native atomic exchange implementation; other platforms
refuse before storage IO. Linux runtime tests qualify the implemented flow;
Android, other platforms and additional filesystems remain unqualified.

Preview opens only existing legacy state. It can acquire/create the ordinary
preference and deployment lock files, but creates no destination, identity or
project files. Its schema-1 result includes `reviewDigest`, policy counts, stored
instruction-digest count, journal presence and pending-reservation status.
Installation IDs, project keys, account paths and file bodies are not printed.
Journal presence does not certify its validity for later project recovery.

Acceptance requires the matching fresh native review. It preserves the directory
and file objects, installation identity, exact preferences and journal bytes,
including Never and accepted instruction digests. It grants no new trust, session
permission, tools, context delivery or captures. An existing destination memory
directory, even an empty one, blocks migration; two installations are never
merged. Unknown artifacts, corrupt preferences, links, hardlinks, unsafe
permissions, changed facts and unavailable filesystem identity block without
discarding data. The destination application directory's unrelated files remain
untouched. See the [native origin contract](../../src-tauri/crates/voktty-memory-local/ORIGIN.md).

The single directory exchange leaves a permanent marker at the legacy memory
path, blocking old writers. Keep this marker. A qualified interrupted reservation
can be reviewed again and completed. There is no automatic rollback or cleanup
of foreign or invalid artifacts. Errors after admission report
`applicationParentMayExist`, `reservationCreated` and `stateMoved`; a failure
does not prove that nothing changed. Reload before retrying. Usage errors exit 2,
native preparation errors use the existing redacted errors and exit 3, and a
changed acceptance or admitted failure exits 5 with one stderr error envelope.
Successful preview or migration exits 0. JSON success flags separately report
`stateMoved` and false policy, trust, project-file, context and capture changes.

## Standalone memory initialization

`memory init` uses the embedded renderer, integrity lock and native project initialization publisher, without opening or creating application storage. Missing, inaccessible, corrupt or legacy global memory state does not block this command and remains untouched. `--set name=value` supplies one of the nine editable template inputs listed by `memory --help`; repeated keys, unknown inputs, NULs and values above 16 KiB fail before publication. Defaults use the canonical folder name, current UTC date and the shared template's remaining defaults, including English. Equal explicit values produce the same template bytes and integrity hashes as the panel. Root links are still off unless `--link-agents` or `--link-claude` is selected; simplifying these CLI options and the Desktop flow remains separate work.

An interactive invocation displays each planned change, including before/after bytes. It accepts only the complete word `yes`; EOF and other replies cancel without project writes. Answers are bounded to 1024 bytes. Repository control characters, including terminal escapes and bidi overrides, are escaped in human previews. Native previews retain their original two-minute lifetime while waiting for a response and hold no publication guard during user review.

Without both interactive stdin and stdout, or with `--json`, initialization still requires an explicit `--project` and either `--preview` or `--yes`. Missing decisions fail with usage exit 2 before publication. `--preview` prepares a schema-2 native review with root, deployment, plan digest and publication blocker, without project writes. It has no global-journal resumption or recovery-file fields. `--yes` accepts new-file creation. Existing root-rule and private-ignore migrations additionally require `--accept-plan <sha256>` from a prior preview. A supplied digest is checked even for creation-only plans. Unknown file conflicts remain blocked and have no force option.

The digest covers the native origin and destination bindings, explicit-project-root placement and complete expected/proposed deployment bytes. It contains no installation identity or preference revision. Fresh migration transaction UUIDs are excluded so independent unchanged previews agree. Replaced roots, changed rules or changed values require another review. The original native object and publisher revalidate root handles, bytes, authority and expiration. CLI write access permits only the native inventory, required directories, canonical UUID-v4 staging names in the relevant parents, exact migrations and exact temporary recovery names.

Initialization targets the explicitly selected project root without recursively inspecting dependencies or selecting an ancestor kit. Separate parent and child projects remain independent; scope discovery for context use is a separate operation. The native publisher serializes its process-local admission and exclusively creates `.voktty/.initialization.json` to prevent concurrent cooperating publications. It retains no-replace creation, platform-specific migrations, marker ordering and changed-byte checks. The temporary project record and exact backups are cleaned after success. An interruption preserves them and blocks a fresh initialization for recovery; this command does not interpret or delete old global journals. Linux process tests cover the flow; other native platform runtime qualification remains outstanding.

Successful `--json` output retains the schema-1 result envelope with root, plan digest and acknowledged `created`, `skipped`, `migrated` and `cleaned` paths, including the temporary record when used. `contextActivated`, `capturesActivated` and `policyChanged` remain false: initialization starts no model and never accesses policy or trust. A publication failure exits 5 with one redacted stderr error and acknowledged changes plus possible recovery paths. Partial project files remain; failure is not proof that no write occurred. Reload and obtain a fresh review before retrying. The other CLI memory commands and Desktop/helper integrations still retain their existing global-state dependencies until adapted.

## Standalone restoration of saved originals

`memory recover` requires exactly one explicit `--preview` or
`--accept-review <sha256>` choice, on both interactive and noninteractive
terminals. There is no force, blind `--yes` or automatic acceptance. The command
uses its process directory or `--project` as the exact native execution and
restoration root; it cannot select a different journal destination or translate
a remote namespace into local IO. It opens only existing private state in the
Desktop storage origin. Missing state never creates directories, an installation
identity or a journal. Existing cooperating locks may be acquired. The legacy
origin guard applies to recovery and trust; project initialization is independent.

The shared `OwnedRecoveryReview` reads the installation-bound journal and reviews
one to three saved originals whose targets are missing. The JSON preview contains
schema 1, canonical `root`, a native `reviewDigest`, complete literal `entries`
with relative `target`, `backup` and original `text`, and false
`originalsRestored`, `initializationCompleted`, `policyChanged`, `trustChanged`,
`contextActivated` and `capturesActivated`. Human output escapes terminal controls
and bidi overrides without truncating the bounded original text. Preview changes
no project files, policy or trust and exposes no private storage path or
installation identity.

Acceptance constructs a fresh native review for the same root and compares its
digest before restoration. The digest binds the complete intent, root instances,
installation, preference revision and exact restoration entries. It is an
acceptance check, not a durable write capability or a remembered session grant.
Changes to root instances, reviewed bytes, target presence, preference revision
or journal facts require another review. The native object retains its
120-second lifetime and revalidates under
the existing deployment lock before and between moves. CLI write authority
permits only the reviewed missing targets and exact original backups; it grants
no replacements, directory creation, arbitrary staging or secret-file access.

Success reports schema 1, `root`, `reviewDigest`, `created`, `cleaned`, empty
`skipped` and `migrated`, and `originalsRestored: true`. Other effect flags remain
false and describe this operation. Original objects are moved back, preserving
their native metadata under the qualified filesystem contract. Existing targets
are preserved. Private preferences and the interrupted journal remain unchanged;
the command never finishes initialization or starts an agent. A fresh
`memory init --preview` can review initialization after restoration, independently
of the preserved global journal. It does not consume or delete that journal.
Restored, now-present targets are no longer recovery candidates.

Usage errors exit 2 before IO. Unavailable or refused native/state reads use the
existing redacted errors and exit 3. Missing matching recovery, stale acceptance,
conflicts and restoration failures exit 5. An admitted restoration failure uses
one `ok: false` stderr envelope with `error` and top-level acknowledged `changes`
(`created`, `migrated`, `cleaned`, `possibleRecoveryFiles`); stdout remains empty.
Some moves may already have completed. Reload and review again; no automatic
rollback or repair occurs. Corrupt state and foreign or linked artifacts are
preserved without exposing their bodies in errors.

Status capabilities include `recovery: { preview, restoreOriginals }`. The latter
reflects compiled native restoration support on Linux, Android and Windows, not
runtime qualification. Linux process tests cover preview, exact acceptance,
metadata, unchanged private state, changed facts, malformed input, terminal
escaping and separately reviewed resumption. Other platform and filesystem
runtime qualification remains outstanding. The SSH helper uses the same native
origin resolver and storage on its execution host. Its legacy-state refusal is
`legacyStateRequiresReview`; this local command does not migrate or combine
settings. Desktop on another machine retains its separate installation.

## Persistent memory policy

`memory use` requires exactly one explicit `--always`, `--never` or `--manual` choice. The selected directory defaults to the process cwd; `--project` selects another native local directory. The command resolves a single valid ancestor kit before opening private state. Missing, reserved, invalid, ambiguous or incomplete scopes fail without initializing state or changing preferences. Unresolved environments never fall back to the desktop filesystem. Once a valid scope is established, the command may explicitly initialize the same native private installation state used by the panel.

The CLI calls `MemoryPolicyReview::prepare` and its consuming `accept` method synchronously, without creating an async runtime. The desktop worker delegates to those same native operations while retaining its existing admission, cancellation and settlement wrapper. Reviews retain the original root instances, installation, preference snapshot and two-minute lifetime. Scope and root checks run again before storing by revision compare-and-swap; changed roots or concurrent preferences require another review. An IO error after admission may occur after a policy write has completed, so reload status before retrying.

`--preview` reports the resolved root, prior and requested modes, and stored-trust status without accepting the choice. It may initialize previously absent private installation state, but creates no project preference. Explicit mode flags apply without a second terminal prompt and work without a TTY or running Desktop. The policy is local to this machine and native project root, outside Git. Choosing a policy preserves valid existing instruction trust, never reads or accepts new instruction bytes, grants no session/capture permission and starts no model. `stored_not_checked` does not confirm that current instructions match the accepted digest. Existing linked rules and context already delivered to a runtime remain outside this policy change's removal authority.

Successful JSON output uses the existing `ok/result` envelope with schema 1, canonical memory `root`, `scope: "project-on-this-machine"`, `previousMode`, `mode`, `policyStored` and `trust`. `contextActivated`, `capturesActivated` and `projectFilesChanged` are false. Preview has `policyStored: false`; successful acceptance has `policyStored: true`. Usage errors exit 2, unavailable native/state IO exits 3, and unavailable or changed review scopes exit 5. No private project keys, installation IDs or unrelated preferences enter the output. The command cannot erase an admitted write or reset corrupt state automatically.

`--session` in `memory use` requires an addressable existing conversation and is rejected before filesystem or private-state IO, with an action to use Project Memory in that conversation. For a new qualified launch, `memory run --session` creates an ephemeral native binding instead. Neither path stores a global choice disguised as temporary permission.

## Standalone instruction trust

`memory trust` requires exactly one of `--preview` or `--accept-review <sha256>`. It uses the process directory or `--project` and accepts an optional exact `.voktty/team/roles/<name>.md` path; names contain only lowercase ASCII letters, digits and hyphens. Invalid options fail before IO. The CLI first resolves one ready kit with complete ancestor discovery. Only that resolved root receives instruction-read authority, alongside the original execution directory and metadata-only ancestor markers. Shared native path, link, filesystem, size and lifetime checks remain in force.

Preview displays the complete native instruction inventory and configuration, including selected role and existing root rules. It excludes factual `PROJECT.md`/`CONTEXT.md`, installation identity, persistent project keys and unrelated preferences. Human previews escape terminal controls and bidi overrides; JSON retains literal content through normal JSON escaping. Explicit preview may initialize private installation state, but creates no project preference or project files.

`reviewDigest` hashes a versioned native review binding: original execution root and memory root identities and birth instances, installation, preference revision, configuration and instruction fingerprint including role. Use the same execution directory and role when accepting. A replaced root, changed configuration or instructions, changed role or any preference revision requires another preview. Factual context changes alone do not require instruction trust again. The hash is an explicit acceptance check, not delivery authority or a token with its own expiration. Each invocation constructs a fresh native review with the existing two-minute lifetime; consuming acceptance rechecks scope, root instances, installation, preferences and current instructions before the native compare-and-swap write. Desktop workers delegate to the same synchronous preparation and acceptance while retaining their admission and retirement wrapper.

Acceptance stores only this machine's root-bound instruction digest, preserves use policy including `never`, grants no tools or session permission, and delivers no context or captures. Successful schema-1 JSON uses the normal `ok/result` envelope with `root`, `reviewDigest`, `trustStored`, and false `policyChanged`, `contextActivated`, `capturesActivated` and `projectFilesChanged`. Preview additionally includes `config` and `instructions`, with `trustStored: false`. Usage errors exit 2; native/state IO errors exit 3; unavailable or changed review scopes exit 5. Errors redact file contents and private state. Linux process tests cover this flow; native Windows and macOS runtime qualification remains outstanding.

## Standalone memory measurement

`voktty memory measure [--project <directory>] [--up-next-heading <heading>] [--json]`
works without Desktop, a TTY or private installation state. It resolves one ready
ancestor kit through the common native scope resolver and delegates to
`measure_local_memory` and the shared pure measurement core. It never initializes
a kit, opens preferences, enables memory, reads instruction or handoff bodies,
captures, archives or compacts files. An unavailable or ambiguous scope fails
without selecting an arbitrary kit. Remote namespaces remain unsupported.

The command measures configured character limits for `CONTEXT.md`, `PROJECT.md`,
`plans/INDEX.md`, `plans/TRACKING.md` and `continuity/CHANGELOG.md`; Up next entries
use the exact heading, defaulting to `Up next`. Translated projects can pass
`--up-next-heading` explicitly. Handoff count and age use bounded metadata for
regular Markdown files excluding README. Age comes from the portable UTC filename,
not filesystem timestamps. Unknown or future dates remain unknown. Incomplete
enumeration, links/special Markdown entries and unavailable documents never
become zero counts or empty text.

Schema-1 JSON returns the normal `ok/result` envelope with `transport: "local"`,
`root`, `measurements`, `complete` and `exceeded`. Each metric has `path`, `metric`
(`chars`, `up-next`, `files` or `age-ms`), nullable `value`, `limit` and `status`
(`ok`, `exceeded` or `unknown`). Exit 0 means complete and within limits; exit 5
returns a report with unknown or exceeded metrics. Usage errors exit 2; native
scope, authorization or IO errors exit 3 with the existing redacted error envelope.
Status capabilities advertise `measurement: true` independently of delivery.

The reader retains one of four native read permits through settlement, the
original fifteen-second discovery lifetime and five-second phases. Its measured
document set is at most six files of 256 KiB each (1.5 MiB); scope discovery
retains its separate bounded ancestor configuration reads. It enumerates at most
20,000 handoff entries plus one overflow observation and rechecks directory objects, configuration,
scope and authority without following symlinks/reparse points. These are bounded
point-in-time observations, not an atomic filesystem snapshot. Linux process and
native tests cover this contract; other native platforms still require runtime
qualification. See the [native measurement contract](../../src-tauri/crates/voktty-memory-local/MEASUREMENT.md).

## Standalone agent launch

`memory run` accepts `codex`, `claude` or `agy`, with optional wrapper `--project` and mutually exclusive `--session`/`--no-memory` before the `--` separator. Without integration, every argument after that separator is forwarded unchanged, including empty arguments, non-UTF-8 bytes and the agent's `--json`. Wrapper `--json` is rejected because child output is inherited rather than wrapped in a Voktty envelope. Unknown adapters, duplicate or incompatible options and unseparated agent arguments fail before IO.

The wrapper qualifies its selected native execution directory and observes bounded ancestor scope and existing root-bound policy through `memory status`'s shared implementation. It creates no kit or installation state and prompts for no consent. A complete absent or reserved scope, or a ready kit with Manual/Never and no session request, launches without integration or instruction-body reads and writes an actionable notice to stderr. Invalid, ambiguous or incomplete scopes fail explicitly. `--no-memory` skips kit and preference inspection after qualifying the directory. Existing runtime rule files remain outside Voktty's removal authority.

An explicit session request requires a ready kit and cannot override Never. On Linux, `--session` or inherited Always can prepare the shared native packet for the initial user prompt in Codex 0.165.0 or Claude 2.1.312. The CLI uses the same native review, binding, policy/trust checks and 24 KiB builder as Desktop. It rereads before handoff and rejects changed packets or roots. Missing or stale instruction trust refuses startup without accepting trust or changing policy. The initial prompt contains the packet followed by the user's original request; other admitted arguments remain unchanged. Context is a user message, never a system/developer override. The prompt argument can be visible in local process listings. Native workspace, authentication and tool approvals remain in force; Voktty does not answer those prompts.

Only verified interactive options are admitted with integration. Codex accepts model, sandbox, approval policy, local provider and additional directories, plus no-alt-screen, no-daemon, OSS, search and its explicit approval-bypass booleans. Claude accepts `--model`, `--effort`, `--permission-mode`, `--name`/`-n`, and the no-chrome, disable-slash-commands and explicit permission-bypass booleans. Voktty adds none of those permission flags. An existing final prompt or explicit `--` delimiter is preserved; the prefix replaces only that prompt argument, or a new delimited prompt is appended. Without a task prompt, the packet becomes a memory-only initial user turn and can start an immediate agent response. Combined prompt/argv bytes are bounded to 64 KiB. Cwd/remote/profile/config overrides, subcommands, resume/fork, print mode, images, unknown options and unsupported versions/adapters fail before starting the agent, with the manual startup-message alternative. Claude's variadic options, custom agent definitions and slash-prefixed initial commands are also unqualified; the wrapper does not reinterpret those requests. Without integration all those arguments retain their ordinary native meaning. Official references describe interactive initial user prompts for [Codex](https://developers.openai.com/codex/cli/reference/) and [Claude](https://code.claude.com/docs/en/cli-reference).

Version admission resolves the executable through the caller's PATH, captures its native file identity and checks `--version` with null stdin, a separate process group, a nonblocking stdout pipe, a 4096-byte limit and a two-second cooperative deadline. Stderr is discarded and probe output never enters errors. Cleanup kills the owned group and waits for the direct child, including timeout and inherited-pipe cases. During this synchronous probe, termination signals are deferred until cleanup; the child receives the original signal mask, and pending termination is honored before an interactive launch. The executable's device, inode, size, modification and change times are checked after probing and before execution. The selected execution directory is held open, checked against the current path and installed as cwd through its descriptor immediately before exec. Checks remain point-in-time observations against external writers; OS calls are not forcibly interruptible.

The launch notice reports packet preparation, not provider acceptance, reading or comprehension. A real Codex renderer validates the initial prompt's user role without requesting inference. Claude's interactive PTY channel is checked against a synthetic loopback Messages endpoint with isolated fixture configuration and credentials; native trust and key prompts are handled only for that fixture, with no external model inference. Process fixtures verify packet bytes, policy revocation, stdin and ownership. The native binding is consumed for the initial handoff and creates no persistent session permission or delivery receipt. Later turns, compacted history and resumed conversations belong to the native runtime; Voktty does not silently re-inject or claim managed resume/capture support. Other adapters and native platforms require their own channel qualification.

On Unix the final step uses `CommandExt::exec`, replacing the wrapper with the chosen executable resolved through the caller's PATH. It keeps the selected cwd, terminal descriptors, process ID, process group, signals and native exit status without reconstructing shell text, intercepting stdin, installing aliases or starting an async runtime. The agent owns its process and provider behavior after replacement. Spawn failures use a redacted unavailable error. Native Windows launch is explicitly unavailable before project IO until its process and console contract is implemented. Linux fixtures cover argv, cwd, binary stdin, stdout/stderr, exit codes and signal behavior; native macOS runtime qualification remains outstanding.

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

The release profile uses one codegen unit, fat LTO, optimization level 3, abort-on-panic, and debug-info stripping. Reusing the native memory reader and embedded schema validation increased the Linux x86_64 CLI from 3,528,952 to 8,781,328 bytes for standalone status. Initialization and the shared native publisher measured 9,161,928 bytes; persistent policy management measured 9,208,400 bytes and explicit instruction trust measured 9,289,008 bytes and Unix agent launch measured 9,299,784 bytes and the qualified Codex initial-prompt channel measured 9,386,032 bytes. The shared Codex/Claude initial-prompt build measured 9,388,760 bytes; standalone memory measurement brings the measured Linux x86_64 build to 9,453,896 bytes. This trades additional artifact size for the same scope, path, publication and preference rules as the desktop. No external package versions change. Other target sizes require their own builds; always measure the actual artifacts after changing dependencies.

Reviewed restoration measures 9,519,920 bytes in the Linux x86_64 GNU release
sidecar built by `build-cli.mjs`. It reuses the existing native recovery core
without adding a dependency. Other targets require their own builds and runtime
qualification.

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
