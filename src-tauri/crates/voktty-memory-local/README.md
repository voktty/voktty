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
descriptor with `O_NOFOLLOW`. All file opens are read-only, close-on-exec and
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
explicitly selected root links, at most 128 paths and 1 MiB of text. They do not
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
No workers are spawned here. The reader must not run on the UI thread or on an
unqualified network filesystem. It holds no directory handles between batches.

Observations are bounded point-in-time facts, not a transaction over the tree or
proof of freshness at later delivery/publication. Revalidate current instruction
bytes, scope, consent and destination under the appropriate native exclusion.
Publication, App/CLI integration and transport
ownership factories remain pending. Other platforms explicitly return
`Unsupported` without doing project IO. Linux behavior is tested; Windows,
macOS and Android runtime qualification remains pending.

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
the actual publication writer remain pending.
