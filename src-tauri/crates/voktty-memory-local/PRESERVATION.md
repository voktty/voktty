# Native factual-memory observations

`LocalMemoryWorkspace::observe_preservation` captures an opaque
`NativeMemoryPreservation` from the exact native memory root. The workspace
must already have an existing installation identity and native read authority.
The shared ancestor resolver must report that same root as ready; an execution
subdirectory must first resolve and open its actual memory root. This API does
not initialize private state, authorize paths, trust instructions or enable capture.

The observation retains exact configuration and document bytes, the pure
preservation snapshot, installation/filesystem/path identity and the native
project-root instance. Its fields are private, it has no deserializer or public
constructor, and immutable accessors expose comparison inputs. It is owned by
the synchronous native caller, without a registry or persisted receipt.
`validate_preservation_binding` checks its original root and installation against
the caller's current native workspace. That check does not establish that file
contents remain unchanged or authorize use of the retained bytes by another owner.

The qualified preservation inventory includes the six required PROJECT, CONTEXT,
plan index, tracking, changelog and archive LOG documents; immediate Markdown
plans, domain cards, architecture standards, rituals and external assignments;
immediate handoffs; and Markdown files recursively beneath valid
`archive/YYYY-MM/` directories. Static `README.md` guides are excluded from the
live directories and archive root. `_TEMPLATE.md` is excluded from plans, domains,
architecture, rituals and external assignments. Names remain case-sensitive.
Archived README and template bodies
are factual data and remain included. Unsupported nested live directories,
archive-month names, non-UTF-8 names and mixed-case Markdown extensions fail
explicitly instead of silently reducing the inventory. Other non-Markdown files
are outside this factual channel.

This is the existing pure preservation channel, not a complete inventory of all
shared kit content. Roster data, instruction bases and custom roles are not
classified by that pure snapshot contract and are
not inspected here. Their preservation must be qualified before a composed
checker can claim the plan's whole-memory acceptance criteria. An empty report
from this channel cannot certify those other shared files.

No enumeration or body read enters instruction bases, team configuration,
runtime state, mailbox or lock directories. Metadata checks performed by shared
scope discovery retain their existing independent contract. The native caller
must supply metadata, read, enumeration and workspace-root authority separately;
every read retains secret-path protection and the existing platform reader.

Directory handles pin membership and identity, reject cross-filesystem children
and never follow symlink/reparse directories. Relevant symlink, special, missing,
blocked, oversized or invalid UTF-8 files cannot produce a partial baseline.
The shared readers enforce the per-file 256 KiB limit. Inventory limits are
128 factual documents, 4 MiB aggregate document bytes, 128 scanned directories,
20,000 captured enumeration entries, 256 UTF-8 bytes per entry name, 4 KiB relative
paths and fewer than 64 directory components. The pure snapshot also enforces
its Markdown and item-occurrence limits. Configuration has its separate native
per-file limit.

Capture shares the existing four-reader budget and original discovery deadline
and cancellation. It rereads every selected document and configuration, repeats
scope discovery, verifies pinned directory revisions and identities, and rechecks
read/enumeration/root authority and installation identity before returning.
Every scanned directory is enumerated again, comparing its exact entry names and
types independent of listing order. Directory timestamps alone cannot establish
unchanged membership. Each recheck is bounded to the captured count plus one;
an incomplete, enlarged, renamed or type-changed listing rejects the capture.
Captured membership metadata shares the existing 20,000-entry and name-size
bounds and exists only for the duration of the native observation.
Verification performs another bounded enumeration pass: across all directories
it visits at most the captured 20,000 entries plus one extra entry per directory
before rejecting an enlarged listing. Both passes share the original deadline.
External changes observed during those checks reject the capture. This is a
bounded observation, not an atomic filesystem transaction, exclusive compaction
lock, protection from privileged metadata forgery or cancellation of a kernel
call already in progress. Existing Windows, Apple and unsupported-platform
reader qualification boundaries remain unchanged.

The object supplies native origin for future composed checking, but it is not a
compaction verdict. No comparison composer, persistence, IPC command, CLI check,
writer, archive operation or restoration is introduced. A future consumer must
retain its original native owner, validate both observations' binding, use actual
clock/configuration, compose every preservation diagnostic, and coordinate writes
before accepting compaction. The pure contract is documented in
[`voktty-workspace-kit/PRESERVATION.md`](../voktty-workspace-kit/PRESERVATION.md).

## Protected shared capture

`observe_shared_preservation` uses the same captured workspace, native reader,
discovery, ownership and verification path while also hashing protected shared
files. Its `protected()` accessor returns the separate pure protected snapshot.
The legacy factual-only method returns `None`; that absence must never be treated
as a successful protected check by a future comprehensive consumer.

The shared method enumerates the kit root and its known factual directories,
`capture/`, `team/` and `team/roles/`. It observes fixed packaged bases, configuration,
roster, integrity lock and both root-rule paths, plus qualified extra roles,
capture instructions and static templates. Unknown files, unsupported layouts,
symlinks and reparse points fail rather than silently shrinking this inventory.
The fixed path list is supplied by the packaged pure core, never repository data.
The pure protected contract is in [PROTECTED.md](../voktty-workspace-kit/PROTECTED.md).

The root listing may inspect metadata for reserved `state`, `mailbox`, `locks`,
`sessions`, `tasks`, `tasks.json`, `tools.json`, `servers`, `shell-integration`,
`proc`, `extensions`, `history.json` and `trusted-roots.json` entries, but shared capture never
enumerates their descendants or reads their bodies. Root-rule capture observes
only `AGENTS.md` and `CLAUDE.md`, not other project files. Every protected read,
including absence, requires its own native read grant. Metadata grants do not
substitute for enumeration, read or workspace-root authority.

Ancestor discovery recognizes directories named `servers`, `shell-integration`,
`proc` and `extensions`, and regular files named `history.json` and
`trusted-roots.json`, as runtime data when no kit configuration is present. These are the
SSH helper, shell integration, supervised-process, extension, history and
workspace-trust storage locations, not
project memory. It does not enumerate their contents. Links remain unavailable,
entries of the wrong type remain partial, and instruction files or invalid
kit configurations still block initialization. Deployment and base-integrity
records reject these reserved paths, including case variants.

Factual and protected observations share the existing 128-file and 4 MiB body
budgets; absent fixed protected paths count toward that combined file limit.
Directory and enumeration limits remain shared as well. Protected bodies are
reread and compared before return; root configuration must also match the original
scope read. Final source, enumeration and root authority checks still apply.
Temporary protected read bodies are discarded after validation and hashing. The returned object
exposes their hashes and sizes, without an instruction-body getter or serialization
of the native object. Existing configuration and factual source accessors retain
their contract; the original validated configuration remains available separately.

Hashing accepts opaque roster and instruction text without interpreting it;
native scope still requires its existing valid kit configuration. No preference,
trust, session, capture permission or provider state changes. This is bounded
point-in-time evidence, not an atomic snapshot, compaction lock, persisted baseline
or complete compaction verdict. No current UI, worker or CLI is wired to the new
method. A future composer must require this shared observation explicitly, check
both original bindings and every protected and factual diagnostic, and coordinate
writers before accepting compaction.

## Native composed checking

`LocalMemoryWorkspace::check_preservation` accepts only a native baseline with
the protected shared observation present. Factual-only baselines reject before
new document reads. The baseline must match the caller's installation, filesystem,
canonical project root and native root instance under current native authority.
The method captures a fresh shared current observation itself; callers cannot
substitute an old or fabricated after-snapshot.

The archive threshold comes from that current native configuration, and Unix
milliseconds come from `SystemTime`, not repository metadata or caller-provided
dates. Protected configuration changes remain issues even when the new threshold
is syntactically valid. The shared pure composer rebuilds factual evidence and
retains every component result and negative diagnostic. Its contract is in
[CHECK.md](../voktty-workspace-kit/CHECK.md).

Archive-age integers follow JSON Schema numeric meaning: `30`, `30.0` and `3e1`
all represent the same allowed threshold. Conversion requires a finite integral
value within 1 through 36500; capture never rewrites its original JSON spelling.

One original reader permit covers root validation, current capture, composition
and final root/installation/authority revalidation. Private capture and binding
helpers reuse that permit instead of consuming nested reader slots. Original
discovery cancellation and deadlines apply through settlement; failure returns
no partial report. Native bodies, source limits, sensitive-path controls and
the existing platform reader restrictions remain unchanged.

The method does not write, persist a baseline, obtain an exclusive compaction
lock, create trust or deliver instructions. Its report is a bounded observation,
not an atomic filesystem transaction or reusable authorization. Another writer
can still change files after observation. No IPC, CLI, worker or automatic
compaction flow is connected to this API yet.
