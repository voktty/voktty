# Native local project memory

This native library stores an installation UUID, per-project use policy and
accepted instruction digests outside repositories. It is separate from workspace
filesystem authorization and the pure `voktty-workspace-kit` decision core.
The local readers gather exact project bytes through native authority.
No application startup, IPC command, CLI, provider or capture is wired to it yet.

The native caller supplies an existing application state directory on a local
filesystem. Never accept this path from repository configuration or an untrusted
webview, and never select a workspace, SSH, WSL, Docker or network directory.
The directory and its parents must remain application controlled for the whole
operation. Canonicalization is not an authorization grant or protection against
an owner replacing that directory or deleting the lock file externally.
Unix rejects foreign-owned or shared-writable directories and files; Windows
relies on the application's private directory ACL. Links/reparse points at the
selected directory and file entries are rejected; Unix also rejects hard-linked
files and opens without following links or blocking on FIFOs.

`create_private(parent, control)` explicitly creates or reopens only the fixed
`project-memory` child of an existing native-owned application directory. The
parent is supplied by the native application, never workspace configuration or
an IPC path. It has the same local-filesystem and controlled-ancestor preconditions
as `open`. Missing parents fail; it never recursively creates ancestor paths.
Input is bounded to 4 KiB UTF-8 and 128 components. Relative paths, control bytes,
parent traversal and unqualified network namespaces are refused before creation.

The helper uses the existing no-follow directory handles. Unix uses `mkdirat`
with mode `0700`, requires current-user ownership and no shared write access on
the parent, and refuses group/other permissions on an existing child. It never
repairs permissions or deletes an existing file or directory. Windows creates
relative to its captured parent with `NtCreateFile`. Newly created private
directories receive a protected DACL for the current user, Local System and
Administrators, with the current user as owner. Existing ACLs are never replaced.
A separate handle requests `READ_CONTROL` and checks actual ownership and
DACLs without expanding the project reader's access rights. The owner must be
the current token user. Parent grants to other principals cannot allow destructive
control; child grants to other principals cannot allow access. Local System and
the built-in Administrators group remain trusted OS principals. Null DACLs,
unavailable queries and unknown or object-specific grant entries fail closed.
Deny entries do not excuse a broad allow entry. No ACL is repaired automatically.
Every Windows preferences or lock-file open also checks its actual owner and
private DACL; directory permissions alone cannot establish file access policy.
Both backends reject links/reparse
points and cross-device/volume children, and compare the parent and child
identities again before returning the store. Existing corrupt preferences stay
untouched. Opening the directory never initializes identity or preferences.

This synchronous helper checks cancellation and the original read deadline
between operations; a kernel call is not interruptible. Errors can leave its
created empty directory in place and never trigger a blind rollback. A future
application bootstrap must retain bounded worker ownership through settlement.
It is not yet wired to startup, IPC or CLI.
Linux tests cover creation, repeated and concurrent opens, explicit identity,
corrupt records, failed inputs, links and permission refusal. Windows tests are
only cross-compiled until native execution qualifies this path.

`open_private` applies the same checks to an existing child without creating a
directory or identity. The private state helpers also inspect the opened native
filesystem: Linux/Android admit ext-family, Btrfs, tmpfs, XFS, overlayfs, ZFS and
F2FS magic values; unknown, network and userspace filesystems are unavailable.
Apple requires APFS or HFS with the native `MNT_LOCAL` flag. Windows requires a local disk drive
for the requested and opened-handle paths. These OS-reported classifications
do not prove physical backing storage, durability, or support for arbitrary
third-party filesystems. Ancestors must still remain application-controlled;
these low-level helpers do not audit the complete ancestor chain.

`prepare_application_parent` prepares the native application origin before
initializing its memory child. It checks an absolute path bounded to 4 KiB and
128 components, opens existing components without following links, and creates
only missing suffix directories relative to captured parent handles. Each
ancestor must report a recognized local filesystem and controlled permissions.
Unix permits root or current-user ownership, refuses shared writes except for
traversing sticky directories, and never creates directly under a shared-writable
parent. Apple also checks descriptor-based extended ACLs: absent or deny-only
ACLs are accepted, additional allow entries and failed queries are unsupported.
The same Apple check protects private directories, records and lock files.
Custom allow ACLs require a future verified effective-permission policy; mode
bits alone never establish their safety.
The descriptor API and its entry constants follow the
[Apple ACL header](https://github.com/apple-oss-distributions/Libc/blob/main/include/sys/acl.h);
absence and end-of-iteration behavior are checked against Apple's Libc sources.

Windows ancestor checks additionally recognize the OS TrustedInstaller principal,
whose SID is derived locally from the fixed service name. This exception applies
only to ancestor inspection, not private state ownership or instruction trust.
New suffixes use the private descriptor above instead of inheriting broad grants.
The final application parent must belong to the current user. A captured chain
is rechecked before each creation and at return; identities or permissions that
change invalidate the operation. `check_application_parent` performs the same
inspection without creating directories. Neither method initializes identity,
repairs existing permissions, modifies a project or authorizes workspace roots.
Failures preserve completed directory creation; they never blindly roll it back.
These are point-in-time checks, not protection against later privileged changes.

The native storage worker uses these methods for both modes, so explicit
initialization works when its app-directory suffix does not yet exist. Ordinary
open remains noncreating. Windows and Apple runtime qualification remains pending;
cross-compiling the new ACL and suffix tests does not execute them.

`open` validates the directory; `load` never creates an installation identity.
Only explicit `initialize` creates schema 1 `memory-local.json` if absent.
Repeated initialization preserves the UUID. A new installation gets a different
UUID v4. Native identity factories must include it in their project-key inputs;
repository files must not supply this value. Copying application state is not
an identity migration mechanism. Snapshots are observations, not authorizations.

The file contains a revision and at most 256 unique project records, keyed by
the exact lowercase SHA-256 identity from the native resolver. Records contain
`policy` (`manual`, `always`, `never`) and a nullable `instructionDigest`.
Legacy `ask` reads as `manual` and is serialized as `manual` on the next explicit
write. Unknown fields, versions, duplicate fields/keys, invalid UUIDs/digests,
revision overflow and files exceeding 256 KiB fail. Capacity never silently
evicts an old `never` record. Corrupt or unavailable data is never reset or
replaced by a permissive default: callers must block memory delivery and surface
the error. Recovery/export UI remains pending.

Policy and trust are separate mutations. Trusting instructions preserves policy;
changing policy preserves the trusted digest; revocation clears only trust.
Session enables/disables and capture permissions are never persisted here.
The decision core must still check current native scope, actual instruction
bytes, the exact session grant and adapter/transport capabilities before use.

Every read or mutation acquires an exclusive OS file lock on a stable
`memory-local.lock`. Lock contention immediately returns `Busy`; unsupported
locking returns an error. The lock file is never removed or replaced. The OS
releases the lock on handle close or process exit, avoiding stale PID leases.
Mutations reload under that lock and require the reviewed revision, returning
`Conflict` after any intervening mutation. Callers must reload and review again;
they must not automatically rebase an old acceptance onto a new revision.

Writes validate and serialize first, use an exclusive temporary file in the
same directory, flush its contents, then atomically replace the JSON file.
Unix also syncs the directory. A reported IO failure may occur after replacement;
reload before retrying. This is local-process coordination, not a distributed
lock or a guarantee against external replacement of application state.
Temporary files clean themselves up on normal failures; crash leftovers never
become a source of preferences. Automatic cleanup and crash recovery are pending.

The file lock requires Rust 1.89 or newer. Linux tests cover real disk persistence,
stale-revision rejection, child-process exclusion, independent policy/trust,
corruption/limits, Unix path protections and interaction with the pure policy
core. Windows/macOS/Android runtime qualification remains pending; atomic
replacement and local locking do not claim network filesystem support.

## Initial local reader

`LocalMemoryWorkspace::open` requires an existing local store and a trusted
native `MemoryReadAccess` implementation. It does not initialize preferences or
authorize a directory. Metadata authorization is checked before resolving the
requested path and again for the canonical root. Identity comes from the stored
installation UUID, the actual Unix device or Windows volume and canonical root,
using the shared project-key framing. The directory file identity binds the reader's
lifetime; replacement of the root invalidates observations. Installation changes,
store failures or preference revisions that change during a batch also invalidate
the batch. Callers must capture transport ownership before choosing this API;
serialized environment facts never prove that a remote path is local.

The Unix backend opens each directory component relative to an owned directory
descriptor with `O_NOFOLLOW`. Content-read opens are read-only, close-on-exec and
nonblocking. This prevents symlinks, including replaced intermediate directories,
from redirecting a content read outside the captured tree. Regular files require
a single hard link, valid UTF-8, no NUL and at most 256 KiB. Size, inode and change
timestamps are checked around the bounded read. Native read authorization,
including secret-path rules, is checked before and after reading each file;
directory metadata authorization is checked along the relative path. Missing
paths are `absent`; denied, linked, special, oversized or invalid text is `blocked`.
Failures never become an empty readable file. The authority trait must be
implemented from real native authorization, not caller-supplied IPC booleans.

Deployment observations cover only current manifest targets, `kit.lock.json` and
explicitly selected root links and the AGENTS target dependency of an enabled
CLAUDE link, at most 128 paths and 1 MiB of text. They do not
enumerate or read reserved sessions, tasks or unknown content. Context observations
cover manifest bases, both root rule files, an explicitly assigned bounded role,
configuration and PROJECT/CONTEXT (2 MiB total). The actual instruction snapshot
is checked and hashed by the shared core; a missing or blocked base cannot yield
a partial trusted digest. Configuration is validated against the shipped schema.
This observation does not resolve ancestor/descendant scope or enable a session,
and the returned local preference snapshot is not a lasting authorization.

At most four native batches run concurrently per process; excess work returns
`Busy`. Cancellation and a deadline capped at five seconds are checked between
operations and after reads. A kernel filesystem call cannot be interrupted by
this synchronous API: native integration must use bounded owned workers and an
outer response deadline, and a stalled call must retain its permit until it exits.
The synchronous reader starts no workers. It must not run on the UI thread or on an
unqualified network filesystem. It holds no directory handles between batches.

Observations are bounded point-in-time facts, not a transaction over the tree or
proof of freshness at later delivery/publication. Revalidate current instruction
bytes, scope, consent and destination under the appropriate native exclusion.
App/CLI integration and transport
ownership qualification remain pending. The app's Rust-only authority factory is
documented in `src-tauri/src/modules/project_memory/README.md`. Platforms without a reader explicitly return
`Unsupported` without doing project IO. Linux behavior is tested; Windows,
macOS and Android runtime qualification remains pending.

## Bounded observation workers

`MemoryWorkers::store` opens the private state directory and validates existing
preferences, or explicitly creates the child and initializes identity under
`MemoryStoreMode::Initialize`. The native application supplies the parent path.
It shares the four-operation budget and the same cancellation, original deadline,
queue and settlement ownership as observations. Initialization never resets
corruption, grants workspace access, trusts instructions or creates a kit. An
already admitted initialization may complete after caller retirement; timeout
does not roll it back. A queued retired initialization never starts its IO.
The app's `NativeMemoryStorage` captures the parent solely from Tauri's native
`app_local_data_dir` resolver without performing IO or using a project fallback.
Initialization prepares missing app-directory suffixes through the checked
native chain above; presentation/IPC wiring remains pending.
Opening existing storage never creates that directory or identity,
although loading existing state retains the normal private lock-file behavior.

`MemoryWorkers::scope` and `context` run the existing native readers through the
caller's Tokio blocking executor. They require an entered runtime with its timer
driver enabled; they never create a runtime. All instances and clones share four
process-wide slots. Construction starts no tasks or threads. Admission never waits
for a slot and returns `Read(Busy)` when capacity is occupied. Request paths and
role payload sizes are checked before scheduling; filesystem validation remains
inside the owned blocking worker. No arbitrary task closure is exposed publicly.

Each job captures its private local store, requested directory, native read
authority, optional role and original cancellation/deadline control by ownership.
The native caller must first qualify its local filesystem and transport; this is
not a factory for permissions, a remote adapter or an IPC command. An observation
neither initializes the store nor changes policy, trust, files or session consent.
The app's Rust-only `modules/project_memory` factory captures actual workspace
registry grants and shared secret-path rules. Startup, IPC and CLI wiring remain
pending; callers must still qualify filesystem and transport ownership.

`MemoryJob::finish` observes the original absolute deadline, including time spent
waiting in Tokio's blocking queue and time before the caller starts awaiting it.
Context controls cap that lifetime at five seconds, discovery controls at fifteen.
The worker checks cancellation and expiry before entering the reader and before
returning. The consumer rechecks both around delivery, so an already queued result
cannot become usable after expiry. Missing runtime and missing worker replies
return distinct errors; native reader errors retain their existing classification.

Dropping the job or its unfinished `finish` future retires its consumer and signals
cooperative cancellation. It does not abort or acknowledge an admitted filesystem
call. Queued or blocked work retains its slot and captured authority through
settlement, even after the consumer has timed out or disappeared. Completed but
unconsumed results also retain their slots, bounding abandoned ready payloads.
Receiving or discarding the result releases that slot. These are observation
workers, not a publication executor, OS-thread join or resource-cleanup receipt.
Normal settlement does not cancel a shared control, so later phases can still
use that request's original remaining lifetime.

Native tests cover detached and queued work, abandoned results, deadline delivery,
cancelled consumers, panicking workers and capacity recovery. Linux integration
tests exercise actual disk discovery and context on blocking threads, project
isolation, fresh instruction fingerprints and denied requests without writes.
Windows cross-compilation does not qualify its runtime behavior. App/CLI wiring,
selection ownership and authenticated remote execution are still pending.

## Windows handle reader

The Windows backend accepts absolute local disk paths, including verbatim disk
paths. It rejects UNC, device/pipe namespaces, alternate data-stream root names
and mapped network drives before canonicalizing project paths. The final path
reported by the captured root handle must also name a local disk. These checks
do not qualify network filesystems or grant transport ownership.

The reader uses documented directory-relative
[`NtCreateFile`](https://learn.microsoft.com/en-us/windows/win32/api/winternl/nf-winternl-ntcreatefile)
opens with exactly one component and `FILE_OPEN_REPARSE_POINT`, checking each
returned entry for a reparse attribute before proceeding. It does not rely on
absolute prefix checks or `OBJ_DONT_REPARSE`. The root drive is opened through
its native DOS device name; subsequent lookup stays relative to captured handles.
Directories request metadata/traverse access, files request read access, all
handles are noninheritable, and none allow write/delete sharing. The objects stay
owned until the batch ends. Sharing flags alone are not a no-reparse guarantee:
attribute-only operations may bypass write sharing, so child lookup must remain
relative to handles rather than reconstructing an absolute path.

`FileCaseSensitiveInfo` selects native name-lookup case behavior per directory;
unknown flags or unavailable queries fail, without guessing a case policy.
[`FILE_ID_INFO`](https://learn.microsoft.com/en-us/windows/win32/api/winbase/ns-winbase-file_id_info)
provides the actual volume serial and full 128-bit file ID; legacy 64-bit IDs
are not substituted. File type, link count, size, reparse/delete flags and
creation/write/change timestamps are checked around reads. Both the requested
path and the normalized opened-handle path need native read authorization before
content is read and again afterward, including when names resolve through a case
alias. Unsupported metadata
queries fail rather than weaken identity or freshness checks. This requires
a local Windows filesystem/version that implements these queries; older Windows,
FAT, redirectors and third-party filesystems are not qualified.

`GetFinalPathNameByHandleW` supplies normalized native root spelling. The shared
dependency-free `voktty-paths` utility applies the app's existing display rules
without changing case: Windows verbatim prefix removal and slash conversion,
with literal backslashes preserved on Unix. `fs::to_canon` delegates to this same
utility. Changing the captured root spelling invalidates the binding.
Canonical roots are capped at 128 components and 4 KiB UTF-8.

Nine Windows regression tests cover real identity/context bytes, preview,
junctions/hardlinks, invalid text and size, authorization, root replacement,
rename refusal while handles are owned, namespace refusal and cancellation.
They cross-compile on Linux; that is not evidence of Windows runtime behavior.
Run them on native Windows before claiming platform qualification. The junction
fixture operates only on its own temporary directories and requires local
filesystem support for mount-point reparse data.

## Native scope discovery

`observe_scope` collects real observations and invokes the shared scope resolver.
`Discover` inspects the requested directory and its authorized ancestors, without
walking project children. `Initialize` and `Manage` additionally scan descendants
of the captured execution root. This is an explicit operation, with no watcher,
automatic deployment, provider call or session activation.

Metadata, content reads and directory enumeration have distinct native authority.
`MemoryReadAccess::allows_enumeration` defaults to false; metadata permission
alone never grants listing. Each entry also requires metadata authorization.
Only bounded `kit.json` configuration text is read for classification; factual
documents, root agent rules, session/task contents and unknown file data are not
loaded. A schema-valid configuration marker identifies a kit for scope discovery;
instruction/layout integrity remains a separate requirement for context use.
Absent markers with only the known runtime entries are reserved, other unmarked
kit data is partial, and malformed, denied or unavailable markers block use.
The unmarked kit-directory classification inspects at most 128 entries.

Ancestors stay within the observed filesystem, at most 128 directories and five
seconds including final verification. An authorized parent with a different
native device/volume establishes the filesystem boundary; its metadata identity
is rechecked without reading its kit. Missing authorization cannot establish
that boundary or prove absence. Candidate keys come from actual directory
metadata and the local installation identity, with no synthetic key for a link
or inaccessible directory. Diagnostic blocked paths are inspection hints.

Explicit descendant scans visit at most 20,000 metadata entries, depth 64 and
1,024 findings, within ten seconds. Symlinks/reparse points, repeated directory
identities, cross-volume subtrees, denied entries, errors and exhausted budgets
make the scan incomplete. Entries observed while classifying kit directories
also consume the entry budget. Reaching a limit stops without silently dropping
findings and declaring completion. Configuration text has a separate 1 MiB
successful-phase budget, with at most one 256 KiB bounded read before a byte-limit
failure is detected. The full request shares a fifteen-second response budget
and the reader's four-operation process limit; kernel-call limitations still apply.

Unix uses `fdopendir`/`readdir` on owned descriptors and non-following `fstatat`.
Windows reopens a captured directory object with listing rights, then parses
bounded, aligned
[`FILE_ID_BOTH_DIR_INFO`](https://learn.microsoft.com/en-us/windows/win32/api/winbase/ns-winbase-file_id_both_dir_info)
records with checked offsets and name lengths. Neither backend enumerates by
reconstructing an unpinned absolute prefix. No ignore file affects discovery.
Classified kit-data folders are pruned; Git and dependency directories are not
pruned by name. Large or linked trees can therefore remain unverified until a
native owner can prove an exclusion or a narrower execution root is selected.

Directory changes during traversal invalidate the scan. The starting root's
classification must agree across phases, and ancestor identities/classifications
are rechecked before returning verified absence or a usable parent. A kit created
between ancestry and descendant phases cannot yield clear initialization.
The final workspace binding and installation/preferences are checked again.
Cancellation, expired requests and replaced bindings never return a usable scope.
These are point-in-time checks: publication must repeat discovery under native
destination exclusion, and external writers can still change the tree afterward.
The core's `clear` classification remains separate from write authorization.

Linux tests exercise real scopes, sibling/nested kits, reserved and invalid
states, explicit enumeration permission, phase races, links, cancellation and all
scan budgets. Windows tests cross-compile; native Windows, macOS and Android
qualification remains pending. Authenticated remote discovery is not wired yet.

## Publication exclusion

`LocalMemoryStore::try_lock_deployment` returns an opaque owned OS lock or
immediately fails with `Busy`. It uses one stable `memory-deployment.lock` in
the private application directory, covering all cooperating publishers in this
installation. Serializing all destinations also excludes overlapping parent and
child initialization; a lock keyed only by the chosen path would not do that.
No repository path, environment identity string or caller-provided lock name
selects this lock. The file is neither truncated nor removed. Handle close and
process exit release exclusion without a stale PID lease or an expiry that
could allow two live writers.

The deployment lock is separate from the preferences lock: native discovery,
preference reads and revocation can still run while publication is excluded.
Acquiring it does not initialize an installation UUID, capture a preference
revision, authorize any project access or attest to a preview. The publisher
must revalidate current preferences, originating cwd, destination scopes,
native write permission and accepted bytes after acquisition and immediately
before writing. It must not hold the lock during user review. An owned worker
must retain it until every filesystem operation settles, including after an
outer response timeout. The synchronous lock attempt does not wait for another
holder, but opening the lock still has the local-filesystem syscall limitations
described above.

This is coordination within one application state directory, not protection
against another installation, an external editor, another host or an owner
replacing application state. It is not the repository's `kit.lock.json` integrity
record or the future shared-memory capture lock. Linux tests exercise separate
process contention, abrupt exit, killing only an owned holder, stable lock bytes
and Unix unsafe entries. Windows tests cross-compile; runtime qualification and
the Windows publication writer remain pending.

## Initial native publication

`InitializationPreview::prepare` captures an existing native originating cwd and
chosen destination, renders the embedded template and prepares the shared plan
from actual bytes. Both workspaces must use the same private application state
directory. Under publication exclusion it checks both ancestor scopes and scans
destination descendants. The preview is an opaque native object with immutable
plan access, not a deserializable webview plan. It expires after two minutes and
is consumed by `publish`; changing cwd/transport selection must also retire the
owner's request. Integration still needs that native selection/worker lifecycle.
The lock is released before user review and reacquired for publication.

`InitializationPreview::into_owned` retains that exact review for later native
confirmation. It requires the original `Arc` allocations for the store and each
read authority; reopening the same store or supplying equivalent grants is
rejected. `OwnedInitializationPreview` preserves the captured native root
identities, preference revision, proposed bytes, recovery artifacts and original
two-minute deadline without reopening, rerendering or renewing acceptance. It is
neither cloneable nor deserializable. Its consuming `publish` delegates to the
same validation and writer below, using the retained read authorities and a
separate native write authority. Authority retirement still prevents publication.
The owning presentation must discard its review on selection retirement; retaining
it alone is not a session permit or a publication worker. IPC and bounded worker
integration remain pending.

Publication rechecks both native directory identities, installation UUID,
preference revision, scopes and exact expected bytes. `MemoryWriteAccess` is an
independent native authority for creating files and directories, including secret
paths; metadata/read grants do not imply writes. Files are written only at paths
from the native rendered plan. The Unix writer supports `create` and `skip`.
Linux/Android also implement the known private-ignore and root-rule migrations
described below. Other Unix targets expose `MigrationUnsupported` through
`publication_blocker` and reject migrations before project writes. Windows
supports `create` and `skip`; its migrations still return `MigrationUnsupported`
before project writes. Windows runtime qualification remains pending.

Unix creates missing directories relative to owned descriptors without following
links and refuses cross-device parents. A unique exclusive temporary file in the
target directory receives complete, synced bytes. `linkat` then publishes it
without replacing any existing file, link or special entry; a racing target wins
and the operation fails. Root and parent identities are checked again before
publication. Normal staging cleanup checks the owned entry identity and never
rolls back a published project target. The directory is synced after creation.
Root-rule files are selected only by their explicit opt-ins. Reserved runtime
files and unknown files are not overwritten or deleted.

The Windows creator opens missing directories and exclusive staging files with
directory-relative `NtCreateFile`, retaining ancestor and parent handles without
write/delete sharing. It checks both requested and normalized handle-parent
paths against native authority, rejects reparse points and cross-volume parents,
and flushes complete staging bytes before publication.
[`NtSetInformationFile`](https://learn.microsoft.com/en-us/windows-hardware/drivers/ddi/ntifs/nf-ntifs-ntsetinformationfile)
with `FileRenameInformation` renames that owned staging object relative to the
captured parent, with replacement disabled. A racing target, case alias or link
is preserved. Before rename, it rechecks root/parent identities, staging metadata,
authority and cancellation. Normal failure cleanup requests disposition only on
the exclusively created staging handle; it never deletes a re-looked-up path or
an already published target. Files are flushed again after rename; no Windows
directory-flush or power-loss durability guarantee is claimed. A crash or failed
staging disposition can leave an unknown staging entry for explicit recovery.

Windows-specific regression sources cover exact publication and idempotence,
partial intent recovery, racing files/case aliases/hardlinks, parent rename
refusal, late permission denial and rejection of unsupported migrations before
writes. Cross-compilation is not execution of those tests or native platform
qualification. The writer remains unwired to application, IPC and CLI consumers.

Before the first project change, a bounded, private `memory-deployment.json`
records native cwd/destination keys and file identities, and the exact proposed
inventory. Schema 1 creation-only records remain supported. Schema 2 records
migrations with their original bytes and a validated UUID v4 transaction identity;
schema/version mismatches fail without reset. The record is exclusively published and synced under the
deployment lock. It is not workspace authority or a stored acceptance. A retry
requires a fresh native preview with exactly matching intent and current bytes;
only that intent can admit its own partial root. Foreign partial layouts remain
blocked. Unknown versions/fields, malformed or oversized records fail without
reset. One pending intent blocks unrelated publication in that installation;
explicit abandonment/export UI remains pending. The size limit is 2 MiB,
including JSON escaping, at most 128 files. Project file and observation limits
still apply. Recovery records can contain project text and stay in private state.

The writer rescans scopes and verifies all other selected files before publishing
`kit.json` last. It verifies the completed inventory and scopes again before
removing its private intent. Skipped files are never rewritten. Failures preserve
all published targets and foreign changes; no blind rollback removes them. The
failure's `created` and `migrated` lists contain acknowledged operations, not proof
that an IO failure left no additional file. An error can occur after marker publication
or state cleanup; reload before retrying. A crash can leave staging entries;
they are preserved as unknown files, with automatic cleanup/recovery UI pending.

Checks are point-in-time observations under local cooperating-writer exclusion,
not a transaction against an external editor or host. External changes after a
check can invalidate the result; final checks report conflicts without deleting
those changes. Native integration must retain the worker/lock through settled IO,
provide an outer response deadline and avoid unqualified network filesystems.
Linux tests cover exact bytes, idempotence, restart of native objects, partial
recovery, reserved bytes, fresh write authority, preference changes, cancellation,
root/installation replacement, scope races, competing targets, links and corrupt
intent. They use a real local device boundary for complete ancestry without
reading host kit contents. Windows compilation does not qualify runtime behavior;
Unix platforms other than Linux also require runtime validation.

## Known native migrations

Only `.voktty/.gitignore`, `AGENTS.md` and `CLAUDE.md` can be replaced through this
API, using proposals and exact expected bytes from the shared native preview.
`MemoryWriteAccess::allows_replace` and `allows_remove_staging` both default to
false; creation permission never grants either operation. An opt-in CLAUDE link
can observe an existing AGENTS dependency without selecting it for modification.

Linux/Android stage complete synced bytes and use directory-relative
[`renameat2(RENAME_EXCHANGE)`](https://man7.org/linux/man-pages/man2/rename.2.html).
The actual displaced entry stays at a recovery name derived from the recorded
transaction and native inventory index. There is no fallback to an overwriting
rename when exchange is unsupported. The writer checks regular-file identity,
single link, expected text, root/parent binding and authorization before exchange,
then verifies the displaced and published entries afterward. A late replacement
or in-place edit is retained at the recorded recovery path. The target can already
contain the proposed version when that race is detected; the operation reports
recovery and does not blindly exchange it back or delete the displaced version.

Ownership, group and ordinary mode bits are preserved. The native backend copies
visible extended attributes, including readable ACL attributes, and verifies them
before and after publication. Attribute names and values share a 64 KiB budget,
with at most 128 attributes. Privileged mode bits, file capabilities, unavailable
attribute queries or metadata that cannot be reproduced fail before exchange.
The kernel can omit inaccessible attributes from
[`flistxattr`](https://man7.org/linux/man-pages/man2/flistxattr.2.html); this does
not qualify filesystems with hidden mandatory metadata or claim a full security
descriptor clone. Native platform/filesystem qualification remains required.

Migration recovery entries are recorded before the first project change. A fresh
preview exposes existing known artifacts through `recovery_files`, containing
their relative paths and actual text. Only a complete staged proposal or the
recorded original is eligible for explicit native staging cleanup. Foreign,
linked, unreadable or changed recovery entries yield `RecoveryRequired` and are
preserved. `possible_recovery_files` on failure lists candidate names, not proof
that each exists. Cleanup rechecks bytes, object identity, root/parent binding and
its distinct removal grant; it never rolls back a project target. A stopped
operation can resume from a recorded proposal before exchange or a displaced
original after exchange with a new concrete preview. On retry, a displaced
original remains at its recovery path until the complete inventory and scopes
verify, including across another interrupted attempt. Only a recorded proposal
stage is removed before publication. An original whose target is no longer the
recorded proposal requires explicit recovery; neither copy is deleted or
automatically migrated again. Unrecognized creation-stage
leftovers and explicit conflict export/abandonment UI remain pending.

Linux tests exercise the three real migrations, CRLF/Unicode outside root blocks,
reserved binary data, mode/owner/group and user attributes, idempotence, recovery
before/after exchange, invalid transaction IDs, cleanup denial/edits and late
foreign replacements/in-place writes. Android shares the implementation but has
not been compiled or run here. Other Unix replacement backends and native Windows
migrations remain pending.
