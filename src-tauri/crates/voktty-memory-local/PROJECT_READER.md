# Project observations without private preferences

`ProjectMemoryWorkspace` captures an explicitly authorized native project root
without opening `LocalMemoryStore`, creating an installation identity or reading
private preferences. It is the project IO boundary for separating shared kit
initialization from persistent policy and instruction trust.

The native caller supplies `MemoryReadAccess`. Requested and resolved roots must
both be authorized. The reader keeps the shared secret-path restrictions,
qualified local filesystem checks, directory identity and root-instance checks.
Each observation revalidates the captured root and its current authority before
returning. Links, reparse points and document changes retain the existing native
reader's refusal behavior. A successful observation grants no write authority.

`observe_deployment` reads the embedded kit's fixed deployment inventory, including
the lock marker and explicitly selected root instruction links. It does not
enumerate or copy conversations or other user files. Reads retain the four-reader
process limit, cancellation, a maximum five-second phase, the 256 KiB native
per-file limit, a 128-path limit and a 1 MiB aggregate text limit. Blocked files
stay blocked rather than becoming absent or empty.

`observe_scope` uses the shared scope resolver and its original discovery deadline.
Its directory keys are generated for each observation. They are not persistent
project keys, installation identities or instruction-trust receipts. Missing
ancestor authorization remains an incomplete scope rather than permission to
initialize a nested project.

The persistent `LocalMemoryWorkspace` shares root capture, root revalidation and
bounded text collection with this reader. It continues to check its installation
and preference revision for persistent operations. Its publication journal,
migrations, trust and policy remain separate contracts.

This API only observes the project. It does not publish a kit, provide an IPC
command, enable a conversation or repair Windows ACLs. Desktop, CLI and SSH
initialization must retain native review ownership and explicit write authority
when they consume these observations.

## Initialization reviews

`OwnedProjectInitializationPreview::prepare` renders the embedded kit and its lock
from native project observations. `ProjectInitializationRequest` owns the origin,
destination, original read authorities, template inputs and optional instruction
links. It has no private-store argument. `MemoryWorkers::preview_project` runs
preparation behind the existing four-slot worker budget and retains its slot
through physical settlement.

The review holds the exact original authorities and native root-instance bindings.
Its digest covers both roots and the complete proposed deployment, including
expected existing bytes. A display snapshot or digest does not authorize writes.
Revalidation uses the existing 120-second review lifetime, the original request
deadline, complete ancestor and descendant inspection and current document bytes.
Documents are checked after scope discovery so an edit during that scan cannot
pass as the earlier reviewed content. Both original roots must still be current
and authorized when revalidation returns.

An absent or runtime-only target can be reviewed. An existing valid kit at the
exact captured destination can be completed when the shared planner accepts its
existing bytes. A partial target, another ancestor kit, a nested kit, incomplete
enumeration or conflicting template bytes blocks preparation. The persistent
publisher retains its previous scope rules; no recovery permission is inferred
from the independent review.

Preparation also inspects bounded directory listings for existing migration or
staging artifacts at the origin and destination. The limits are 20,000 root
entries, 128 immediate kit entries and 128 reported artifacts per root. It reads
no artifact contents, restores nothing and never deletes a candidate. A candidate
at the destination requires explicit recovery; origin candidates report a pending
operation. Private legacy journals are not read or declared recovered by this
API. Publication and migration journal handling remain separate integration work.

Neither preparation nor revalidation creates directories, kit files, preferences,
installation identity, trust or session consent. Desktop, CLI and SSH wiring is
separate from these native APIs.

### Explicit placement at a project root

`prepare_at_project_root` and `MemoryWorkers::preview_project_at_root` prepare a
kit at the explicitly selected native directory without resolving an instruction
delivery scope. They inspect only the fixed deployment inventory and bounded
recovery listings at that destination. They do not scan ancestors, dependencies,
Git internals or nested projects. Matching partial template files can be completed;
conflicting bytes and pending recovery still block creation. A root inside a
`.voktty` directory is refused. Secret-path, native root identity, original
authority, review lifetime and independent write checks remain mandatory.

Explicit placement grants no instruction trust, delivery scope or session consent.
The original `prepare` API retains its complete scope checks. Review digests and
operation records use schema 2 and bind the placement mode, so an acceptance for
a resolved scope cannot be reused for explicit placement. Publication revalidates
the chosen mode through physical settlement. Desktop and remote callers have not
yet been connected to this explicit placement API.

## Publication

`publish` consumes the original review with its matching digest and an independent
native `MemoryWriteAccess`. `write_requirements` describes the exact project
creates, the three supported rule/ignore migrations and recoverable artifacts;
the display data itself cannot grant access. Creation, replacement and cleanup
permissions are checked separately before the first write and again by the native
writers. An identical kit needs no write permissions and creates no record.

A mutating publication creates `.voktty/.initialization.json` exclusively before
changing kit files. This bounded operation record contains the transaction UUID,
review digest, hashed native root bindings, relative paths, deployment actions
and expected/proposed content hashes. New records also declare
`activityLock: "record-v1"`. Their `template` field retains the exact normalized
kit values, embedded template version and selected AGENTS/CLAUDE links. This
allows template reproduction even if publication stopped before `kit.json`.
Only configured template values are retained, not arbitrary caller inputs or
existing content documents. Values can contain user-authored project metadata;
the record is project data, not a redacted diagnostic. It contains
no native root paths, original document text, private
preferences, instruction trust or installation identity. Another record cannot
be overwritten or borrowed. Its presence makes an unfinished root visible to
scope discovery. Resolved-scope publication rechecks ancestor and descendant
transactions before the final kit marker and after publication; explicit placement
checks its captured destination without claiming a resolved delivery scope.

Cooperating publishers and original-restoration operations share a nonblocking
process-wide exclusion guard through physical settlement. Project records also
prevent independent processes using this publisher from starting on the same
root. The existing persistent publisher retains its private journal and OS lock;
the process guard is shared with it and does not acknowledge or recover a legacy
private transaction.

For `record-v1`, the publisher locks the exclusively created staging object
before atomically exposing the record and retains that exact handle through all
kit and backup mutations. Unix uses a nonblocking advisory file lock. Windows
locks one byte at offset `0xfffffffffffffffe`, outside the bounded record text,
so independent validation handles can still read it. The lock grants no writes
or recovery permission, adds no private state and is released by the OS on process
exit. It is released before final record cleanup, after all kit and backup work;
that cleanup still compares the exact record and preserves replacements.
An older record without this declaration does not establish the locking protocol.
Records without template data or deployment actions remain recognizable pending
operations, not reproducible transactions. Native project recovery validates the
embedded version, exact inventory and hashes rather than inferring missing inputs
from current defaults or treating this metadata as write authority. Older records
remain explicit errors with their files preserved.

The publisher reuses the existing native exclusive creator and original-preserving
migration backends. It verifies expected bytes before mutation, publishes
`kit.json` last, verifies the complete kit and only then removes known originals
and its exact operation record through separately authorized cleanup. Failures
report acknowledged creates/migrations/cleanup and possible recovery paths.
They can leave files, preserved originals or a record in place; cancellation
does not promise rollback. A retained record requires explicit recovery even
when the final marker already exists. Reading that record never grants trust.

Mutating publication currently uses Linux/Android and Windows native migration
and cleanup primitives. Other platforms report unavailable before writes; the
existing persistent publication route is unchanged. Windows sources are checked
by cross-compilation, which does not qualify native NTFS runtime behavior.
`MemoryWorkers::publish_project` uses the same four-slot worker lifetime and
original cancellation deadline as preparation.

## Project recovery

`OwnedProjectRecoveryPreview::prepare` captures native origin/destination read
authorities through `ProjectRecoveryRequest`. It opens the existing project
record component by component, rejects links, multiple hard links, oversized
records and filesystem changes, and acquires the nonblocking `record-v1` lock
before reading it. The read shares the four-reader budget and bounded phase.
A live publisher or recovery cannot be borrowed; process exit releases its lock.
Preparation releases that lock after validation and performs no writes.

The strict record parser verifies schema, operation, scope, canonical transaction
UUID, hashes, template version and the exact ordered embedded inventory. Backup
names are derived from the transaction and original entry index, never accepted
as arbitrary paths. Unknown artifacts, unsupported versions and records without
template inputs or actions remain preserved and block recovery. The original
native root-instance bindings must still match. No private store is opened and
no installation identity, policy, trust or session permission is created.

The pure recovery planner reproduces missing files, preserves currently present
Content documents, and rejects modified bases or rules. Only the three existing
rule/ignore migration paths are eligible for restoration. A missing rule is
restored by moving its verified original object back before migration, preserving
its native metadata. A recognized pre-exchange proposal can be cleaned only
while its original remains at the target. Recognized originals are retained until
the whole kit verifies. An already completed kit can require only record cleanup.
Unknown or changed backups are never discarded. The kit lock is reproduced from
the actual planned base proposals, including the private-ignore migration.

The acceptance digest covers the exact record, current file/backup snapshot and
resulting deployment. `publish` consumes that original review with independently
granted create, replace and cleanup access. It reacquires the exact record lock,
revalidates the snapshot and original authorities, and retains the lock through
all project and backup mutations. It uses the same native create, migration,
original-restoration and cleanup primitives as initialization. Root and byte
checks separate every phase. Resolved-scope records retain ancestor/descendant
checks; explicit-root records do not acquire a delivery scope. Review expiration,+cancellation, unknown data or changed authority stops subsequent phases without
claiming rollback. A further interruption retains a recoverable record. Final
record cleanup compares its exact bytes after all other work, as in publication.

The standalone CLI uses this synchronous native API without a global store.
Desktop and SSH recovery callers still use the previous private journal contract
pending adaptation. Linux
tests exercise interruption, migration, metadata preservation and a separate live
lock-holding process. Windows compilation is checked separately and is not native
runtime qualification. Platforms without native migration/restoration/cleanup
report their existing unavailable states before project writes.
