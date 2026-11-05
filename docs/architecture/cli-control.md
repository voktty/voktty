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
                   [--preview | --accept-plan <sha256>] [--json]
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

Status never resolves or opens global memory storage. The native stateless inspector uses invocation-local directory keys for the common pure resolver; these keys are omitted from CLI output and cannot identify a persistent project or grant trust. Missing, inaccessible, corrupt or legacy global state cannot block this observation and remains untouched. The command creates no application directories, installation identity, preference locks or project files. Policy reports `{"state":"not_checked","mode":null}` and trust reports `not_checked`, including for a ready kit.

Remaining state-dependent CLI memory commands use the fixed `app.voktty.voktty/project-memory` directory beneath the native local application-data directory, matching Desktop. Earlier builds used `dev.voktty/project-memory`. An existing legacy entry, including empty, corrupt or linked state, refuses with `memory_legacy_state_requires_review` and exit 5 before opening either store or launching an agent. Inaccessible, linked or non-directory legacy application parents also refuse inspection. An ordinary legacy application directory without a `project-memory` entry does not block memory. Explicit `migrate-storage` is the only operation that moves legacy state; state-dependent commands never move, merge or discard installation identities, recovery journals, policies or trust. Project initialization and recovery do not inspect either global origin. After reviewed migration, a qualified permanent legacy marker permits the matching canonical store. Automatic migration is unavailable. Desktop retains its existing origin and behavior. `memory measure`, help and explicit `memory run --no-memory` remain independent of private state. The identifier equality is checked against the actual Desktop configuration by a regression test; platform bases remain native local data, including LocalAppData on Windows rather than roaming data.

The command never prints instruction text, persistent project keys, installation IDs or other projects' preferences. Capabilities still describe the existing command surface, including persistent policy management and Linux initial-prompt delivery; those commands retain global dependencies pending retirement. `initialPromptLaunch` qualifies delivery by platform and adapter version; it does not probe the installed agent or grant permission. Capture, managed resume and compaction remain unavailable.

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

`memory init` uses the embedded renderer, integrity lock and native project initialization publisher, without opening or creating application storage. Missing, inaccessible, corrupt or legacy global memory state does not block this command and remains untouched. `--set name=value` supplies one of the nine editable template inputs listed by `memory --help`; repeated keys, unknown inputs, NULs and values above 16 KiB fail before publication. Defaults use the canonical folder name, current UTC date and the shared template's remaining defaults, including English. Equal explicit values produce the same template bytes and integrity hashes as the panel. Both `AGENTS.md` and `CLAUDE.md` links are selected by default. The former `--link-agents` and `--link-claude` flags remain accepted for compatibility. Valid persisted template values take precedence when repairing or reusing an existing kit; initialization does not reconfigure project metadata.

Creation and reuse need no terminal prompt. When a replacement needs review and no digest was supplied, an interactive invocation displays each planned change, including before/after bytes. It accepts only the complete word `yes`; EOF and other replies cancel without project writes. Answers are bounded to 1024 bytes. Repository control characters, including terminal escapes and bidi overrides, are escaped in human previews. Native previews retain their original two-minute lifetime while waiting for a response and hold no publication guard during user review.

`voktty memory init` uses the current directory, including without a TTY or with `--json`; `--project` optionally selects another root. Create/skip-only plans publish directly under that invocation. `--preview` prepares a schema-2 native review with root, deployment, plan digest and publication blocker, without project writes. It has no global-journal resumption or recovery-file fields. Existing root-rule and private-ignore migrations require `--accept-plan <sha256>` from a prior preview or the interactive review above. A supplied digest is checked even for creation-only plans. Unknown file conflicts remain blocked and have no force option. The compatibility `--yes` flag suppresses an interactive replacement prompt but never bypasses the required digest. Preview cannot be combined with acceptance flags.

The digest covers the native origin and destination bindings, explicit-project-root placement and complete expected/proposed deployment bytes. It contains no installation identity or preference revision. Fresh migration transaction UUIDs are excluded so independent unchanged previews agree. Replaced roots, changed rules or changed values require another review. The original native object and publisher revalidate root handles, bytes, authority and expiration. CLI write access permits only the native inventory, required directories, canonical UUID-v4 staging names in the relevant parents, exact migrations and exact temporary recovery names.

Initialization targets the explicitly selected project root without recursively inspecting dependencies or selecting an ancestor kit. Separate parent and child projects remain independent; scope discovery for context use is a separate operation. The native publisher serializes its process-local admission and exclusively creates `.voktty/.initialization.json` to prevent concurrent cooperating publications. It retains no-replace creation, platform-specific migrations, marker ordering and changed-byte checks. The temporary project record and exact backups are cleaned after success. An interruption preserves them and blocks a fresh initialization for recovery; this command does not interpret or delete old global journals. Linux process tests cover the flow; other native platform runtime qualification remains outstanding.

Successful `--json` output retains the schema-1 result envelope with root, plan digest and acknowledged `created`, `skipped`, `migrated` and `cleaned` paths, including the temporary record when used. `contextActivated`, `capturesActivated` and `policyChanged` remain false: initialization starts no model and never accesses policy or trust. A publication failure exits 5 with one redacted stderr error and acknowledged changes plus possible recovery paths. Partial project files remain; failure is not proof that no write occurred. Reload and obtain a fresh review before retrying. CLI use/trust/run and the remaining Desktop/helper integrations still retain global-state dependencies until adapted.

## Standalone project initialization recovery

`memory recover` requires exactly one explicit `--preview` or
`--accept-review <sha256>` choice, including on interactive terminals. It uses
the process directory or `--project` as the exact native root. There is no force,
blind acceptance, remote-to-local translation or global fallback.

The command uses `OwnedProjectRecoveryPreview` and the existing
`.voktty/.initialization.json` record. It never resolves or opens either global
memory storage origin. Missing, inaccessible, corrupt or legacy global data does
not block recovery and remains untouched. Old global journals are not consumed.

Preview acquires the existing record's nonblocking activity lock and validates
its schema, reproducible template version, exact inventory, hashes and native
root-instance bindings. Live operations, unknown artifacts, older records without
reproducible inputs/actions and modified bases or rules remain explicit errors.
The native planner preserves current Content documents and reserved runtime data.

The JSON preview has schema 2, canonical `root`, native `reviewDigest`, complete
`deployment`, `restorations` with relative target/backup and literal original
text, `cleanup` entries with relative path and literal text, `recordCleanup`
and `publicationBlocker` or null. All effect flags are false. Human output escapes
terminal controls and bidi overrides. Preview writes no project or global data;
it can temporarily hold the existing record's OS lock.

Acceptance prepares a fresh review and compares its digest. The digest covers
the exact record, native root bindings, current file/backup snapshot and resulting
deployment. Project changes require another review; old global preferences do
not participate. The consuming native review keeps its 120-second lifetime and
retains the reacquired record lock through project and backup mutations, checking
roots, bytes and original authority between phases. CLI recovery shares init's
write authority for only the reviewed inventory, required parents, canonical UUID
staging, exact rule/ignore migrations and exact cleanup. Secret-path protections
remain in force.

Success reports schema 2, root, reviewDigest, acknowledged created/skipped/migrated/
cleaned paths and `initializationCompleted: true`. `originalsRestored` is true
only if missing originals were restored before migration. Their native metadata
is preserved under the qualified filesystem contract. Other effect flags remain
false. The command completes missing files, verifies the kit and then cleans only
recognized backups and the exact project record. It starts no agent. A completed
kit with record cleanup pending needs no new project files.

Usage errors exit 2. Unavailable or refused native reads, including unavailable
project records and busy locks, use redacted errors and exit 3. Invalid records,
conflicts, stale acceptance and admitted failures exit 5. Admitted failures use
one stderr envelope with error and acknowledged changes, including possible
recovery files; stdout remains empty. Earlier writes may have completed. Reload
and review again; interruption does not promise rollback. Unknown data and linked
artifacts remain preserved without their bodies appearing in errors.

Status capabilities expose `recovery: { preview, completeInitialization }`.
Compiled support on Linux, Android and Windows is not runtime qualification.
Linux process tests cover native recovery, complete literal review, terminal
escaping, exact acceptance, metadata, preserved context/sessions, unusable global
origins, untouched old data, changed project facts and a live record lock.
Other native platforms and filesystems require runtime qualification. Desktop and
SSH helper recovery callers retain their previous private-journal contract until
adapted.

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

The wrapper qualifies its selected native execution directory and observes bounded ancestor scope and existing root-bound policy through its legacy launch observation, separate from the stateless public `memory status` command. This launcher still depends on global memory storage pending retirement. It creates no kit or installation state and prompts for no consent. A complete absent or reserved scope, or a ready kit with Manual/Never and no session request, launches without integration or instruction-body reads and writes an actionable notice to stderr. Invalid, ambiguous or incomplete scopes fail explicitly. `--no-memory` skips kit and preference inspection after qualifying the directory. Existing runtime rule files remain outside Voktty's removal authority.

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

The previous private-journal restoration measured 9,519,920 bytes in the Linux x86_64 GNU release
sidecar built by `build-cli.mjs`. It reuses the existing native recovery core
without adding a dependency. Other targets require their own builds and runtime
qualification. The project-record recovery artifact has not been measured yet.

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
