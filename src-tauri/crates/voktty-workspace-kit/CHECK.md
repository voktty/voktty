# Composed memory-check evidence

`check_memory_preservation` / `checkMemoryPreservation` compose the existing
factual and protected comparison channels. Inputs are both complete factual
source maps, both protected snapshots, an observed Unix-millisecond clock and
the configured archive age. Factual snapshots are rebuilt from actual supplied
bytes. Protected snapshots must come from their separate complete-inventory
builder; TypeScript additionally captures and structurally bounds that metadata
before asynchronous work. Structural validity never authenticates a snapshot.

Each side shares the native inventory's 128-observation and 4 MiB document-body
budget across factual and protected channels. Existing per-body, parsing, ID,
record, link, temporal and search limits remain in force. TypeScript copies
factual facts and protected observations before the first await and freezes its
report, issues and subject arrays. Native Rust inputs retain their private typed
snapshot construction; no snapshot deserializer is introduced.

The schema-1 report preserves all component results: item and plan preservation,
protected file changes, current plan-index qualification, whole-file archival,
whole-file dates, source-bound fragment LOG records and archive navigation.
The fragment report inside `log` is the primary byte/age evidence; `links`
retains the matching fragment report from its own source-bound check as well.
`nowMs` and `afterDays` describe this observation, not a historical claim.

`issues` aggregates every negative channel, with a stable code and `subjects`.
Subjects are IDs, kit-relative factual paths, project-relative protected paths,
or existing `<source>#L<line>` diagnostic keys. Index and LOG line diagnostics
use their source path plus the same one-based line syntax. Codes use the
`PRESERVATION_`, `PROTECTED_`, `INDEX_`, `ARCHIVE_`, `LOG_`, `LINKS_` and
`FRAGMENT_` prefixes. Incomplete index or LOG qualification is itself an issue,
in addition to its detailed missing, invalid, duplicate or unverified entries.
Invalid inputs, unavailable source evidence, exhausted limits or an invalid LOG
prefix fail without returning a partial successful report.

## Exact append reconciliation

The independent whole-file checker deliberately diagnoses every changed old
archive and every new archive without a unique whole-file move. The composed
report keeps those original arrays unchanged. It also derives `qualifiedAppends`
from exact fragment receipts recalculated by the source-bound fragment/LOG
checker, never a caller's list of archive names or movement claims.

Only the exact target of such an intact, uniquely attributed append can discharge
its corresponding `ARCHIVE_CHANGED_ARCHIVES` or
`ARCHIVE_UNATTRIBUTED_ARCHIVES` issue. The target must have retained its old
prefix and qualified its entire new suffix; one matching block before an
unqualified tail yields no receipt. A valid target never discharges another
archive's rewrite, disappearance, ambiguous source or unattributed contents.
Raw whole-file diagnostics remain available even when this narrow reconciliation
explains them.

`qualifiedAppends` is byte evidence only. Missing LOG records, sizes, backlinks,
owner documents, unqualified syntax, age problems and every other fragment or
preservation diagnostic still block a consistent result. A removed live owner
can therefore have intact archived bytes while retaining its removal and missing
navigation issues. A valid whole-file move likewise cannot rescue a lost open ID.

## Authority and integration boundary

There is no approval, restoration or write-permit flag. Empty issues mean only
that these bounded supplied observations are consistent with the qualified
channels. The pure report does not prove inventory origin, native root ownership,
exclusive writer coordination, semantic equivalence of rewritten live prose or
that an agent followed instructions. Protected comparisons grant no trust.

The native local reader supplies the independently authorized shared baseline
and fresh current observation through its owned checking API. A serialized pure
report or editable project JSON must never become a native baseline or reusable
permission to accept compaction. Baseline persistence, operation ownership,
writer coordination, CLI exposure and guided restoration remain separate work.
