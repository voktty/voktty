# Project memory document display

`project_memory_documents` reads a display-only snapshot for an exact current
window, presentation and selection. The request includes the root shown by the
last observation. Rust independently resolves the selected execution directory,
requires a valid unambiguous scope with complete ancestry, and compares its root
before reading document bodies. The supplied root grants no filesystem authority.
Reads use captured native workspace authorization and the shared secret-path and
qualified local-filesystem checks. Remote, WSL and Docker sources remain
unsupported without local fallback.

The reader opens no private store and creates no installation, preferences,
trust, conversation permission, instruction packet or files. Opening the panel
does not request documents; the user explicitly chooses Browse. Refresh replaces
the display snapshot. Rendering uses literal text, without executable HTML or
Markdown links. Reading a document never accepts its instructions.

The catalogue contains the embedded template paths, root `AGENTS.md` and
`CLAUDE.md`, `.voktty/kit.lock.json`, and Markdown documents beneath the shared
plans, domains, architecture, rituals, external, archive, capture, team/roles
and continuity/handoffs directories. It does not enumerate private sessions,
state, tasks, mailbox or locks. The shared Rust/TypeScript path corpus defines
accepted relative document names. Secret paths remain excluded.

The schema-1 reply contains `root`, `complete`, `blockedCount` and `files`.
Each file has a relative `path` and a `fact`: `file` with exact UTF-8 `text`,
`absent`, or `blocked`. A blocked file or unclassifiable catalogue entry makes
the reply incomplete. Traversal, file and serialization limits reject the
snapshot rather than claiming a complete inventory. File-level failures and
text-budget exhaustion can return a partial display. These observations are
neither a write plan nor an export or deletion inventory.

Limits are 128 document paths, 128 visited directories, 20,000 enumerated
entries, 16 path components, 4 KiB per path, 256 bytes per component, 256 KiB per
file, 2 MiB returned text and a 4 MiB encoded reply. The text budget can read at
most one additional bounded file before marking subsequent content blocked.
Wire expansion beyond 4 MiB fails with `limit`. Native jobs use the existing
four-slot worker pool and five-second reader deadline; actual settlement owns
capacity. Frontend document requests retain a shared 256-request budget through
settlement, including retired work.

Root, execution and traversed directories retain no-follow handles, identity
and membership revisions; the kit marker and native scope are checked again
before return. Changed roots or directory membership reject the observation.
Each file read checks its own identity and metadata through the existing reader.
The result represents bounded observations, not an atomic filesystem snapshot.
Selection replacement, close, window retirement and shutdown suppress delivery;
they do not assert interruption of a pending operating-system call.
