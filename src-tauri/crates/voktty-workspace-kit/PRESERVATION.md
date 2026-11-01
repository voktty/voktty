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

## Appended archive LOG records

`check_memory_archive_log` and `checkMemoryArchiveLog` bind both supplied LOG
texts to their respective snapshots by exact SHA-256 and byte size. The new
text must retain the entire old text as a byte-identical prefix. When the old
text has no final LF, an append must first add LF or CRLF. Historical records never
credit a new operation, including a historical last line completed by that newline.
Only records wholly within the appended suffix count.

The qualified channel consists of raw tab-separated records in `archive/LOG.md`.
Fields have fixed positions, with no escaping, optional columns, duplicate keys,
path normalization or URI decoding. Each record occupies one physical line,
begins in column zero and has one of these layouts (`TAB` means a literal tab):

- `VOKTTY-MOVE-1 TAB date TAB agent TAB source TAB target TAB bytes TAB sha256`
- `VOKTTY-SIZE-1 TAB date TAB agent TAB path TAB beforeBytes TAB afterBytes`

These are raw records, independent of Markdown rendering. Fences, HTML comments
and other rendering constructs do not hide a literal record from this channel.
Keep protocol examples outside the LOG. Within newly appended text, `VOKTTY-`
is reserved: a line containing it that does not conform
to a supported record is an invalid line. Historical prose remains untouched;
new ordinary prose and blank lines are allowed. LF and CRLF records are supported.

Dates use the shared calendar validator, `YYYY-MM-DD`, from 1970 through 9999.
The claimed agent is 1 through 64 ASCII letters/digits/dots/underscores/hyphens,
beginning with a letter or digit. Dates and names are syntactic metadata, not
authenticated authorship, proof of timing or archival age. Counts are canonical
ASCII decimal integers from 0 through 262144, without leading zeroes. A single
`-` denotes absence only in SIZE records; it is distinct from an empty file's
zero bytes. SHA-256 is exactly 64 lowercase hexadecimal characters. Paths must
match observed snapshot paths exactly; unrecognized paths or encoded aliases
cannot credit a movement or size. Source/target fields retain the snapshot's
4096-byte limit. No record causes file or network access.

The checker recomputes whole-file movement evidence rather than accepting a
caller's movement claims. Each such movement requires one matching MOVE record.
All live paths in either snapshot require matching SIZE records when factual
content/inventory changed or any new protocol record was appended. Pure no-ops
and ordinary prose-only appends do not manufacture a compaction requirement.
New live paths have an absent prior size; removed live paths have an absent
current size. The LOG, handoffs and archive data are excluded from SIZE records;
a moved handoff's exact size is recorded by MOVE.

The report contains logged and missing move sources, missing live-file sizes,
and one-based invalid, unmatched and duplicate record lines. Any invalid,
unmatched or duplicate record retires all positive evidence for this operation.
`complete` describes record qualification, not missing-record absence or an
overall verdict. Consumers must inspect every diagnostic and still compose the
archive-file, item, plan-index and remaining checks. Limits are 256 KiB per LOG,
16 KiB per protocol line and 1024 new protocol-bearing lines. Exhausted aggregate
limits fail explicitly; malformed or oversized individual records are diagnosed.

This introduces no writer, template migration, persisted baseline or CLI check.
The content LOG and existing instruction bases remain unchanged until the full
checker can consume them through the existing reviewed base-update flow. Item
fragment appends need separate evidence; these records cannot certify them.
Native inventory authority, authenticated origin, age/month qualification and
backlinks remain required before accepting compaction.

## Whole-file archive time qualification

`check_memory_archive_time` and `checkMemoryArchiveTime` recompute exact,
unambiguous whole-file moves from both snapshots. They do not accept a caller's
movement list or claimed dates. For handoffs, the shared portable UTC basename
validator supplies the timestamp. The archive month must equal the handoff's
month, rather than the month when compaction runs. Filesystem timestamps and
LOG dates never qualify age. This is syntactic calendar evidence, not proof of
authorship or when a file was physically created.

The caller supplies its observed clock in integer Unix milliseconds from zero
through 8640000000000000, and the configured `archive.afterDays` integer from 1
through 36500. Invalid settings fail even without moves. A day is exactly
86400000 milliseconds. "Older than" is strict: equality with the threshold is
still too recent. Future timestamps are diagnosed separately. Wrong months and
age problems can both be reported for the same source.

Reports contain scalar-sorted source paths for qualified moves, unknown dates,
future dates, too-recent moves and wrong months. Qualification applies only to
each identified move; it is not an overall verdict. Copies, rewritten files,
ambiguous movements and other rejected candidates still require the separate
archive-file report. An empty time report does not rescue their diagnostics.
The snapshot-only API leaves closed-plan dates unknown because snapshots retain
no closure date; a plan filename's date is not its closure. No persisted schema, template,
writer, IO or CLI command is added by this component. Native clock/config and
baseline ownership, fragments, backlinks and integrated checking remain required
before accepting compaction.

### Source-bound plan closure dates

`check_memory_archive_time_with_sources` and `checkMemoryArchiveTimeWithSources`
also consume actual previous source facts. Only exact, unambiguous moved plans
request a body. The entire selected batch is captured and checked against the
128-entry, 256 KiB per-body and 4 MiB aggregate limits before hashes are checked.
Each supplied body must match the original movement's SHA-256 and byte size;
changed evidence fails the operation without returning partial qualification.
Missing or blocked facts leave that plan's date unknown. Extra facts are not
parsed or credited, but still count toward the 128-entry input limit. TypeScript
captures every selected body and movement before its first asynchronous hash.
These facts are comparison evidence, not native authority or authenticated origin.

The qualified closure field is one unindented header line before the first
level-two through level-six ATX heading: `State: closed YYYY-MM-DD` or
`State: **closed** YYYY-MM-DD`. An optional `Date: YYYY-MM-DD` field can precede
it on that same line, separated by a spaced middle dot. ASCII spaces or tabs
separate fields; dates must pass the shared Gregorian calendar validator.
Exactly one visible closure field is required, even if duplicates agree.
Additional prose, malformed markers, changed visible bytes or invalid dates
cannot qualify the field. The shared visibility lexer ignores closed fences,
comments and inline code; hidden text cannot supply a missing closure date.

The surrounding header must remain plain metadata. Indented, quoted, list,
setext, HTML, link, reference, emphasis and other unqualified markup contexts
leave the date unknown. Level-one titles are allowed. This is a conservative
explicit field channel, not a second CommonMark renderer or universal Markdown
support. Unsupported valid layouts require qualification before they can credit
archival. The existing plan-state and open-item guards still govern eligibility.

A closure date identifies a UTC day, not an observed instant. Its first
millisecond detects a future day; its last millisecond determines age, so the
checker never archives early by guessing a midnight closing time. A plan closed
on January 1 remains too recent at the end of January 31 with `afterDays: 30`;
it first qualifies on February 1. The destination month is that closure month's
literal `YYYY-MM`. Handoffs retain their existing minute-precision behavior.
This adds no timestamp to snapshots or persisted schema, and does not prove
historical truth, native baseline ownership, fragment integrity or backlinks.

## Intact item fragments and archive appends

`check_memory_archive_fragments` and `checkMemoryArchiveFragments` bind both
complete raw inventories to their snapshots using the existing snapshot builder.
Path sets, SHA-256 and byte sizes must agree before comparison. Missing, blocked,
changed or over-budget evidence fails without a positive partial result. The
TypeScript implementation captures both inventories and expected hash values
before asynchronous work. Reconstructing comparison values does not attest to
native inventory completeness, baseline origin, permissions or project ownership.

The qualified fragment channel uses plain top-level list items or level-one
through level-six ATX sections containing a visible `[T-n done]`, `[D-n done]`
or `[Q-n done]` marker, with exactly one literal ` · closed YYYY-MM-DD` suffix. Lists may
use `-`, `+`, `*` or one through nine decimal digits followed by `.` or `)`.
For `continuity/CHANGELOG.md`, a plain `## YYYY-MM-DD` section can identify a
closed historical entry without an item ID. The shared calendar and visibility
lexer apply; comments and inline code cannot fabricate dated markers.

A list block owns every following raw line through the next top-level list or
ATX heading. A section owns every raw line through the next same-level or higher
ATX heading, including nested sections and their reasons. The earliest enclosing
candidate owns an overlapping candidate. Blank lines, indentation, UTF-8, code
and newline bytes within that unit remain part of its evidence. Retaining only
an ID or its first line cannot rescue a removed reason. A unit that remains
byte-identical in its live source needs no archive credit. Duplicate original
headers in a changed source remain unverified rather than lending multiplicity.

The source must have a qualified plain layout. HTML, quotes, links, references,
emphasis and other unqualified visible markup leave changed closed content
unverified. Closed inline code and fenced code use the existing visibility
channel while retaining their raw bytes. Closed occurrences outside a derived
unit and unqualified changelog sections also remain unverified. This is an
explicit conservative block channel, not a CommonMark renderer or support for
every valid Markdown layout. Additional layouts require qualification rather
than silently accepting smaller arbitrary line cuts.

Only a removed or changed unit with no syntactically open item can qualify.
Its closure day must be valid and strictly older than `archive.afterDays`, using
the last UTC millisecond for age and the first for future-day detection. The
only qualified target is `archive/<closure month>/<source basename>`. The
checker derives units and destinations itself; callers supply no authoritative
offsets, movement claims, dates or permission booleans.

An existing archive must preserve its entire prior byte prefix. An unfinished
last line requires LF or CRLF before appending. Only newly appended bytes can
credit a removed unit; old archive text cannot rescue a deletion. The suffix
must consist entirely of exact, uniquely attributed units. A separator LF or
CRLF may join a unit without a final LF to another unit. Duplicate use,
ambiguous same-header sources, altered reasons or any unattributed suffix retire
all credit for that archive, including preceding valid-looking units. A new
empty archive provides no evidence. Qualified whole-file moves are recomputed
and left to the existing whole-file and temporal components.

Reports include source/line/target/byte-size/SHA-256 fragment receipts and
scalar-sorted diagnostics for missing fragments, unknown/future/recent dates,
open units, ambiguous attribution, unverified sources, rewritten archives and
unattributed archive appends. Diagnostic keys use `<source>#L<one-based line>`;
snapshot paths cannot contain `#`. Receipts contain no document bodies and prove
only byte preservation within supplied inventories, not historical truth or
semantic equivalence. There are at most 1,024 structural boundaries per document,
256 units per comparison and 64 MiB of live-content search budget. Existing
128-file, 4 MiB inventory and 256 KiB per-document limits remain in force.

This component does not erase whole-file diagnostics. A future composer may
discharge a changed/new archive only for a fully qualified append target, while
still checking lost archives, ineligible file removals, live obligations, index
membership, LOG records, backlinks and native baseline authority. No integrated
checker, fragment LOG writer, template migration, IPC, persisted schema or
filesystem mutation is added here. Empty arrays still never approve compaction.

## Source-bound fragment LOG records

`check_memory_archive_log_with_sources` and `checkMemoryArchiveLogWithSources`
recompute intact fragment evidence from both complete source inventories, bound
to their supplied snapshots. MOVE eligibility and live-file sizes are also
rebuilt from raw source facts rather than accepting mutable snapshot metadata
or a caller's receipt list. These bounded extra hashes add no filesystem reads.
The TypeScript wrapper captures both inventories and expected hash identities
before asynchronous loading or hashing; the fragment component stays lazy.
The legacy LOG API captures its movement, size and hash observations before
asynchronous hashing as well.

This source-aware entry point additionally accepts one raw eight-field layout
in newly appended `archive/LOG.md` bytes (`TAB` is a literal tab):

- `VOKTTY-FRAGMENT-1 TAB date TAB agent TAB source TAB line TAB target TAB bytes TAB sha256`

`line` is the one-based original physical source line, a canonical ASCII decimal
integer from 1 through 262144 without leading zeroes or an absence marker.
`source` and `line` identify one recomputed fragment. Source and target paths,
byte size and lowercase SHA-256 must match that fragment exactly. No URI,
quote, JSON or escape decoding is performed. The existing date/agent syntax,
4096-byte path, 256 KiB size, 16 KiB record, 256 KiB LOG and 1024-new-record
limits remain in force. Dates and names do not authenticate timing or authorship.
The original API and report shape remain unchanged and reject new fragment
records instead of pretending to verify them without source bytes.

MOVE, SIZE and FRAGMENT share one parser, append-only boundary and record budget.
Historical records, including a final line completed by a newly added newline,
cannot credit a new fragment. Duplicate fragment keys use `<source>#L<line>`;
another line in the same source is independent. Any invalid, unmatched or
duplicate record withdraws all MOVE, SIZE and FRAGMENT logging credit, even
credit preceding the bad record. A correctly formatted record cannot fabricate
an intact fragment from a shortened reason, an open unit or an unqualified source.

The new report contains the existing `log` report, the full independent
`fragments` byte-preservation report, and `loggedFragments`/`missingFragments`
keys. Fragment byte evidence remains independent of whether it was logged.
`log.complete` describes record qualification only; consumers must inspect both
complete reports and all missing-record arrays. An empty missing-fragment array
does not rescue failed byte evidence. Missing live-file SIZE records still
matter even when every fragment record matched. No overall approval flag, LOG
writer, template migration, persisted baseline, IPC or CLI check is introduced.
Backlinks, native inventory/clock/config authority, root-bound baseline origin
and full composition remain required before accepting compaction.
