# AI subsystem

This guide elaborates on `VOKTTY.md`. If anything here conflicts with `VOKTTY.md`, `VOKTTY.md` wins.

## Overview

The AI subsystem is BYOK (bring your own key). It supports cloud providers via `@ai-sdk/*` and local / offline providers via OpenAI-compatible endpoints. The agent layer is built on Vercel AI SDK v6 chat semantics: `streamText`, tool definitions, and `stopWhen` step limits.

Main entry point: `runAgentStream` in `src/modules/ai/lib/agent.ts`.

Agent Development exposes two views: the existing external CLI Harness and Voktty AI. The Voktty AI view reuses the native chat sessions, configured BYOK and local model picker, composer, tool approvals and edit review. Only the focused development view mounts its composer. While it owns chat presentation, sending a message or focusing the input does not open a second floating chat, and returning to the Harness keeps its live sessions mounted. Its tool cwd follows the active development project rather than an unrelated terminal.

## Providers

Cloud providers are defined in `src/modules/ai/config.ts`:

- OpenAI, Anthropic, Google, xAI, Cerebras, Groq, DeepSeek, Mistral, OpenRouter
- `openai-compatible` for any custom base URL
- Local: LM Studio, MLX, Ollama

`buildLanguageModel` in `src/modules/ai/lib/agent.ts:76` branches on `provider` to construct the correct AI SDK provider instance. Local providers use `createOpenAICompatible` with a `localProxyFetch` that allows private-network access, while cloud providers use their dedicated SDK constructors.

Model metadata (context limits, costs, reasoning behavior) lives in the model registry in `config.ts`. `resolveModel` maps a model id to its provider and defaults.

### Adding a new provider

1. Add a `ProviderInfo` entry to `PROVIDERS` in `src/modules/ai/config.ts`.
2. Add model ids and metadata to the model registry in the same file.
3. Add a branch in `buildLanguageModel` (`src/modules/ai/lib/agent.ts:99`) that constructs the provider instance. For OpenAI-compatible APIs you can often reuse `createOpenAICompatible`.
4. If the provider requires an API key, update `providerNeedsKey` in `config.ts` and the keyring service mapping.
5. If it needs a dedicated `@ai-sdk/*` package, add it to `package.json` and justify the bundle cost (see `CONTRIBUTING.md`).
6. New built-ins must justify unique value beyond `openai-compatible` and OpenRouter; `CONTRIBUTING.md` calls this out explicitly.

Keys are never persisted outside the OS keychain, Linux Secret Service, or its private Linux fallback file.

## Agent run loop

`runAgentStream` (`agent.ts:391`):

1. Resolves the model via `buildConfiguredLanguageModel`.
2. Builds a stable system prompt from `selectSystemPrompt(modelId)` plus optional persona, custom instructions, and `VOKTTY.md` project memory.
3. Converts UI messages to model messages, prunes reasoning content if the model does not keep it, and compacts old messages if the context limit is exceeded.
4. Streams via `streamText` with the tool set from `buildTools(ctx)` and `stopWhen: stepCountIs(MAX_AGENT_STEPS)`.
5. Emits step labels, usage deltas, and finish metadata.

The tool set is assembled in `src/modules/ai/tools/tools.ts` from `fs`, `edit`, `search`, `shell`, `subagent`, `terminal`, `todo`, and `managedAgent` builders.

## Sub-agents

`src/modules/ai/agents/registry.ts` defines read-only sub-agents: `explore`, `code-review`, `security`, and `general`. Each has a whitelist of tools and its own system prompt. `run_subagent` cannot recurse (the subagent tool set excludes `run_subagent` itself).

## Sessions

Conversations are organized into sessions. Persistence lives in `voktty-ai-sessions.json` via `tauri-plugin-store` (`src/modules/ai/lib/sessions.ts`):

- `sessions` key: list of session metadata
- `activeId` key: active session id
- `messages:<id>` keys: per-session messages, loaded lazily

`AgentRunBridge` mirrors active-session messages to disk on every change and auto-derives titles from the first user message.

Runtime usage, progress, compaction notices, step limits and errors belong to the exact cached Chat object. Background callbacks update that conversation without notifying selected-chat readers; switching back restores its metadata. Deletion and LRU replacement reject callbacks from the former object even when its session ID is reused. The bridge qualifies lifecycle updates with its observed Chat, and read-only subagents publish progress through their original tool context. These in-memory receipts do not establish per-turn cancellation or background message persistence.

Each transport request also captures its call-family lifetime, abort signal and metadata callbacks. Only the latest current request publishes progress, child progress, compaction and step-limit notices; Stop, abort, supersession, completion and observed setup or stream failure retire that presentation. Reported late usage still adds to the original live Chat's totals without replacing the newest request's input and cache context indicators. Forget seals accounting as well. Child progress keeps the original tool context and approval registry rather than cloning their identities. These guards do not replace SDK message delivery or interrupt provider setup and native operations already admitted.

Main-agent preparation carries that same request predicate through model loading, history conversion and MCP discovery. It retains the original tool context, abort signal and call-family epoch, checks them after each await and after reentrant reconciliation, compaction and tool construction, and refuses to start `streamText` after retirement. A fresh turn can proceed while an older admitted preparation settles; completing the old work cannot revive it. Imports, discovery and provider work already admitted retain their existing cancellation and cleanup contracts. Callers without an explicit predicate still use their original signal and family lifetime.

### Long-conversation rendering

`AiChatView` keeps the canonical `UIMessage[]` intact but windows the rendered history after 24 messages, or after 60,000 characters when at least five messages exist. `@tanstack/react-virtual` measures each mounted message and keeps four items of overscan. Only messages near the viewport parse Markdown, mount tool cards or start code highlighting; the streaming trailing message remains live. Virtual rows expose their position and total through ARIA metadata, while selection, copy, approvals and keyboard interaction continue to use the normal message components.

Scroll position and bottom-lock are cached for the 20 most recently viewed sessions. Restoring a session happens before paint and is repeated on the next animation frame after virtual measurements settle. Historical tool and Markdown parts do not replay their entrance animation when remounted. Finalized highlighted code blocks use a 16-entry LRU cache and only cache source blocks up to 64 KiB.

The context indicator uses the append-only AI SDK invariant to update the trailing message's estimate in constant history time during streaming. Appends and trailing replacements inspect one message; compaction, deletion, reordering or a session change deliberately rebuild the estimate from the full canonical history.

## Composer

`AiComposerProvider` (`src/modules/ai/lib/composer.tsx`) is a React context that holds shared input state (text, attachments, voice) for the docked input bar and any other surface. Attachments can be images, text files, or `selection` chips from the terminal or editor. Selections are wrapped as `<selection source="terminal|editor">…</selection>` blocks at submit time and are not pasted into the textarea.

The composer derives `isBusy` from `agentMeta.status` so it can mount safely before sessions hydrate.

Composer submission, Stop, Continue and compaction dismissal retain their committed chat presentation and exact runtime when one exists. Selection changes, deletion, runtime replacement and unmount permanently retire old actions, including a selection round trip before React commits. Current presentations rearm independently. A deferred runtime import cannot create or send a retired conversation; Stop also retires that pending submission without disabling future actions. Duplicate submits coalesce per presentation, and at most 256 deferred or running submissions remain counted until their promises settle, including retired work. Draft cleanup preserves text and attachments changed during loading, and deferred submission focus is guarded and cancelled by its original presentation. These guards do not cancel an already admitted model request when the user merely changes views.

Voice capture retains its original chat presentation, provider settings, credentials and result callback before requesting microphone permission. Retirement disables delivery before stopping the captured recorder and tracks, so cleanup cannot upload an abandoned recording. Late permission results stop their own tracks without starting a recorder. Sixteen recording or transcription requests may remain admitted, including retired work until its promise settles; duplicate starts coalesce. Capture is limited to two minutes and 16 MiB of retained audio, with a 200,000-character transcript limit. Normal Stop finishes an active recording; retirement aborts browser recognition and passes cancellation through SDK, REST, response-body reads and WAV preparation. Whisper.cpp retains its loopback restriction. Transcript insertion and focus revalidate the original presentation. These are browser API and promise-lifetime guarantees, not OS-level microphone or provider termination acknowledgements; permission requests and already admitted provider work retain their platform cancellation behavior.

Browser file attachments capture the original chat presentation before Blob or FileReader reads. Selection round trips, runtime replacement and unmount permanently retire publication, including deferred React updates and cached picker callbacks. Sixteen unsettled batches share capacity until actual settlement, including retired reads. A batch accepts at most 32 files and 32 MiB of source bytes; individual images are limited to 16 MiB, and text to 200,000 bytes and decoded characters. Duplicate file identities are omitted within a batch and when adding to the draft. Failed reads publish no partial batch and expose no file content in diagnostics. Already admitted browser reads retain their platform completion behavior. Path-based native attachments and workspace file discovery retain their separate filesystem contracts.

The `@file` picker discovers files from the committed Explorer root and its explicit filesystem, independently of the selected global workspace, launch directory or active document. Missing filesystem metadata and unresolved project namespaces do not start IO. Local and Windows WSL sources use the native file index; SSH sources use the authenticated directory reader with bounded traversal. The shared index retains at most sixteen pending reads and sixteen cached scopes for sixty seconds, keys by complete filesystem identity, and counts up to 256 joined callers through settlement. Results contain at most 10,000 validated relative paths and 4 MiB of path characters; SSH traversal permits at most 256 directory reads and 20,000 directory entries. Source replacement suppresses old result publication. Guest collaboration search keeps its own protocol with sixteen unsettled searches. The picker retains its original chat and source presentation through selection, attachment reads and deferred focus. Explicit path attachments use the captured filesystem and a separate sixteen-read budget, reject text above 200,000 bytes or characters, and distinguish same-path files on different filesystems. Guest reads also retain capacity through settlement. These client guards do not cancel admitted native IO or authorize access.

Registered saved-profile SSH namespaces use the shared project file-source capture, also used by Explorer filename search. The picker subscribes to project and profile changes only while open and reads through its own project-document lease with `fs.glob`. The helper applies ignore and hidden-file rules and returns at most 2,000 relative file names with an explicit truncation flag; the client validates names and a 4 Mi-character aggregate bound. The saved namespace remains separate from the helper's accepted canonical root. Selection captures its own bounded receipt before closing the picker and retains the indexed project and profile through attachment reads and deferred focus, even when another registered project owns a nested folder. Profile or project replacement permanently retires old receipts, including round trips before React commits. At most sixteen selection receipts remain until read or focus settlement. Attachment delivery keeps canonical root, sensitive-path and size checks, with no local or legacy Host fallback. Unsupported helpers and unrepresentable namespace names remain unavailable. The citation descriptor does not widen the native AI tool or project-memory root contexts.

Explorer menus, internal path drags and OS drops attach through private synchronous request receipts carrying an explicit copied filesystem and the sender's original lifetime. The composer consumes each receipt once, rejects raw or replayed events, and retains its own original chat during reads and deferred state updates. Explorer menus retain the pointed context, consume their original opening and expose unsupported or changed targets with a reason. A pointer drag captures its filesystem, selection and move callback before moving; source replacement cancels it without adopting successor options. OS paths remain local independently of global workspace selection. HTML drops into composite slots capture the original chat, slot membership and caller before metadata reads, with sixteen pending requests counted through settlement. Callback republication and the drop's own focus change preserve that admission; context or chat replacement permanently retires it. Explorer's internal filename search captures its explicit native filesystem, bounds pending queries to sixteen, and resets results on source changes. Its Docker and serial filename-search adapters remain unavailable with a visible restriction rather than local fallback. Registered namespace path attachments capture their saved project and SSH profile before event dispatch or asynchronous work. Private immutable snapshots retain that binding through the composer and acquire an independent project-document lease. Literal and canonical secret paths, out-of-root targets and oversized text are rejected through the existing project-document reader, sharing the sixteen-read attachment budget through settlement. Failed or unresolved project reads never fall back locally. Canonical preflight and reads remain separate operations.

## Tools and approval

Tool definitions live under `src/modules/ai/tools/`:

- Read-only tools (`read_file`, `list_directory`, `grep`, `glob`) auto-execute after passing the security deny-list.
- Mutating tools (`write_file`, `edit`, `multi_edit`, `create_directory`, `bash_run`, `bash_background`) set `needsApproval: true`. The AI SDK pauses and the UI renders an approval card.
- `edit` / `multi_edit` enforce a read-before-edit invariant: the model must have read the file earlier in the session.
- In plan mode, mutating tools queue edits for batch review instead of applying them immediately.

Auto-send after approval uses `lastAssistantMessageIsCompleteWithApprovalResponses`.

The eight filesystem tools (`read_file`, `list_directory`, `write_file`, `create_directory`, `edit`, `multi_edit`, `grep`, `glob`) capture the source directory, compatible Explorer boundary, filesystem, plan mode and provenance when the SDK accepts their normalized input. Their runtime receipts survive tool reconstruction. Mutations additionally bind the SDK approval ID through the stream transform; a missing runtime capture, changed input or tool, mismatched approval, or ambiguous reused provider ID cannot execute. Source and boundary must refer to the same filesystem; SSH helpers may have different roots or native session IDs when their saved connection and authentication binding match. Canonical checks and IO still use the original source's own helper and native authorization.

Each chat and its read-only subagents share limits of 256 unsettled calls and 8 Mi characters of serialized captures, including the two approved shell tools described below. Each input or target is capped at 1 Mi characters, 20,000 nodes and depth 16. Up to 256 preview readers remain admitted until settlement. Cancellation retires authority immediately, while actual reads, writes and shell requests retain their budget through promise settlement. Subagents have independent provider-call namespaces and snapshot file context before model setup. These are JavaScript ownership and admission guarantees, not native IO cancellation or rollback of an already admitted operation. Project-memory consumers retain their separate routing contracts.

Search defaults to the captured workspace boundary and resolves an explicit relative root from its captured source directory. Canonical checks and the query use that same filesystem, with caller retirement checked between stages. Native search clients accept explicit local and WSL roots and preserve host-native Windows and UNC roots. SSH host paths use the original authenticated helper session through `fs.grepIndependent` and `fs.glob`, with a root-relative directory and literal POSIX names. The client validates result paths, locations, requested hit limits and the 4 MiB response bound. Missing methods or remote failures never fall back to local or interactive search. Unresolved project namespaces and other unsupported transports remain unavailable.

The remote helper separately advertises `fs.grepIndependent` and `fs.glob`. Both require a handshake, constrain the canonical search directory to the authenticated root and return paths relative to that search directory. They retain at most eight jobs through response delivery, cap parameters at 256 KiB and results at 2,000 hits within a conservative 4 MiB JSON result budget, and check a 30-second deadline between filesystem operations. Each independent grep uses at most two traversal workers and never joins the interactive search's cancellation generation. Glob enumerates regular files, including empty and binary files, without following symlinks. Both honor hidden-file and ignore rules; budget expiry rejects partial results. These deadlines do not interrupt a blocked OS filesystem call.

Every runtime Chat's `stop` retires that exact chat's file-call family synchronously before delegating to SDK cancellation, including direct composer and hook calls. A subagent receives its parent tool's abort signal, retires its own namespace on abort and checks cancellation and family ownership around model setup, step publication and completion. Finishing or cancelling a child permanently seals that child namespace while its parent and siblings remain usable. Its listener is removed on settlement, and already admitted file IO retains the shared budget until it physically settles.

Native one-shot, persistent-session and background shell clients accept an explicit workspace independently of the selected environment. Their current execution backend supports local workspaces and WSL on Windows; SSH, Docker, serial and unresolved project namespaces reject before IPC rather than starting a local shell. Callers without an explicit workspace retain selection-based routing for supported transports.

`bash_run` and `bash_background` capture their chat, source directory and filesystem when normalized input arrives, using the same runtime receipts, approval binding and retirement as file tools. Approval after a selection change or tool reconstruction executes only that original input and destination; restored or mismatched approvals fail closed. An explicit relative background cwd resolves from the captured directory. Foreground commands serialize within each original chat runtime, filesystem and source directory, rechecking authority after shell opening and queue waits. Their lazy native cwd-state cache retains at most 256 entries, including pending opens, and drops a rejected opening by exact identity so it can be retried. Different sources never borrow one another's cwd state. Stop preserves that runtime's cwd metadata. Forgetting a runtime, including LRU eviction and session deletion, permanently seals its call family and shell owner before cleanup callbacks. Captured metadata closes only after its original opening and admitted queue settle; capacity remains reserved until the native close succeeds. Failed closes retain their exact IDs for retry on later shell admission. Pending unrelated cleanup does not block available capacity, and a caller waiting for capacity revalidates its original authority. Native session close removes cwd metadata rather than killing an OS process; these receipts do not acknowledge process-tree termination. Cancellation prevents later stages and publication but does not roll back an already admitted command or terminate an admitted background process. Background list, log and kill tools retain their existing app-wide handle contract.

Shell approval cards read their original conversation's runtime capture without creating a chat or issuing filesystem IO. They show its source directory and filesystem identity without authentication configuration; the source is not a claim about the persistent shell's current cwd. Missing or retired captures disable Allow, and delivery rechecks the original chat and observation. Effect-owned metadata observations share the 256-preview budget and release on unmount or retirement. Retirement notifies each observation once without interrupting sibling delivery if a presentation callback fails. Direct SDK approval denial retires only that chat's matching captured cohort synchronously, even while another approval is pending; native work already running keeps its budget until settlement. Positive responses preserve their normal approval path.

Read-before-edit facts are keyed by the complete captured filesystem. Plan entries retain their original filesystem, mode, session and model even if selection changes while approval is pending. Restored approvals without their original in-memory receipt fail closed.

## Edit diffs

AI-proposed file edits open in an `ai-diff` tab. The user accepts or rejects per hunk. Only after acceptance does the `write_file` or `edit` tool actually run. This keeps the approval UI decoupled from the tool execution.

File review reads the same captured destination under canonical path and workspace checks. Retired, denied and unmounted readers cannot publish a late review; ordinary text streaming does not restart an admitted read. Review tabs retain their filesystem and originating chat session, show the destination beside the path and route approval to that original chat rather than the currently selected session. Missing original runtimes never fall back to another chat. Review labels display connection identity without authentication configuration.

Review deduplication, status updates and completion use both the originating chat session and approval ID. An unqualified legacy review cannot match a session-owned review. Direct tool denial or failure closes only the original review; if it is the sole tab in its workspace, it remains visible with its rejected status instead of being marked approved.

## Live context bridge

Before project-memory IO, the chat transport captures its explicit file-root descriptor, request configuration and call-family lifetime. VOKTTY.md and its legacy fallback use that original filesystem for canonicalization and reads, with no ambient-root fallback. Literal and canonical secret paths, out-of-root targets and unverifiable canonical paths are skipped. Separate canonical preflight and reads are not atomic against concurrent filesystem replacement. Memory keeps at most 32 LRU snapshots for 30 seconds, keyed by the complete filesystem identity, with a 32,768 UTF-16-character content limit and no split surrogate pair. At most 16 loads remain admitted, including cancelled loads until their IO settles; older completions cannot replace newer cache publications. Stop, forget or abort prevents subsequent fallback, cache publication and model startup from a retired memory read. Missing explicit roots and unsupported project namespaces contribute no memory. Native file-read size limits remain unchanged.

`App.tsx` calls `setLive({ getCwd, getTerminalContext, … })` so tools can read the currently active terminal's cwd and the last 300 lines of buffer. It is lazy by design - tools call for it only when needed rather than pre-snapshotting every turn.

The desktop bridge also exposes optional `getFileContext` on `Live` and `ToolContext`. It returns a detached `{directory, workspace}` from the committed active surface, using an editor's own containing directory or a terminal's runtime filesystem rather than another tab or the ambient workspace. Legacy documents remain local, and native Windows documents retain local ownership. Missing targets, unresolved project namespaces, private or collaborative terminals and unsupported filesystem transports return no context. Unmount retires this getter; reading it opens no filesystem or process resource. The directory is source metadata, not a workspace authorization grant or a project-root boundary. Consumers must retain their own per-call capture across approval and asynchronous stages; the getter does not itself bind legacy tool execution or its independent project-root getter.

The separate optional `getFileRootContext` returns a detached `{root, workspace}` from the committed Explorer source supplied by the desktop. A missing explicit root or filesystem returns no boundary rather than borrowing the active document's filesystem or a launch-directory fallback. Source and boundary may belong to different filesystems even when their path strings match. Both getters retire with their original bridge publication, including discarded StrictMode mounts. They are metadata channels: consumers still need per-call capture, filesystem compatibility checks, canonical path checks and native authorization before IO. Legacy `getWorkspaceRoot` behavior is unchanged.

## Invariants

- Keep the Vercel AI SDK v6 chat shape (`streamText`, tools, step limits); the rest of the UI depends on it.
- Keys only via `secrets_*` commands; never disk, settings store, or `localStorage`.
- New providers must justify their bundle cost and unique value.
- Mutating tools require approval; read-only tools still pass the deny-list.
- Keep long histories windowed by message. Do not restore eager Markdown parsing or full-history token scans on every streamed chunk.

## See also

- [`VOKTTY.md`](https://github.com/voktty/voktty/blob/main/VOKTTY.md) - the architecture source of truth
- [`docs/README.md`](../README.md) - index of contributor guides
- [Two-process model](two-process-model.md) - IPC boundary and command catalog
- [Security model](security-model.md) - the boundaries every tool must respect
