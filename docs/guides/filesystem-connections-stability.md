# Filesystem and connection stability

Voktty keeps the identity of an open document separate from the currently focused terminal. A document opened from Windows, a mapped drive, UNC, WSL or SSH continues to use that same filesystem for reads, saves, reloads and metadata even after another workspace becomes active.

## Explorer behavior

The explorer belongs to the workspace, not to the active editor tab. Switching between files does not move the root, rebuild the tree or start another watcher. Use **Reveal in Explorer** when you deliberately want to navigate to a file outside the current root. A workspace without an explicit root or useful terminal starts at the user's home directory.

UNC paths and mapped network drives remain Windows filesystems. Their blocking I/O runs outside async runtime workers, uses a separate concurrency budget and has visible slow/offline/error states. Network watchers are disabled by default because a disconnected share must not stall local editors.

## Terminal launch directory

A new native terminal resolves a usable directory before creating its process. Missing, empty, inaccessible or implicitly inherited Windows system directories fall back to the user's home. An explicit user-selected directory remains authoritative.

## Connection lifecycle

Asynchronous resources use the same visible lifecycle: `connecting`, `ready`, `error`, `cancelling` and `disconnected`. SSH, WSL, Docker and serial terminals only report success after the PTY confirms readiness. Closing one remote tab releases only that resource and moves focus to a surviving tab or workspace.

MCP and collaboration use the same lifecycle vocabulary at their own server/session boundary; they do not masquerade as terminal workspaces.

## Long AI conversations

Long histories preserve the complete canonical conversation while rendering only messages near the viewport. Scroll and bottom-lock are restored per session, historical messages do not replay entrance animations, finalized code highlighting is cached within a fixed budget, and token estimates update only the trailing streamed message when possible.

Browser/WebView text search cannot find an unmounted virtual row. A future whole-conversation search must query the canonical message history instead of relying on the DOM.

## Release smoke checklist

Run the automated suites first, then use a native Tauri build for the transport-specific checks:

1. Open and alternate several local, mapped-drive and UNC files; disconnect or delay the share and confirm local editors remain responsive.
2. Open an associated file both cold and while Voktty is running; confirm deduplication, second-instance routing and clean restoration.
3. Start a native terminal from a shell whose current directory is `System32`; confirm the prompt starts in the user home unless a directory was explicitly requested.
4. Connect WSL, Docker and SSH; confirm progress, ready, failure, retry and cancellation feedback.
5. Close the last remote tab in both the active and a background workspace; confirm unrelated tabs stay visible and alive.
6. Switch repeatedly between a long AI conversation and other tabs; confirm stable scroll, no full-history entrance animation and responsive streaming/tool approvals.

Do not disable Windows Attachment Manager or zone checks to make a test pass. A security prompt shown before Voktty receives its launch request is external to the application and must be recorded separately from Voktty's own open latency.
