# Native memory origin and reviewed migration

`resolve_memory_application_parent` receives the native local application-data
base, never repository configuration, a webview path or a remote request. CLI
and SSH helper use the fixed `app.voktty.voktty` application identifier. Desktop
uses its existing matching native origin. The resolver creates no directories
or identity and does not grant filesystem, instruction or session authority.
Callers still qualify the complete application chain before state IO.

Legacy `dev.voktty/project-memory` normally blocks state-dependent operations,
even if empty, corrupt, linked or inaccessible. An unsafe legacy application
parent also blocks. There is no automatic move, merge, deletion, preference
reset or transfer of Always/trust to a new identity. A normal legacy application
directory without a memory entry does not block unrelated canonical state.

## Explicit migration

Linux/Android expose `OriginMigrationReview`. Other platforms retain refusal;
there is no ordinary-rename or copy fallback. Native Windows/macOS and Android
runtime qualification remain required. The API's base has the same native-origin
precondition as the resolver. It does not accept a selected project or an
arbitrary source/destination pair. CLI supplies the native data resolver.

Preparation opens existing qualified legacy state and acquires the existing
deployment and preference locks without waiting. It may create those ordinary
lock files but never initializes preferences or a destination. Both actual lock
inodes must match the captured directory inventory. Locks release before the
caller displays its review. The review retains captured handles and a 120-second
lifetime. Its digest binds the native base, directory birth instances, exact file
bytes/hashes/identities/modes/ownership, destination state and sanitized summary.
Preview does not disclose installation IDs, project keys or file bodies.

Only `memory-local.json`, `memory-local.lock`, `memory-deployment.json` and
`memory-deployment.lock` may be present. Enumeration is bounded to five entries;
unknown entries and temporary files block migration without cleanup. Preferences
are bounded to 256 KiB and validated through the existing schema and root-binding
rules. Their summary must match the same bytes hashed in the inventory. Other
entries are bounded to 2 MiB each. The journal is preserved opaquely; migration
does not certify or resume its project publication. Files must remain regular,
single-link, owned and not shared writable. Directories and the complete chain
retain native local-filesystem, ownership, permission and no-link checks.

Acceptance consumes the review, checks its digest/lifetime and reacquires both
locks. It captures and compares all facts before preparing the canonical
application parent. Existing destination memory directories, including empty
ones, block; no installation is merged or replaced. All paths must report the
same native device. The application parent's unrelated files remain untouched.

The destination reservation is a complete synced private JSON file, at most
4 KiB. A unique descriptor-owned staging file is published with
`renameat2(RENAME_NOREPLACE)`. Normal cleanup removes only its exact original
staging inode. An abrupt exit may preserve an unreferenced staging file in the
application parent, without occupying the fixed memory path or blocking retries.
The reservation binds the original store and both application-parent birth
instances. A complete reservation left before exchange is accepted only after a
new explicit review of the current source and pending destination.

After final revalidation, one descriptor-relative
`renameat2(RENAME_EXCHANGE)` swaps the legacy directory and canonical reservation.
The original directory, files, locks and metadata become canonical without
copying or rewriting bytes. The reservation becomes a permanent legacy marker.
Old writers encounter a file at their directory path and cannot recreate or
update the legacy store. Both parents are synced and the resulting origin is
checked again. Native locks cover admitted cooperating operations; this does
not claim a transaction against arbitrary owner-controlled filesystem changes
or power-loss guarantees beyond the filesystem's synchronization behavior.

The resolver accepts that marker only after private single-link file checks,
strict bounded schema parsing and matching canonical store and parent instances.
Replacing the directory or parents invalidates it. Ordinary preference updates
do not invalidate it. The marker grants no authority by itself; normal native
state and root-instance checks still apply. It must remain in place to fence old
writers. Malformed or foreign markers are preserved and blocked.

Failure reports distinguish possible application-parent preparation, an
acknowledged reservation publication and an acknowledged completed exchange.
Cancellation, expiry, changed facts or IO can leave such effects. No destructive
rollback is attempted; obtain a new review. A moved journal remains subject to
its normal installation, project, preference and exact-original validation.
Migration changes no project files, policy values, trust values, session grants,
model context or capture permission.
