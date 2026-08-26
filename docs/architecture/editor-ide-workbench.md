# Editor IDE workbench

## Status

Accepted. Implementation is incremental and tracked in `PROMPTS/planes/PLAN_EDITOR_IDE_AGENTICO.md`.

## Context

Voktty already has a capable CodeMirror 6 editor, lazy language support, LSP sessions, diagnostics, formatters, AI inline completion and reversible AI diff tabs. The missing capability is the IDE workbench around the text surface: discoverable commands, project navigation, persistent search, symbol views, Problems, workspace edits, editor groups, tasks, tests and debugging.

Replacing CodeMirror with Monaco would rewrite stable editor behavior while leaving most workbench requirements unsolved. It would also increase bundle size and couple Voktty to a heavier runtime.

## Decision

Voktty keeps CodeMirror 6 and builds a modular workbench around it.

The editor is separated into these responsibilities:

- Editor surface: CodeMirror state, extensions, selections and document lifecycle.
- Workbench services: commands, navigation history, search results, symbols, diagnostics and editor groups.
- Native host: authorized filesystem access, process lifecycle, tasks, tests and future DAP sessions.
- Agent runtime: deterministic context assembly, patch generation, approval, execution and rollback.

`EditorPane` remains an imperative shell. New logic belongs in dependency-light helpers, stores and services under `src/modules/editor/lib/` or in a dedicated workbench module when it spans multiple editor panes.

## Model roles

Voktty has two configured model roles and IDE features must respect them:

- Active model: reasoning, explanation, quick fixes, inline refactoring, planning and multi-file edits.
- Autocomplete model: low-latency ghost completion and future local live correction.

Features use these roles rather than choosing a hidden model. A new setting is justified only when the feature requires a distinct latency, quality or cost policy that cannot be represented by the two existing roles.

Predictive block completion is an editor behavior, not a floating action menu. It extends the existing multiline ghost pipeline with bounded context from the current logical block, nearby symbols and diagnostics. The autocomplete model proposes the continuation and supports full, partial or rejected acceptance. Selecting code exposes only Ask and Edit: Ask hands context to the active model in chat, while Edit opens an instruction-driven inline transformation with that same active model.

Autocomplete is multiprovider by contract. Provider adapters select protocol-safe reasoning options and at most one same-model recovery attempt. Settings exercises the real completion path and named OpenAI-compatible endpoints can select an explicit protocol profile. Ollama and LM Studio capability discovery is explicit, cached and absent from the typing hot path. Repeated failures pause automatic requests without disabling CodeMirror or changing provider. [ADR-006](adr-006-multiprovider-ai-completion.md) records the policy.

## State and performance

Editor status is keyed by tab id because two tabs may show the same path independently. Cursor updates are published to a narrow Zustand store so only the status surface rerenders. Background editor panes remain mounted but do not force `App` to rerender on cursor movement.

Search, LSP extensions, debugger adapters and agent context collectors must be lazy. Disabled capabilities perform no workspace scan, process spawn or provider request. The existing 4 MiB syntax and LSP threshold and file size caps remain authoritative.

## Quick Open

`Ctrl+P` opens the workspace file picker. Its index is built only while the dialog is open, cached briefly per workspace and visibility preference, and capped at 10,000 files with the same ignored-directory policy used by the explorer. Local and WSL workspaces use `fs_list_files`; SSH workspaces traverse the existing authenticated remote filesystem channel with bounded concurrency. Serial and Docker workspaces expose an explicit unavailable state until they have a filesystem contract.

Ranking is a dependency-light function. Filename matches outrank incidental directory matches, while an empty query places the workspace-scoped MRU first. Enter opens a transient preview tab and Mod+Enter pins the file. The previous tab launchpad remains available as a separate command and has no reserved default shortcut.

The dialog and indexer are lazy-loaded. Merely starting Voktty or opening an editor does not scan the workspace or load the Quick Open interface.

## Remote media preview

Known image, video, audio and PDF extensions in an SSH workspace are classified from metadata before the editor attempts a UTF-8 read. `voktty-remote` exposes the authenticated `fs.readBinaryFile` capability and returns exact bytes as Base64. The helper canonicalizes the requested path inside the authorized workspace root, accepts regular files only and rejects decoded payloads above 32 MiB. The Base64 envelope therefore remains below the protocol's 64 MiB frame limit.

Unknown extensions still use the text path first. A structured `binary_file` response switches the document to binary preview instead of exposing the UTF-8 failure as an editor error. Media rendering remains local to each Voktty webview; the SSH host never decides viewport size, zoom or playback controls.

## Workspace search

Mod+Shift+F opens a persistent sidebar search surface. Query state, include and exclude filters, regex, case-sensitive and whole-word modes remain mounted while the user moves between Explorer, Search and Source Control. Hiding Search makes it inert: the frontend cancels the active request and the backend uses a generation counter to stop superseded filesystem walks.

Local and WSL workspaces call `fs_grep_workspace`. SSH workspaces call the `fs.grep` capability in `voktty-remote`; the helper processes search on a worker thread so PTY traffic, filesystem watches and cancellation frames remain responsive. Both implementations respect ignore files, do not follow symbolic links, skip binary files, cap each searched file at 5 MiB and hard-cap a response at 2,000 hits. Include and exclude globs operate on canonical paths relative to the workspace root.

Every hit carries an exact one-based UTF-16 line/column range for CodeMirror navigation plus a separately indexed, bounded preview. This avoids transporting an unbounded minified line without sacrificing cursor accuracy. A single click opens a transient preview tab; Mod+Click, Mod+Enter or double-click pins it.

Global replacement is a separate preview-first transaction. A shared Rust crate computes literal and regular-expression replacements for local, WSL and SSH workspaces. Preview records the expected `mtime`, SHA-256 content hash and replacement count for each file. Commit validates every target before writing, repeats validation immediately before each atomic write and rolls earlier files back if a later write fails. Rollback refuses to overwrite a third-party change made after Voktty wrote the file. Open files with unsaved changes and truncated search result sets block replacement.

The release pipeline builds the Linux x86_64 musl remote helper once and injects that artifact into every desktop bundle. Linux ARM64 remote hosts remain unsupported until an ARM64 helper artifact is added and qualified.

## Navigation history and symbols

Workbench jumps use one canonical location contract: workspace space, canonical path, one-based line and one-based UTF-16 column. Quick Open, workspace search, command-palette content results, Outline and LSP definition/reference navigation all pass through the same opener. This lets Back and Forward restore both the file and the precise cursor position, including jumps between spaces. Consecutive duplicate locations are collapsed, a new jump after Back truncates the forward branch and history is bounded to 100 entries.

The navigation core in `editor/lib/navigationHistory.ts` is pure and independent from React. `App` owns the cross-tab history and delegates the final file open to the existing tab service. CodeMirror remains responsible for local edit undo/redo and does not duplicate the workbench history.

Outline is a lazy sidebar surface with two modes:

- Document symbols prefer hierarchical `textDocument/documentSymbol` results. Without an active language server, a bounded local parser recognizes common declarations in TypeScript/JavaScript, Python, Rust, Go, PHP and Markdown headings.
- Workspace symbols use `workspace/symbol`, remain unavailable without a capable active server and cap normalized results at 500 entries.

Both hierarchical `DocumentSymbol` and flat `SymbolInformation` responses normalize to the same dependency-light `IdeSymbol` shape. Symbol clicks return through the canonical opener. The LSP client stays behind a dynamic import, so opening Voktty or using the fallback Outline does not make the language-server client eager.

## Workspace Problems

Detailed diagnostics belong to the LSP session that published them, not to a mounted CodeMirror view. `VokttyLspClient` intercepts `textDocument/publishDiagnostics`, normalizes its zero-based UTF-16 ranges and publishes a replace-by-document batch identified by the session key. Closing or crashing that session clears every batch it owns.

The Problems rail badge and lazy panel aggregate only paths contained by the active workspace. The panel groups by file, filters by severity or text and routes every result through the canonical workbench opener. Current-file diagnostic counts remain a narrow store for the status bar; they do not own the detailed workspace collection.

Memory and rendering are bounded to 1,000 diagnostics per document, 500 documents per LSP owner and 500 rendered rows after filtering. An empty diagnostic publication removes the previous document batch. No server process, workspace scan or Problems component is loaded merely because the rail exists. The ownership decision is recorded in [ADR-003](adr-003-lsp-diagnostics-ownership.md).

## Code actions and signature help

`Alt+Enter` is a native-first decision point. The active LSP session receives the exact bounded diagnostics that overlap the selection or cursor line. Responses are normalized, capped at 100 actions and shown in a keyboard-accessible CodeMirror tooltip. Preferred actions sort first; the configured active AI model is an explicit fallback rather than a hidden replacement for language-server fixes.

Direct application is deliberately narrow. A `WorkspaceEdit` may change the current CodeMirror document only when every range is valid, edits do not overlap, inserted content remains within limits and the document still has the same immutable snapshot used by the request. Multi-document code actions, resource operations and server commands remain exposed as unavailable with a reason until each action class is routed through the shared transaction instead of bypassing workbench authorization.

Signature help uses the server's declared trigger and retrigger characters and can also be requested explicitly. Responses cap overloads, parameter counts, labels and documentation. Server documentation is inserted as text, never HTML. Requests are generation-checked against the document snapshot and cursor so a late response cannot reopen stale information.

The action menu, signature tooltip and LSP client remain inside the existing lazy LSP chunk. Without an active session they cause no request, process spawn or eager dependency.

## Symbol rename and structural workspace edits

`F2` uses `textDocument/prepareRename` when available and opens a keyboard-accessible input beside the symbol. Enter requests `textDocument/rename`, but the response is never applied by the CodeMirror integration. Voktty normalizes both `changes` and `documentChanges`, rejects non-file URI, paths outside the language-server root and resource operations, and opens a lazy multi-file review.

The shared `voktty-workspace-edit` crate applies LSP ranges as zero-based UTF-16 positions. It rejects invalid lines, columns that split surrogate pairs, inverted ranges and overlaps. Preview and commit use the same structural edits and enforce 200 files, 5,000 edits, 5 MiB per file and 32 MiB per transaction.

Commit is transactional across selected files. It binds the preview to `mtime`, source SHA-256, proposed-result SHA-256 and edit count, validates the complete set before writing, repeats validation before each atomic write and rolls prior files back if a later write fails. A third-party change made after Voktty writes is never overwritten during rollback. Any affected open buffer with unsaved changes blocks preview and commit. [ADR-004](adr-004-lsp-workspace-edit-transactions.md) records the decision.

## Semantic navigation and presentation

Definition, type definition, implementation and reference requests normalize `Location` and `LocationLink` payloads through one validated contract. Invalid siblings are discarded, exact URI/line/column duplicates collapse and results cap at 1,000 locations. Single results navigate directly; multiple results use the keyboard-accessible location picker. Every successful jump enters the shared workbench history.

Peek Definition and Peek References reuse that query contract without navigating. React owns a lazy read-only CodeMirror panel per editor tab, while the LSP extension only returns validated file locations and opens an explicitly selected result through the canonical navigator. Peek References caps its rendered list at 500 locations. Preview reads cap files at 2 MiB, cache at most four files and parse an excerpt of 30 lines before and 60 lines after the target, bounded to 256 KiB. The active document comes from the current CodeMirror buffer. Selection changes cancel stale file reads, edits close the panel and opening a result records normal workbench history.

Semantic tokens and inlay hints are capability-gated extensions inside the lazy LSP chunk. Semantic highlighting requests a bounded full response after document inactivity, decodes relative UTF-16 positions and maps server token types to the active CodeMirror `HighlightStyle` rather than defining a competing color palette. Theme changes regenerate semantic marks. Inlay hints request only the visible viewport plus a 20-line margin and render at most 500 normalized plain-text widgets.

Both features are independently configurable. A disabled feature mounts no extension and performs no request. Each response is bound to a generation and immutable document snapshot so edits, scrolling or extension replacement invalidate stale work. [ADR-005](adr-005-lsp-semantic-presentation.md) records the limits and rejected alternatives.

## Advanced editing and editor groups

Predictive completion extends the existing ghost pipeline without introducing another provider role. Each request receives only a 20,000-character window around the cursor, the enclosing logical block, bounded neighboring code, the current symbol and up to six nearby diagnostics. The autocomplete model owns these predictions. Tab accepts the complete proposal, Mod+ArrowRight accepts one token, Mod+Shift+ArrowRight accepts one line and Escape dismisses it. The same operations are available from the command palette.

CodeMirror owns multicursor, line movement and line duplication commands. Voktty adds discoverable palette actions and retains syntax-aware selection expansion. Built-in snippets use CodeMirror snippet fields, while indentation guides render only visible lines and sticky scroll walks only syntax ancestors at the viewport boundary. Structural helpers are not mounted for files over the 4 MiB syntax threshold.

Editor groups deliberately do not reuse terminal `PaneNode`. `EditorStack` owns a small binary tree per space whose leaves reference existing editor tab ids. A split creates an empty active group; selecting or opening another file assigns that tab to the group and removes any previous assignment of the same tab. This preserves one mounted CodeMirror buffer per tab and avoids divergent copies of a file. Group count is capped at four.

View restoration stores only selection anchors and numeric scroll offsets, keyed by canonical space and path in `voktty-editor-view-state.json` and bounded to 500 recent entries. Workbench navigation stores at most 100 canonical locations in `voktty-editor-navigation.json`. Neither store contains file content. The recently closed editor stack is memory-only, bounded to 20 entries and reopens through `openFileTab` so normal deduplication and workspace ownership remain authoritative.

## Agent safety

Agentic editing follows a preview-first transaction:

1. Collect bounded, authorized context.
2. Produce a plan and proposed patches.
3. Show a diff grouped by file and hunk.
4. Apply only approved changes with expected file versions.
5. Run approved validation commands.
6. Preserve an operation-level rollback and audit record.

The filesystem secret deny-list applies to both context reads and proposed writes. Workspace authorization, command approval, cancellation and timeouts remain mandatory.

## Tasks, tests, debugging and extensions

The Run and Debug activity surface is lazy. Opening it discovers bounded tasks from `package.json`, `Cargo.toml` and `.voktty/tasks.json`. It does not scan or spawn anything while hidden. Task and test execution reuse the authorized background-shell host, keep at most 1 MiB of frontend output and remain cancelable. A workspace change terminates an active task before clearing its output, so runs cannot leak across environment scopes. Test output is normalized into a bounded explorer for Vitest and Rust test lines without replacing the raw log.

DAP is a separate native stdio host rather than an LSP variation. Rust validates the workspace cwd, caps commands, frames, pending messages and stderr, owns process-tree termination and rejects SSH or Docker workspaces until those environments expose an equivalent bidirectional adapter transport. The lazy frontend performs initialize, launch or attach, breakpoint synchronization and configuration completion, then requests threads, stack frames, scopes and variables on stop events. CodeMirror exposes breakpoint toggles in a dedicated gutter. Adapter stderr and console output stay bounded. Initialization failure and workspace changes stop the native process tree instead of leaving a detached adapter.

The extension API keeps disposable registries for commands, panels, CodeMirror languages and agent tools. Panel mounts run only while selected. Language loaders run only when a matching file is resolved. Agent tools are added to each new AI run without overriding built-in tools; every extension tool requires approval, receives the agent cancellation signal and has bounded arguments, output and execution time. Extension manifests are capped at 512 KiB; entry files must resolve inside `~/.voktty/extensions` and remain below 2 MiB.

## Trade-offs

Keeping CodeMirror avoids a large migration and preserves current editor behavior. The accepted cost is that Voktty must implement workbench services instead of inheriting Monaco-specific APIs. This is preferable because Monaco alone does not provide the surrounding IDE shell and would not remove the need for Voktty-specific native, terminal and agent integrations.

## Revisit triggers

Reconsider the editor core only if CodeMirror cannot support a required accessibility, semantic rendering or large-file invariant after a measured prototype. Visual similarity to another IDE is not a sufficient trigger.
