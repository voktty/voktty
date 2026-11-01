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
