# Protected shared-memory evidence

`snapshot_memory_protected` / `snapshotMemoryProtected` describe shared files
that compaction must leave byte-identical. They are separate from factual live
documents and never inspect Markdown IDs, parse JSON, follow imports, execute
instructions, validate an agent launch or grant instruction trust.

Paths are project-relative: `.voktty/...` for kit data and `AGENTS.md` and
`CLAUDE.md` for the two existing root-rule links. The packaged manifest supplies
every fixed base and link path. Configuration, `kit.lock.json` and
`team/agents.json` are also fixed protected observations. `memory_protected_paths`
returns that scalar-sorted inventory. It comes from packaged resources, never a
project-supplied manifest, roster, path list or instruction.

Qualified extensions are lowercase ASCII letter/digit/hyphen role and capture
names ending in `.md`, immediately inside `.voktty/team/roles/` and
`.voktty/capture/`; README and `_TEMPLATE.md` bases inside plans, domains,
architecture, rituals and external assignments are also protected. Existing
manifest bases keep their exact names. `is_memory_protected_path` classifies
these paths only; it is not filesystem authority. Traversal, encoded aliases,
queries, controls, namespaces, unknown root paths, factual documents and reserved
runtime paths are rejected. Paths are case-preserving and at most 4096 UTF-8 bytes.

Every fixed path needs an explicit actual fact, even when absent. An absent
entry is verified absence, with null size and hash, not an unavailable read or
an empty file. Blocked facts, missing fixed observations and incomplete native
enumeration cannot produce a snapshot. Extra role/capture/static paths belong
to the complete inventory only when they are observed; native completeness must
establish that no other existing qualified file was omitted.

Each independent schema-1 snapshot contains sorted path, file/absent kind,
SHA-256 and UTF-8 byte size. It retains no body, item state, policy, accepted
digest, machine identity or execution authority. Malformed roster JSON or an
unclosed instruction fence can be hashed without interpreting it. NUL, invalid
Unicode, bodies above 256 KiB, batches above 4 MiB and inventories above 128
observations fail. Absent fixed paths count toward the file limit. TypeScript
captures and validates the whole batch before asynchronous hashing and freezes
the snapshot, entries and comparison arrays.

`compare_memory_protected` / `compareMemoryProtected` report `changedFiles`,
`addedFiles` and `removedFiles`. Every byte change matters, including line-ending
conversion, JSON reformatting and same-length edits. An empty file is a real
addition. Renaming a role remains a removal and addition even with equal bytes;
putting the old text into an archive cannot rescue a protected rewrite. Optional
absent observations and an omitted optional path in an otherwise complete
inventory both represent no file. Neither can conceal a previously present file.

These are pure comparison values, not persisted or deserializable native
receipts. An empty report never approves compaction, authenticates a baseline,
accepts instructions or authorizes use of the bytes. The native reader must
prove both complete inventories and their original project binding, retain its
owner and compose this report with all factual preservation diagnostics before
an integrated checker can accept a result. This adds no writer, migration,
provider delivery, IPC, CLI check or compaction automation.
