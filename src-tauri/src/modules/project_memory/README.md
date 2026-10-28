# Native project memory authority

`NativeMemorySource::capture` binds an owned, local read source to a bounded
snapshot of the actual `WorkspaceRegistry`. It never registers a requested path,
resolves a remote environment or performs project IO. Only explicit `Local`
environments are accepted. Snapshots admit at most 256 roots and 1 MiB of encoded
path bytes; requests admit 4096 UTF-8 bytes and 128 components. Invalid or
unavailable authorization fails closed.

Metadata and enumeration permissions do not grant content reads. Workspace roots
and content also pass the lexical secret-path policy shared with TypeScript in
`src/lib/pathSafetyRules.json`. Both implementations exercise the same explicit
conformance cases. These lexical rules supplement native canonical-path and
handle checks; they do not provide filesystem authorization by themselves.
Windows authorization preserves case to avoid widening grants in case-sensitive
directories. The native reader rejects unsupported namespaces and network drives.

Scope and context operations use the bounded `MemoryWorkers` executor with owned
store, path, authority and controls. Dropping a source permanently retires its
reads, including completed results awaiting delivery. A new source cannot revive
them. Captured grants never widen when the registry changes. Retirement is
cooperative and does not acknowledge cancellation of a blocked OS call.

This Rust-only foundation grants no writes, instruction trust or session consent.
It is not wired to startup, IPC, CLI or the common memory panel. Its owner must
qualify the local filesystem and retire sources when selection changes; a local
environment descriptor alone does not prove filesystem or transport ownership.
Ancestor discovery outside captured roots remains incomplete until an explicit
native grant exists. Never automatically authorize the filesystem root to make
initialization succeed. Future registry revocation must retire captured sources.

`NativeMemorySelection` owns one source per native presentation. Each explicit
selection replaces its authority before capturing the new destination, including
failed or unsupported selections. Native-only weak receipts identify the exact
selection, not its path. Returning to the same path cannot revive a receipt, and
another presentation cannot borrow or clear it. Exact receipt checks precede
worker admission; replacement, clearing or owner disposal retires admitted reads
through the source's existing settlement guard. Worker capacity remains charged
until actual settlement. Receipts do not retain registry snapshots or sources.
Callers must recheck `is_current` immediately before publishing a previously
returned observation; successful `finish` only validates its own delivery point.
Selection mutation is synchronous and requires exclusive owner access, with no
lock held across worker awaits. No native presentation is wired to this owner yet.

`NativeMemoryStorage::capture` obtains only Tauri's native `app_local_data_dir`
path, without IO or a project/cwd fallback. Its `open` and explicit `initialize`
operations run through `MemoryWorkers::store`, sharing the four-slot budget and
the original deadline through actual settlement. Opening existing state creates
neither directory nor identity. Initialization creates the fixed private child
and UUID, never a kit or workspace, instruction or session grant. Corrupt state
is preserved. Retirement can suppress delivery without rolling back an already
admitted initialization. A queued cancelled operation cannot start its IO.

The private directory helpers inspect actual filesystem metadata and permissions.
Unix requires native ownership, no shared writes, a private child and a recognized
local filesystem. Windows uses a separate `READ_CONTROL` handle to inspect owner
and DACLs without expanding project-read access. Broader or unavailable grants
fail without permission repair. The complete rules and platform limits live in
`src-tauri/crates/voktty-memory-local/README.md`. Ancestors must remain controlled
by the application; these checks do not audit their complete ownership/ACL chain.

The native app parent must already exist. Creating that origin, owning the
service in the application, presentation/IPC wiring, narrow ancestor consent,
publication workers and platform runtime qualification remain pending. This
module still starts no work automatically.
