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

Private-state bootstrap, narrow ancestor consent, publication workers and platform
runtime qualification remain pending.
