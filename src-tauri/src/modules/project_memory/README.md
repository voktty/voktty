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
Project observation is not started at startup. Its owner must
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
lock held across worker awaits. IPC presentations delegate to this owner.

## Selection-owned deployment reviews

Each `NativeMemorySelection` retains at most one reserved, opening, ready or
consumed review. `prepare_preview` uses the current selection as its origin and captures
the explicit destination's local read authority from the actual registry. It
never registers paths or accepts a caller-supplied origin. A new review retires
the previous one before destination validation or worker admission, including
unsupported destinations and invalid inputs. A stale selection cannot retire
another selection's review. Preparation uses the shared four-slot native worker
budget and returns a noncloneable prepared artifact with its original identity.

`reserve_preview` separates ownership admission from filesystem work. It captures
the destination, native read authority and original request control and retires
the previous review before opening private state. `start_preview` accepts only
that exact reservation once, together with the captured values and native store;
it cannot replace the destination, authorization snapshot or deadline after an
await. The existing `prepare_preview` convenience method performs both phases
when the caller already owns its store. Reservations grant neither a ready plan
nor publication permission, and expired requests cannot renew their deadline.

`NativeMemoryPreviewRead::receipt` exposes only a weak native identity, so an
opening request can be cancelled without borrowing a later review. Opening
receipts cannot read a ready plan or admit publication. `accept_preview` stores
only the matching original opening's completed artifact; it grants no instruction
trust, session consent or write permission. Plans remain immutable. Review and
selection receipts are native-only and cannot be constructed by deserialization.

`publish_preview` consumes a ready plan once, before worker admission. Failed
admission or publication never restores acceptance. It requires an independent,
qualified native `MemoryWriteAccess`; read authority never manufactures writes.
The native command integration still needs its purpose-bound write factory.
The worker uses the exact original preview, read authorities and review deadline.
Publication has its own bounded request control; the completed preparation's
response deadline does not shorten or renew the manual review's two-minute life.

New selection, failed selection, clearing, owner disposal or another review
permanently retires the old review and requests cooperative cancellation of its
current phase. Its destination source retires with it. Preparation and publication
results recheck the original review, origin and destination after awaiting.
Cancelled delivery does not roll back files or acknowledge a blocked filesystem
call. Partial reports and the private recovery intent retain their existing
semantics. Native worker slots and publication locks remain held through physical
IO settlement even when the owner has already retired.

Callers must recheck `is_preview_current` immediately before delivering an
already returned result. That check describes lifetime only: a consumed review
can still identify its in-flight result but cannot publish again. Exact
`cancel_preview` cleanup can release it afterward without touching a replacement.
No mutation lock spans an await. Registry limits still bound containing owners;
there is no review history, background timer, implicit deployment or AI launch.
IPC and narrow ancestor consent remain pending.
Linux tests exercise the real native workers and filesystem. Other native runtime
qualification remains pending.

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
Ordinary open stays noncreating. Kit deployment UI, narrow project-ancestor consent,
publication commands and platform runtime qualification remain pending. This
module still starts no filesystem work automatically.

`NativeMemoryOwners` provides the native lifecycle registry for panel
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
quick-composer windows are not memory presentations. User-facing initialization
publication and CLI remain pending.

## Window-owned review operations

`NativeMemoryOwners` and `NativeMemoryApplication` forward review reservation,
preparation, adoption, inspection, cancellation and publication only under their
exact window, presentation, selection and review receipts. Application identity
is also checked; matching window labels or resource numbers cannot borrow a
foreign application's owner. Stale cleanup cannot retire a replacement. Native
resource close, window destruction and application shutdown retire contained
reviews through the same ownership tree, including requests already in flight.
The existing 64-window, 256-presentation and four-worker limits still apply.

`open_preview_store` is a noncreating read of this application's existing private
state. The caller reserves the review before awaiting it. Its five-second read
phase comes from `DiscoveryControl::read_control`, sharing the reservation's
original remaining lifetime and cancellation. Both entry and delivery require
the original selection and a still-reserved review; later preparation cannot
adopt an old store response. Cancellation propagates to queued native IO, while
admitted workers retain capacity until settlement. Missing or invalid state is
an error, never implicit initialization or a project-directory fallback.

`preview_snapshot` returns detached, bounded display data cloned from the ready
native artifact. It holds no mutation lock after returning and cannot replace
the accepted plan. Editing a snapshot's proposed bytes does not change what
publication writes. Callers still revalidate `is_preview_current` before delivery.
No ownership mutex spans an await. Publication continues to require separate
qualified native write authority; these forwarding methods grant none. Native
IPC tokens, command ordering and the purpose-bound write factory remain pending.

## Observation IPC

`project_memory_open` resolves the calling window's typed native resource and
compares its exact identity with the native binding, rather than accepting a
window label or filesystem grant from JavaScript. Bindings are pruned on native
attachment and remain bounded by the 64-window registry. It returns a presentation
handle containing a window-local resource ID and UUID token. Every command uses
the caller's own resource table and validates that token; a closed or reused ID
cannot authorize access or remove its replacement. Closing the resource retires
its presentation even while an admitted command retains an Arc. The combined
presentation registry remains capped at 256; retired workers retain their own
four-slot budget through physical settlement.

`project_memory_select` accepts that handle, a path, an explicit workspace
environment and a monotonically increasing revision from 1 through JavaScript's
maximum safe integer. A stale or repeated revision leaves the current selection
intact. A fresh admitted revision retires the previous selection even if the
destination fails validation. Only native-local environments are currently
supported; other environments never fall back to local IO. The returned UUID is
an ephemeral selection receipt. Selection does not authorize paths, initialize
state or trust instructions.

`project_memory_discover` requires the current selection receipt, opens existing
private state without creating it, rechecks selection, and runs read-only scope
discovery with the existing five-second ascending budget. Its schema-1 reply
contains `scope`, the resolved `root` if available and `blockedCount`; raw facts,
blocked paths, local preferences, installation identity and instructions remain
native. Missing or invalid state is an error, never evidence of an absent kit.
Errors contain a redacted `code`, not observed content or paths.

`project_memory_initialize_local_state` is a separate explicit action under the
same current selection. It prepares only the application's private state, never
project files or a kit. Selection retirement before later stages prevents their
admission; retirement after an admitted write suppresses delivery without
promising rollback. Both operations revalidate before returning.

The typed client in `workspace-kit/lib/nativeMemory.ts` starts no IPC until an
explicit selection, captures its environment and maintains those revisions.
Receipts belong to the exact client and selection; replacement, round trips and
close suppress late results and errors. Late opening is closed by its original
owner, cleanup is coalesced and failed cleanup remains retryable. A native result
is an observation, not consent or proof that a model read the kit. Consumers must
recheck `isCurrent` immediately before publishing an already returned result.
The shared lazy inspection dialog opens from the terminal status bar and the
Harness project rail only after a user action. Terminal selection requires the
selected canonical terminal, its own leaf and explicit filesystem; collaboration
guests and ambient nonterminal directories cannot lend a target. Harness uses
its outer view identity, matching active folder and own project environment.
Hidden views withdraw their target, and standalone views never borrow another
view's folder. Source replacement closes the original dialog instead of adopting
the successor. Unsupported environments show a restriction without native work.

Panel controllers capture targets, coalesce actions and revalidate after awaits
and before state publication. At most 256 JavaScript presentations are retained,
including retired entries until their exact resource-close acknowledgement.
Failed cleanup remains counted and is retried on a later panel opening without
background polling. Native workers retain their separate physical budget.
Private-state preparation requires its own explicit action under a retained
selection; inspection starts no agent and grants no instruction trust or session
consent. Scope lookup failures never imply absence. Kit deployment, policy and
capture controls remain separate pending integrations.
