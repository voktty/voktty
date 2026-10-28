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
Project observation is not started at startup or exposed through IPC, CLI or the
common memory panel. Its owner must
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
`src-tauri/crates/voktty-memory-local/README.md`. The worker checks its application
ancestor chain through captured handles, including controlled ownership and
permissions. Apple extended allow ACLs remain unsupported instead of being
mistaken for private mode bits. Permission checks are point-in-time observations.

Explicit initialization can create missing native app-directory suffixes after
verifying that chain. It never overwrites existing entries or repairs permissions.
Ordinary open stays noncreating. Presentation/IPC wiring, narrow project-ancestor consent,
publication workers and platform runtime qualification remain pending. This
module still starts no filesystem work automatically.

`NativeMemoryOwners` provides the native lifecycle registry for future panel
integration. It retains at most 64 windows and 256 presentations across those
windows. Native-only weak receipts bind both levels by identity; labels are
bounded to 128 ASCII bytes. Registering a replacement window retires every old
presentation, and stale cleanup cannot remove its successor. Presentations cannot
be accessed through a different window or registry. Closing a presentation,
retiring its window or dropping the registry retires its selected read authority.
Capacity rejection never evicts another owner. Removing an owner releases its
registry slot, while admitted workers retain their separate global budget until
actual settlement. Read-only selection access cannot transfer or mutate ownership.
The caller must retain the original native window receipt for destruction and
recheck the selected receipt immediately before publication. The registry does
not authenticate IPC caller identities, grant IO, create storage or start discovery.

`NativeMemoryApplication` is managed during Tauri setup and captures the native
storage origin without filesystem IO. The main window receives a typed
`NativeMemoryWindow` resource in its own resource table. That table's identity
matters: Tauri's window equality compares labels only. The native destruction
listener retains the original resource; only `Destroyed` retires its authority,
so close requests, hide-to-tray and cancelled close retain their presentations.
Resource close and final drop also retire that exact owner. Application exit
permanently shuts down its registry before other subsystem cleanup. Foreign
application resources and stale window receipts cannot admit work. Cleanup
recovers a poisoned ownership lock to retire existing authority, while ordinary
admission rejects poisoned locks. No ownership lock spans an await.

Explicit storage operations validate the captured window before worker admission
and after settlement, preserving noncreating open and explicit initialization.
Retirement suppresses delivery without rolling back admitted writes or releasing
the native worker budget early. Native selection and discovery delegate to the
existing authority checks. Window attachment belongs to native window creation,
once per instance; future windows must attach their own resource. Settings and
quick-composer windows are not memory presentations. No memory commands are
registered for IPC yet, no resource IDs are delivered to JavaScript, and the
common panel, initialization publication and CLI remain pending.
