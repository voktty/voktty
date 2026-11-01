# Pure memory preservation baseline

`snapshot_memory_preservation` and `snapshotMemoryPreservation` consume an
explicitly complete inventory of actual file facts supplied by a native reader.
They do no filesystem IO and grant no authority. Incomplete inventories, missing
required files, absent/blocked facts or incomplete Markdown inspection cannot
produce a baseline. The caller must establish completeness, authorization and
the original project binding; a repository or IPC boolean is not that evidence.

Paths are normalized, case-preserving, kit-relative factual Markdown paths:
PROJECT/CONTEXT, the plan index/tracking and individual plans, domain cards,
the continuity changelog, handoffs, archive records and `archive/YYYY-MM/` data.
Reserved runtime directories, instruction bases, root rules, absolute paths,
traversal, control characters and ambiguous URL/path characters are rejected.
The six fixed factual/index/log files are required even if they are empty.
Unknown Markdown layouts require explicit qualification rather than silent omission.

The inventory is bounded to 128 files, 4 MiB total UTF-8, 256 KiB per file,
8,192 item occurrences and 64 ASCII bytes per ID. Paths have at most 64
components and 4,096 UTF-8 bytes. The existing shared Markdown inspector ignores
code fences, inline code and comments, retaining every other ID occurrence and
its line/state. Conflicting or unclosed parse state fails explicitly.

Each schema-1 snapshot contains scalar-sorted paths, derived live/history/archive/
record classification, SHA-256 of the exact UTF-8 text, byte size, syntactic item
occurrences and the recognized state of individual live plans. It contains no
complete document text, machine identity or authorization. Unknown plan states
are conservatively nonclosed. Individual plans recognize only the canonical
`State` field. A field such as `Owner: closed` cannot close a plan; unqualified
translated field labels remain unknown until explicitly supported. The generic
text inspector retains its existing behavior for other consumers.
The TypeScript implementation captures all input
bytes and inspection facts before asynchronous hashing and freezes its results.
These are comparison values, not persisted receipts; no deserializer or native
baseline persistence is exposed yet. A hash alone cannot authenticate a snapshot.

`compare_memory_preservation` and `compareMemoryPreservation` report missing
live items, missing items anywhere live/archived and missing nonclosed live-plan
paths. An ID with any open live occurrence must remain in a live file, even if
another occurrence was marked done. A formerly open item can become done while
staying live. Historical handoff references and archive LOG references cannot
rescue a lost live obligation; existing archived IDs must also survive.

This comparison is one part of the future compaction checker, not its verdict.
It checks syntactic presence, not preservation of an item's meaning or reasons.
It does not validate plan-index links, unchanged moved-file bytes, archive LOG
movement records, authentic baseline origin or native inventory completeness.
Empty diagnostic lists must never authorize compaction, archival or restoration.
Those remaining checks and native ownership must be composed before exposing
`memory check` or accepting an automatic compaction result.

## Qualified plan-index links

`check_memory_plan_index` and `checkMemoryPlanIndex` compare the supplied index
bytes with the snapshot's `plans/INDEX.md` hash before examining links. They
report linked plans, nonclosed plans missing from the qualified link channel,
local plan links absent from the complete snapshot, and one-based unverified
line numbers. `complete` describes syntax qualification; missing or unavailable
plans can still be reported when it is true. A consumer must inspect all these
fields. This component alone never approves compaction.
Any unverified syntax retires all positive link evidence in that report, including
links encountered before an unsupported container or markup fragment.

The qualified channel is inline Markdown links with a local relative destination,
optional fragment and simple unescaped quoted title. Angle destinations support
spaces, balanced parentheses are bounded to depth 16, and UTF-8 percent encoding
is decoded strictly. Plain relative `.`/`..` segments resolve from `plans/` without
escaping the kit. Encoded traversal or separators, namespaces, absolute paths,
queries, controls and ambiguous raw URI characters remain unverified. Paths and
membership preserve scalar ordering and case; native filesystem aliases require
their own qualification. HTTP(S) links and self fragments never establish plan
membership or cause network access. Images and links to static guide/index files
do not count as plan entries.

The shared streaming visibility lexer excludes fenced/inline code and comments
without retaining all visible lines. Ambiguous reference, nested-label, HTML,
multiline and indented syntax cannot create a complete qualified report.
Quoted or nested container forms can also remain unqualified. The
[CommonMark container and tab rules](https://spec.commonmark.org/0.31.2/)
motivate these conservative qualification boundaries. Additional valid
Markdown forms therefore require explicit qualification; the
component does not claim to implement all CommonMark or rendering extensions.
Limits are 256 KiB of index text, 1,024 link tokens or unverified lines, and
4,096 UTF-8 bytes per destination body. Reaching a limit fails explicitly.

## Whole-file archive evidence

`compare_memory_archive_files` and `compareMemoryArchiveFiles` compare two
complete snapshots. They identify exact whole-file moves from removed handoffs
or closed plans with no syntactically open item to newly created immediate
`archive/YYYY-MM/<original filename>` destinations. Both SHA-256 and UTF-8 byte
size must match. Historical handoff references do not prevent archiving a
handoff; they are history rather than live obligations. Unknown or nonclosed
plans and other live files cannot qualify as whole-file archival sources.

An existing archive cannot rescue a deletion. Multiple matching new targets or
multiple removed sources claiming the same target are ambiguous and produce no
movement evidence for those sources. Renaming, nesting, case changes, newline
conversion and content rewrites cannot substitute for an intact file move.
Reports retain missing or changed old archives, rewritten retained handoffs,
unpreserved eligible sources, ambiguous sources, ineligible removals and every
new archive without uniquely attributed whole-file evidence. All output paths
use Unicode scalar ordering. The TypeScript mirror freezes report values.
The existing snapshot limits bound the comparison to 128 files per inventory;
the comparison performs no IO, hashing, extra document reads or mutations.

`moves` proves only byte equality and unique path attribution within the supplied
inventories. It does not prove that an archival age threshold was reached, that
the destination month is historically correct, that the move has a LOG record,
that live backlinks survived, or that the snapshot origin is authentic. It never
authorizes a move. Newly appended closed-item fragments remain unattributed and
changes to existing archive files remain explicit diagnostics until a separate
fragment verifier establishes intact prior content and append-only preservation.
Empty diagnostics do not approve compaction. Movement LOG records, age/month
qualification, fragment checks, baseline authenticity and native ownership remain
required before exposing an integrated checker.
