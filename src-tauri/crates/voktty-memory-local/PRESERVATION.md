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

The qualified preservation inventory includes the six required PROJECT, CONTEXT, plan index,
tracking, changelog and archive LOG documents; immediate Markdown plans and
domain cards; immediate handoffs; and Markdown files recursively beneath valid
`archive/YYYY-MM/` directories. Static `README.md` guides are excluded from the
live directories and archive root. `_TEMPLATE.md` is excluded only from plans
and domains. Names remain case-sensitive. Archived README and template bodies
are factual data and remain included. Unsupported nested live directories,
archive-month names, non-UTF-8 names and mixed-case Markdown extensions fail
explicitly instead of silently reducing the inventory. Other non-Markdown files
are outside this factual channel.

This is the existing pure preservation channel, not a complete inventory of all
shared kit content. Architecture cards, rituals, external assignments, roster
data and custom roles are not classified by that pure snapshot contract and are
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
20,000 total enumerated entries, 256 UTF-8 bytes per entry name, 4 KiB relative
paths and fewer than 64 directory components. The pure snapshot also enforces
its Markdown and item-occurrence limits. Configuration has its separate native
per-file limit.

Capture shares the existing four-reader budget and original discovery deadline
and cancellation. It rereads every selected document and configuration, repeats
scope discovery, verifies pinned directory revisions and identities, and rechecks
read/enumeration/root authority and installation identity before returning.
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
