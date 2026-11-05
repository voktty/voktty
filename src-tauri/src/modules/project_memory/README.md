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

Capturing a read source grants no writes, instruction trust or session consent.
Project observation is not started at startup. Its owner must
qualify the local transport and retire sources when selection changes; a local
environment descriptor alone does not prove filesystem or transport ownership.
The worker checks the actual project-root filesystem through its native handle,
including when revalidating an existing binding. Unix uses the recognized local
filesystem policy documented by the reader; Windows checks local disk paths.
This OS-reported classification does not attest to physical backing storage.
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
the previous review before project filesystem work. `start_preview` accepts only
that exact reservation once, together with the captured values;
it cannot replace the destination, authorization snapshot or deadline after an
await. The existing `prepare_preview` convenience method performs both phases
without requiring an application store. Reservations grant neither a ready plan
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
`confirm_preview` supplies the purpose-bound native authority described below.
The worker uses the exact original preview, read authorities and review deadline.
Publication has its own bounded request control; the completed preparation's
response deadline does not shorten or renew the manual review's two-minute life.

New selection, failed selection, clearing, owner disposal or another review
permanently retires the old review and requests cooperative cancellation of its
current phase. Its destination source retires with it. Preparation and publication
results recheck the original review, origin and destination after awaiting.
Cancelled delivery does not roll back files or acknowledge a blocked filesystem
call. Partial reports retain acknowledged changes. Interrupted project publication
leaves its temporary record and backups for recovery; it does not use a private
installation journal. Native worker slots and publication locks remain held through physical
IO settlement even when the owner has already retired.

Callers must recheck `is_preview_current` immediately before delivering an
already returned result. That check describes lifetime only: a consumed review
can still identify its in-flight result but cannot publish again. Exact
`cancel_preview` cleanup can release it afterward without touching a replacement.
No mutation lock spans an await. Registry limits still bound containing owners;
there is no review history, background timer, implicit deployment or AI launch.
Ancestor inspection requires the explicit selection consent described below.
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
Ordinary open stays noncreating. Platform runtime qualification and additional
deployment modes remain pending. This
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
quick-composer windows are not memory presentations. CLI integration remains
pending; user-facing publication uses the review flow below.

## Window-owned review operations

`NativeMemoryOwners` and `NativeMemoryApplication` forward review reservation,
preparation, adoption, inspection, cancellation and publication only under their
exact window, presentation, selection and review receipts. Application identity
is also checked; matching window labels or resource numbers cannot borrow a
foreign application's owner. Stale cleanup cannot retire a replacement. Native
resource close, window destruction and application shutdown retire contained
reviews through the same ownership tree, including requests already in flight.
The existing 64-window, 256-presentation and four-worker limits still apply.

Preview and publication use `preview_project_at_root` and `publish_project` from
the same native service as CLI initialization. They require only the captured
project roots and read/write authorities. Existing content documents are preserved;
missing bases and links can be repaired without reinitializing preferences.
`open_preview_store` and its forwarding control methods have been removed.
The record `.voktty/.initialization.json` and up to three exact migration backups
remain inside the project, with exclusive creation and cleanup of owned bytes.
Project recovery and the normal panel use project-owned services without private
setup. Legacy trust and context APIs retain their state-dependent flows pending
retirement; policy commands and their exclusive native layers have been removed.

`preview_snapshot` returns detached, bounded display data cloned from the ready
native artifact. It holds no mutation lock after returning and cannot replace
the accepted plan. Editing a snapshot's proposed bytes does not change what
publication writes. Callers still revalidate `is_preview_current` before delivery.
No ownership mutex spans an await. Publication continues to require separate
qualified native write authority. The deployment IPC below retains native
receipts behind ordered, opaque command tokens.

## Purpose-bound publication authority

Explicit native `confirm_preview` captures fresh, bounded registry grants and
derives its write scope from the original immutable `OwnedProjectInitializationPreview`.
It never accepts a display snapshot, serialized plan or caller-provided inventory.
The canonical destination, reviewed creations, necessary parent directories and
exact recorded migration backups define the scope. Creation staging is limited
to native UUID-v4 names in the reviewed creation parents. Replacement covers only
selected known migrations; removal covers only exact recorded recovery entries.
Skipped targets receive no creation or replacement grant, including on recovery.

The factory performs no IO and authorizes no new workspace roots. It independently
captures at most 256 existing registry roots and 1 MiB of encoded paths; its
purpose scope admits at most 512 stored paths and 2 MiB of encoded paths. Every
use checks the original origin, destination and review lifetime, exact native
path spelling and secret-path write protections. Retirement cannot be reversed
by selecting the same path again. Registry revocation must still retire sources.
Native descriptor checks, exact bytes, platform restrictions and publication
deadlines remain mandatory; this authority does not replace them.

Confirmation consumes the ready review once. Failure to capture write authority
also retires that acceptance, rather than falling back to read grants. Window and
application forwarding retain their existing exact ownership checks. Linux tests
cover real publication, three opted-in migrations, reserved content, recovery,
canonical aliases, denied or oversized grant snapshots and foreign owners.
Other native runtime qualification remains pending.

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

`project_memory_discover` requires `inspectionOnly: true` and the current
selection receipt. Missing or false inspection flags reject with `unsupported`
before resource lookup or private-state access. The command runs stateless
marker inspection with the existing five-second ascending budget. Its schema-1 reply
contains `scope`, the resolved `root` if available and `blockedCount`; raw facts,
blocked paths, local preferences, installation identity and instructions remain
native. Global memory preferences are not inspected or opened on this path.
Errors contain a redacted `code`, not observed content or paths.

`project_memory_initialize_local_state` has been removed from Desktop and the
typed client. The helper rejects the former `initialize` operation before
resource allocation or storage access. Its legacy storage reader only opens
existing data; initialization is confined to test fixtures. Project file
initialization uses the project publisher and never needs private setup.

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
consent. Scope lookup failures never imply absence. Policy and capture controls
remain separate pending integrations.

## Deployment IPC

`project_memory_preview` requires the calling presentation handle, current
selection token and a strict request containing `revision`, `destination`,
`environment`, string `inputs` and explicit `links` flags. Revisions increase
from 1 through JavaScript's maximum safe integer within each selection. Stale
or repeated revisions cannot replace a review. A fresh revision retires the
previous review even if destination validation fails. Inputs are checked before
project IO against the worker's 32-value, 64-byte-key, 16-KiB-value and
256-KiB-total limits. Nested input values, client plans, authorities, storage
origins and unknown request or link fields are rejected.

The command reserves native ownership, inspects bounded ancestor metadata and
prepares a project-owned review. It never opens or initializes application memory
storage, grants roots, starts an agent or changes use policy. Canonical native
paths constrain the destination to the selected project or its already observed
applicable memory root, including aliases. A
known applicable parent memory blocks nested initialization without granting
write access to that parent. Incomplete metadata does not grant new paths.
Preparation does not scan project descendants or dependencies. Its schema-1
reply contains an opaque review UUID, revision, the owned canonical destination
`root`, detached deployment display data,
a redacted platform blocker and retained wire fields `isResuming: false` and
`recoveryFiles: []`. Those fields do not claim global-journal resumption. Expected
and proposed project bytes are deliberately included for explicit review; private
preferences, installation identity and authorization objects are not. Editing
the returned data cannot change the retained native publication plan.

`project_memory_confirm_preview` accepts only that selection and ready review
token. It marks acceptance consumed before admission, captures purpose-bound
write authority and publishes the original artifact once. Duplicate, foreign,
opening and retired tokens cannot publish or cancel a successor. Admission or
publication failure never restores acceptance. Success returns schema 1 and
the acknowledged `created`, `skipped`, `migrated` and `cleaned` relative paths.
Deployment errors contain a redacted `code`; a current native publication failure
also includes `changes` with acknowledged operations and `possibleRecoveryFiles`.
Missing changes, timeout or cancelled delivery never proves an absence of writes.
No diagnostic text, project contents or private state is embedded in errors.

`project_memory_cancel_preview` uses the selection and request revision, allowing
cancellation while preparation is opening and before a review token is returned.
Exact cancellation retires only that review. A newer cancel records its revision
and retires older work, so a delayed preview cannot start after its cancellation;
stale cancellation leaves a successor intact. Cleanup after an asynchronous
failure also matches the original token. Selection changes, resource close and
native owner retirement suppress late results and errors. No ownership or
command-state lock spans an await. Physical workers retain their own capacity
and publication exclusion until IO settles. Remote transports remain pending.

The typed deployment client captures destination, environment, string inputs and
link choices before awaiting. Preview revisions increase within its presentation.
Each returned review has a private object identity bound to its original selection;
copied, foreign, replaced and closed reviews cannot confirm. Its display snapshot
is never sent back as a publication plan. Confirmation sends only the native token,
coalesces duplicate submissions through actual settlement and consumes acceptance
on success or failure. Current publication failures retain native partial-change
reports. Retired results and errors are suppressed without promising rollback.

Cancellation retires delivery synchronously and sends the original revision even
before a token exists. Duplicate cancellation coalesces, failed cancellation can
be retried, and a successor cannot be cancelled by old cleanup. Up to 256 deployment
requests per presentation remain counted through actual settlement, including
superseded requests. These JavaScript guards neither grant native authority nor
prove filesystem cancellation. Panel deployment follows the explicit review UI below.

## Native project recovery ownership

Recovery and initialization share one native deployment-review slot per selection.
Reserving either retires the previous review, including when destination capture
fails. Distinct receipts retain the original window, presentation, source and
destination; a publication receipt cannot confirm recovery.

Recovery uses `OwnedProjectRecoveryPreview` and the project-owned initialization
record without opening private application storage. Confirmation consumes the
native review before digest validation and worker admission. Write authority is
captured from its complete restoration, deployment and cleanup requirements,
never from display data. Ordinary workspace authorization, secret-path rules,
root and byte checks, record locking and review lifetimes remain mandatory.

Selection replacement, presentation close, window retirement and shutdown retire
contained work. Results and errors recheck their original owners after settlement;
exact cleanup cannot retire a successor. No ownership mutex spans an await, and
queued or running work retains its bounded worker capacity until physical
settlement. Cancellation does not imply rollback. Desktop and the authenticated
helper use schema-2 recovery reviews; CLI uses the same native project service.
Windows runtime qualification and complete product acceptance remain pending.

## Restoration IPC

`project_memory_review_recovery` requires the calling presentation, current
selection and a strict request containing only `revision`, `destination` and
`environment`. It reserves native ownership before opening existing private state;
missing state never initializes identity. Destination input is bounded to 4 KiB
UTF-8 and 128 components before private-state IO. Nonlocal environments cannot
fall back to local IO. Review reads the original recorded backups and performs
no project writes, instruction delivery or preference changes.

Publication and restoration share one exclusive command-review state and one
safe-integer revision counter per selection. A new request of either kind retires
the other kind; a delayed old request cannot replace it.
`project_memory_cancel_recovery` and `project_memory_cancel_preview` use that
shared revision domain, including tombstones recorded before a review
token exists. Asynchronous cleanup additionally matches the original token, so
old failure or cancellation cannot retire a successor of either kind.

The schema-1 review reply contains only `root`, opaque `review` UUID, `revision`,
acceptance `digest` and `entries` with `target`, `backup` and exact original `text`.
The native intent and reader constrain the inventory to three known migration
targets, 256-byte relative names and 256 KiB per original; no private installation
identity, unrelated preferences, filesystem grant or executable plan is returned.
Display edits cannot modify the retained native artifact.

`project_memory_confirm_recovery` takes a strict `confirmation` object containing
only that review UUID and digest. A publication token cannot confirm restoration,
and a restoration token cannot publish. The ready state is consumed before digest
validation, write-authority capture and worker admission; any failure requires a
fresh review. The schema-1 publication report describes acknowledged restored and
moved backup names; redacted errors preserve available partial-change reports.
Restoration keeps the private intent and never publishes a kit or accepts the
subsequent initialization review. Its result checks the original source, command,
native review and presentation after settlement. Retirement can suppress delivery
but does not imply rollback. No command or ownership mutex spans an await.

## Typed restoration client

The presentation's `reviewRecovery`, `confirmRecovery`, `cancelRecovery` and
`isRecoveryReviewCurrent` use the same deployment revision counter, exclusive
review owner and 256 unsettled-request budget as publication. Capacity rejection
preserves admitted work. Superseded requests, including retired reads, remain
counted until actual transport settlement. Selection replacement and presentation
close permanently retire delivery. A cancellation of the other operation kind
cannot cancel the current review; old cleanup cannot borrow a successor's revision.

The recovery validator checks UUIDs, matching revision, digest, bounded Unicode
root text and the exact three-target migration vocabulary. Original text is
bounded to 256 KiB per entry; backup names must have the matching parent, one
shared transaction UUID and distinct inventory indices below 128. Unknown fields
are discarded and display snapshots are copied and deeply frozen. The native
token and digest stay private to the exact receipt; copied or foreign receipts
cannot confirm. These display checks grant no filesystem authority or trust.

Confirmation sends only the retained UUID and digest, coalesces duplicates until
settlement and consumes acceptance on success or failure. A success report must
match every reviewed target and moved backup, with no skipped or migrated paths,
before the client acknowledges restoration. Malformed replies cannot restore
acceptance. Cancellation retires local delivery before IPC, including before a
token exists, validates its boolean response and permits retry after failed
cleanup. Native admitted writes retain their no-rollback semantics. The panel
below exposes local restoration; CLI and remote-helper integration remain pending.

## Manual original-restoration panel

The shared terminal and Harness management panel offers an explicit recovery
review for native-local partial, invalid or ambiguous scopes, blocked incomplete
scopes, and deployment recovery errors. Scope alone never asserts that backups
exist. Only the native review identifies recoverable originals. SSH, unresolved
remote namespaces, WSL and Docker cannot fall back to local restoration while
their helper integration is pending. Opening or refreshing still reads metadata
only; it never starts recovery or initializes private state automatically.

The lazy recovery view displays the canonical root, each destination and recorded
backup, and the exact original text without interpreting markup. A separate
unchecked checkbox accepts only that review object. Confirmation, back and the
checkbox are disabled through restoration settlement. Closing retires the original
presentation without promising rollback. Failed operations retain available
acknowledged changes and candidate paths, require another manual review, and
never display success or retry automatically.

Back cancels the exact recovery review before fresh metadata inspection. Successful
restoration retains its movement report separately from initialization success.
Continuing re-inspects the current source and opens editable initialization details,
requiring a new native preview and its independent publication acceptance. No
previous plan or checkbox can publish implicitly. Partial scopes also offer manual
review of a pending initialization without creating private state or asserting
that an intent exists. New initialization uses project files and does not consume the
preserved legacy journal. Native root identities and expected bytes still apply.

The recovery initialization form exposes the original creation date as well as
the existing project details and persistent-link choices, so a previous day's
intent can be reviewed without silently replacing its date. Values are not
reconstructed from the private journal; the user must retain the original settings
and the native core refuses mismatches. English and Spanish copy describes the
move, preserved existing targets, independent trust and policy, partial failures
and the required subsequent review. Other locales use the English fallback.
Native WebView, Windows and full remote runtime acceptance remain separate gates.

## Retired policy controls

Desktop no longer registers `project_memory_review_policy`,
`project_memory_confirm_policy` or `project_memory_cancel_policy`. Their native
selection reservations, application forwarding, typed client and exclusive
workers have been removed. The authenticated helper also rejects the retired
policy operations before allocating resources or opening private storage.

Project initialization, repair, recovery and project-owned context use their
existing project services without a private policy setup step. Workspace
access, secret-path protection, nonce checks, bounded work and cleanup ownership
remain on those services. Existing global preferences are preserved; legacy
trust and context APIs remain separate pending retirement.

## Retired instruction trust IPC

Desktop no longer registers `project_memory_review_trust`,
`project_memory_confirm_trust` or `project_memory_cancel_trust`. Their command
review state, reservation helpers and exclusive IPC tests have been removed.
The typed frontend also exposes no trust-review API. Desktop context binding
accepts only the project-owned schema-2 contract described in `CONTEXT.md`.

The shared redacted error conversion remains available to project binding.
Native core and authenticated-helper legacy trust APIs still await retirement;
existing global data is preserved. Project publication, recovery and context
continue to enforce their original source, authorization and lifetime checks.

## Typed project-context client

`nativeMemoryProjectContext.ts` binds only the project request `{ schema: 2 }`.
It retains the original selection, context and transport checks through opening,
request settlement and adoption. Selection replacement or close retires the
pending binding without borrowing a successor; known cleanup remains retryable.

The former trust client and its review, confirmation, cancellation and legacy
binding APIs have been removed. Project binding and deployment retain the shared
256 unsettled-request budget through physical settlement. The context client
accepts only bounded schema-2 binding replies and project packets; legacy policy
or trust responses reject without fallback. This grants no tools or captures.

## Narrow ancestor inspection

`project_memory_select` accepts an optional `inspectAncestors` boolean, false
when omitted. A true value is reserved for an explicit inspection action. It
creates a new selection and retires its predecessor, including already admitted
reads and reviews; it never widens a retained source. Consent is local to that
exact presentation and selection and is neither persisted nor inherited by later
selections. The client captures the option before awaiting native opening.
The panel offers this separate consent after incomplete ancestor discovery.

The source retains the original validated native path as an immutable inspection
anchor. In addition to the ordinary captured registry grants, it allows metadata
of strict ancestors, their `.voktty` directories and those directories' immediate
entries; it permits enumeration only of those `.voktty` directories and content
reads only of their exact `kit.json` markers. Enumeration is needed to distinguish
reserved application data from partial memory and retains the discovery engine's
128-entry classification limit. Parent directories, sibling projects, instructions,
sessions and nested private state receive no general enumeration or content grant.
Secret-path protections, native descriptor checks, marker limits, filesystem
boundaries and discovery deadlines remain unchanged. A marker link stays blocked.

This inspection never registers workspace roots or promotes an observed parent
to a workspace. Readable parent markers grant neither context delivery nor writes,
trust or session consent. Preview destinations still require fresh native registry
authorization; their sources inherit only the original inspection anchor, not a
new chain derived from an unrelated destination. Publication rechecks that same
scope and uses its independent purpose-bound write authority. Selecting an
unregistered parent as a destination still fails. No IO occurs while capturing
this grant; canonical aliases outside its exact spelling remain incomplete rather
than acquiring inferred permissions. Linux tests cover real discovery and
publication without granting parents. Other native runtime qualification remains
pending.

## Project file management panel

The terminal and Harness panel inspects project markers without private state.
Its controller exposes only inspection, ordinary workspace authorization,
initialization/publication, document browsing and legacy recovery. Private setup,
policy and instruction-trust screens and their controller states are removed.
Conversation context retains its independent existing native clients and checks;
removing those screens does not change their authorization or stored data.

Initialization uses folder, date and interface-language defaults with both
`AGENTS.md` and `CLAUDE.md` links enabled. Ready or partial memory with complete
ancestry and no blocked paths can use the same action for repair. The native
project service preserves existing project content and valid persisted template
values. A known parent is never promoted to an authorized destination.
Create/skip-only plans publish under the original action; migrations retain an
exact current/proposed file review, checkbox and single-use confirmation. A
conflict or platform blocker prevents publication. Returning cancels the exact
review before showing the observation again. Duplicate work coalesces, and
original-owner checks surround awaits, state observers and write admission.

Publication reports acknowledged paths and preserves partial-failure reports.
It never retries automatically or implies rollback. Initialization does not
start an agent or change conversation delivery. Legacy interrupted-initialization
editing remains separate and still offers its form; recovery of the newer
project record is pending. Marker ancestry inspection remains explicit. Native
Windows, real SSH and agent workflow acceptance are still required.
