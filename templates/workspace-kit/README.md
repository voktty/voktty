# Voktty Workspace Kit

A ready-to-use structure for running a software project with one or more AI
coding agents and a human owner. It keeps instructions, plans, tracking,
handoffs, roles and the agent roster inside the repository, so any agent on
any machine can pick up the work where the last one stopped.

The planned Voktty integration deploys it as a `.voktty/` folder. Today you
can copy it by hand into a repository and explicitly ask an agent to use it,
with or without Voktty.

## Why this exists

Agents forget. A session ends, a machine changes, a provider is swapped, and
everything the agent "knew" is gone. Teams that work with agents every day
end up rediscovering the same rules:

- The knowledge has to live in the repository, not in an agent's memory.
- Large work needs a written plan with small milestones, each with an
  acceptance check someone can actually run.
- Every session ends with a short handoff that says what is done, what is
  left and the exact next step.
- When several agents share a repository, each one owns its folders and
  commits only its own paths.
- Messages between agents are expensive: send verdicts, decisions and
  blockers, not acknowledgements.
- If something is unknown, say so. Uncertainty calls for investigation, not
  for bigger changes.

This kit turns those rules into files with fixed places and an explicit
start sequence for enabled sessions. `RULES.md`
explains each rule and why it exists.

## What it adds, and what it does not replace

`AGENTS.md`, `CLAUDE.md` and skills keep their usual role: agents read them
for the coding rules of the project. What a project usually lacks is a
shared memory that does not belong to any single agent. An agent's own
memory is private and lives on one machine; `.voktty/` is the shared truth.
With it, an agent running remotely on Linux and another running locally on
Windows, on different runtimes, work on the same plans and hand work over
through the traces they leave in the folder.

## How it travels between machines

The recommended mode is to commit `.voktty/` with the project: every machine
and every agent then sees the same state through Git. Per-machine runtime
state (session ids, mailboxes, locks) is never committed; the bundled
`.gitignore` keeps it out. If you prefer not to version the folder, ignore it
in your repository and accept that it stays on one machine.

If the repository is public, everything in `.voktty/` is public too: plans,
handoffs and decisions included.

## Status

The template is published ahead of the Voktty features that deploy it.
The memory panel, automatic context delivery, capture scheduling and commands
such as `voktty agent`, `voktty lock` and `voktty memory check` are not
implemented by this template. They arrive with those features. Until then,
use the documents manually; file mailboxes need an explicitly coordinated
reader, and local lock files do not coordinate different machines.

## Layout

```
templates/workspace-kit/
  README.md            this file
  placeholders.json    every {placeholder} used by the template, with defaults
  manifest.json        versioned resource list and base/content/link roles
  contracts/           shared core schemas, not deployed project documents
  dot-voktty/          deployed as <project>/.voktty/
  root/                optional pointers deployed at the project root
```

Inside `dot-voktty/` (that is, `.voktty/` once deployed):

| Path | Purpose | Kind |
|---|---|---|
| `README.md` | What the folder is, for people opening the repository | base |
| `INIT.md` | The start sequence for a session with memory enabled | base |
| `RULES.md` | Working rules, each with its reason | base |
| `INDEX.md` | Map of the folder, base and content, single owner of each fact | base |
| `PROJECT.md` | What the project is, map, verification, project rules, traps | content |
| `CONTEXT.md` | One page of current context: priorities, risks, decisions | content |
| `kit.json` | Kit settings: version, project language, capture triggers, size limits, archiving | content |
| `kit.schema.json` | Structural configuration contract; local consent is never stored here | base |
| `team/agents.json` | Agent roster: who exists, which runtime, which folders they own | content |
| `team/agents.schema.json` | JSON Schema for the roster | base |
| `team/MESSAGING.md` | How agents talk to each other and to the owner | base |
| `team/roles/` | One role file per agent; bundled roles are base, custom ones content | both |
| `plans/` | Plan guide (base), plan index and tracking board (content) | both |
| `continuity/` | One file per handoff and the impact changelog | content |
| `capture/` | What to write at each trigger: setup, milestone, handoff, refresh, compaction | base |
| `domains/`, `architecture/` | Cards per component and per standard | content |
| `rituals/` | Recurring tasks and their schedule | both |
| `external/` | Self-contained briefs for agents working outside the team | both |
| `archive/` | Closed history by month, moved unchanged | content |
| `.gitignore` | Keeps per-machine runtime state out of Git | base |

**Base** files come from the kit, are written in English and are never
translated or edited by the project, so a kit update can replace them
safely. **Content** is the project's own memory, written in the project
language.

## Using it with Voktty

The following is the planned flow, not an available panel yet:

1. Open Project Memory using the brain button in the terminal's lower
   controls or the equivalent Harness button. Opening a folder, changing cwd
   or detecting an agent never creates a kit, opens a proposal or starts AI.
2. Choose Initialize Memory, select the project language and review the
   deployment preview. Existing files are preserved. Persistent links from
   `AGENTS.md` or `CLAUDE.md` are separate opt-ins, unchecked by default.
3. Separately enable context for this session or choose a local always/never
   policy for this project. Cloned or changed instruction bases require
   local trust review. Installation alone is not permission to use them.
4. Optionally authorize captures and their model cost. Initial project
   analysis writes `PROJECT.md`, `CONTEXT.md` and cards only when accepted.

Managed launches deliver context only when enabled and supported by their
adapter and transport. Direct `codex`, `claude` or other agent commands keep
their original arguments and behavior; detection never types a prompt into
them. Unsupported integrations offer a manual message or optional native
link. Delivery is not proof that an agent read or followed the documents.

One agent can use the memory without a roster or active orchestrator.
Existing user and runtime rules retain precedence; `.voktty/` never grants
tool approvals. Agents write project content in the project language and
talk to you in yours. Folders without the kit work exactly as before.

## Keeping the memory full and small

A new `.voktty/` is mostly empty. The planned capture integration uses the
instructions in `capture/`: the first reading of an existing project, the
close of a milestone or plan, the end of a session or the moment before an
agent compacts its context, a periodic refresh, and a "Save context" button.
These require separate capture consent and a capable integration; direct
CLI sessions do not guarantee automatic trigger detection. Without the
integration, request a capture manually. Read-only use does not enable writes.

Live files are reread by every session, so they have size limits in
`kit.json`. The planned integration measures them; when one is passed, closed
history moves unchanged to `archive/YYYY-MM/` and the live file is rewritten
as the current state. Open work is never archived, and a check confirms that no open item,
plan or decision was lost.

## Using it without Voktty

1. Copy `dot-voktty/` to `<project>/.voktty/`.
2. Optionally review the persistent links in `root/`. Do not overwrite an
   existing `AGENTS.md` or `CLAUDE.md`. Add a link only with separate consent,
   preserving existing rules. No root-file edit is needed for manual use.
3. Replace every `{placeholder}` using `placeholders.json` as the reference.
4. For a session you want to enable, ask: "Read `.voktty/INIT.md` subject to
   my instructions and your runtime's rules." Assign a role only if wanted.
   Separately say whether writing captures is authorized.

A persistent link may still be read by a runtime when Voktty's integration
is disabled. Local policy cannot remove context already sent to a model or
undo a root-file edit; review the link or start a new session as needed.

## Placeholders

Placeholders look like `{project_name}`: lowercase letters, digits and
underscores inside single braces. `placeholders.json` lists every one of
them with its meaning and default. A deployment that leaves an unknown or
required placeholder unfilled is an error, not a silent gap.

## Versioning

The source-only `.gitattributes` keeps bundled Markdown, JSON, text and
`.gitignore` resources in LF across Git checkout settings, preserving shared
rendering hashes. It is not deployed into projects. Observed project files
retain their exact bytes, including CRLF, when inspected or fingerprinted.

`manifest.json` is the source inventory: schema version 1, template version
and the exact files shipped, classified as base, project content or optional
root links. The frontend core loads these resources on request, validates
the inventory and renders placeholders, including JSON string escaping.
Its deployment preview requires explicit path observations and preserves
conflicting files; it does not write files, grant trust or enable memory.
The reusable `voktty-workspace-kit` Rust crate embeds the same manifest and
source files at build time, without a webview or runtime filesystem reads.
Native deployment and CLI command integration remain pending.
The native pure deployment preview now uses the same explicit observations,
root-link choices and conflict rules as the frontend. Both cores run the full
expected previews in `conformance/deployment.json`. A publishable preview is
not an IO authorization or proof of exclusive access to the destination.

The core validates configuration and rosters against the shipped JSON
schemas, then checks matching placeholder values, effective runtimes and
lexical ownership overlap. Callers supply the filesystem's case policy;
this does not resolve symlinks or authorize paths. A `generic` command or
an external read path remains configuration, not permission to execute or
read it. A memory-only configuration can omit the roster.

Template version 1.1.0 adds the configuration schema and stores deployment
placeholder values in `kit.json`. Schema 1 configurations without those
values remain readable; an updater must ask for missing values rather than
guessing them. `conformance/validation.json` records rendered-template cases
for structural and semantic checks. Both cores execute that corpus and the
whole-file hashes in `conformance/rendering.json`. Rust uses the existing
JSON Schema engine with formats enabled and external retrieval disabled;
project-provided schema links are never loaded.

`kit.json` records the kit version a project was created from. When a newer
kit is available, the planned integration offers a reviewable update that
only touches base files the project never changed. Content is never touched
by an update.

## Pure memory inspection and measurement

Both cores inspect bounded text without filesystem access. Character counts
use Unicode scalar values; bytes use UTF-8. CR and LF are counted separately.
The scanner records each visible `[T-n]`, `[D-n]` and `[Q-n]` occurrence with
its line and explicit `done` suffix. References remain conservative open
occurrences; a later done mention does not erase an earlier open one. Fenced
code, same-line inline code spans and HTML comments are excluded. This is a
scanner for the kit conventions, not a general CommonMark parser or a semantic
judgment about whether work is finished.

Plan state comes only from labeled metadata before the first section, not
from titles, list items, quotes, milestone completion or prose in later
sections. Missing or conflicting metadata yields `unknown`. Milestone headings
use `### M<n>: ... · pending|in progress|done`, with an optional ISO date after
the state. Unclosed fences/comments and duplicate Up next sections are
reported as warnings. Consumers must refuse semantic checks on incomplete
inspection and treat unknown plan state conservatively.

Measurement takes validated configuration, explicit document observations,
handoff metadata and a supplied clock. Missing or blocked reads and incomplete
inventories yield unknown values, never zero. Only configured limits are
measured. The Up next heading is an explicit argument (default `Up next`), so
translated headings must be supplied; an absent heading remains unknown.
Its item count uses the least-indented unquoted list items in that section.
Character measurement remains exact even when document structure is unknown.

Handoff counts exclude README and non-Markdown files. Age compares the oldest
reported timestamp against `maxAgeDays` in exact milliseconds, with no date
rounding. Missing or future timestamps leave age unknown. Gathering code must
report the timestamp source and enumeration completeness; this core does not
infer them from Git or filesystem modification times. Text is capped at
256 KiB, headings at 128 UTF-8 bytes and inventories at 20,000 unique names of
at most 256 bytes. Names cannot contain separators or NUL. Results are point
in time facts, not authorization, a compaction verdict or archive selection.
Native readers, snapshot comparison and CLI/UI integration remain pending.

## Instruction fingerprints and context packets

`instructionFingerprint` and `instruction_fingerprint` consume schema 1
instruction snapshots defined in `contracts/memory-context.schema.json`.
Every current manifest base, both root files (`AGENTS.md`, `CLAUDE.md`) and
the explicitly assigned role need an observation. Root files may be absent;
bases and the assigned role must be readable files. Blocked, omitted,
duplicated and unexpected paths fail. A custom role is allowed only under
`.voktty/team/roles/` with the roster's role-name convention. Unassigned
custom roles and factual project documents do not enter this inventory.
The current manifest defines the inventory; other template inventories need
explicit migration or version support rather than an inferred file list.

Hashes cover actual observed UTF-8 bytes without newline normalization, not
hashes declared by `kit.lock.json`. Each file is capped at 256 KiB and the
aggregate at 1 MiB; NUL and invalid Unicode are rejected. Snapshots are capped
at 2 MiB of serialized JSON and 128 observations. Missing bases cannot silently
produce a trusted partial fingerprint. Native gathering must authorize every
path and bind reads to a verified canonical root; these pure functions cannot prove
where an observation came from or whether a symlink remains unchanged.

The aggregate SHA-256 input begins with `voktty-memory-instructions-v1` and
NUL. Fields use the project-identity framing: unsigned 32-bit big-endian UTF-8
byte length followed by the bytes. Fields are the assigned role path (empty
when absent), decimal record count, then path, kind and file SHA-256 (empty
for an absent root file) for each record in ASCII path order. The returned
record list uses `file` or `absent` and a lowercase SHA-256 or null. Role
assignment and root-link presence affect trust even when other files match.
Concurrent Web Crypto hashes settle together before a failure is propagated.

`buildMemoryContext` and `build_memory_context` accept schema 1 identity,
policy, configuration, instruction observations, PROJECT/CONTEXT observations
and an optional plan metadata observation. Identity, use and configuration
are validated by their existing contracts when needed. A disabled session
does not hash or construct a packet. Eligible preparation derives its project
key, checks the requested binding, recomputes the actual instruction digest
and applies policy again. A caller's claimed digest cannot hide changed
instructions. Denial returns no packet. This is a pure preparation decision,
not native authorization, provider startup or a delivery acknowledgement.

The delivered text starts with the shared hierarchy statement in
`contracts/memory-context-header.txt`, followed by one JSON object. It contains
the root, project identity, language, instruction digest, optional role,
content state, explicit pointers and three or four sections. Full INIT text
has a 12 KiB serialized-string cap, an assigned role 4 KiB, and PROJECT and
CONTEXT 3 KiB each. An instruction that does not fit becomes a pointer, never
a partial instruction or an unmeasured full-text fallback. Factual sections
may use explicitly labeled prefixes. These are extractive context, not AI
summaries or proof of analysis. Pointers do not grant permission to read files.

Every section also fits the remaining total budget. The complete header,
metadata, JSON escaping and text together stay within 24 KiB UTF-8; clipping
preserves Unicode scalars. A digest covers the exact delivered bytes. Missing
or blocked PROJECT/CONTEXT reads fail. Empty or matching current seed content
is `initial`; other text is `available` only relative to known current seeds,
or `unknown` when the seed version/values cannot be established. None of these
states means that an agent understands the project. An unavailable optional
plan is omitted with `KIT_CONTEXT_PLAN_UNAVAILABLE`.

Context input JSON is capped at 4 MiB, with the existing 16,384-node and Unicode
guards; PROJECT/CONTEXT each retain the 256 KiB text cap. Existing parsers keep
their previous default document limits. Instruction verification may inspect
the bounded base inventory, but only the selected sections enter model context.
The packet contains no roster, archive, mailbox, task or session contents.
Native reader integration, freshness/lifetime guards, local consent-store wiring, adapter
delivery and resume/compaction receipts remain pending. Existing VOKTTY.md
memory loading and approvals remain unchanged.

`conformance/memory-context.json` fixes shared fingerprints and packet byte
hashes for both cores, including initial seeds, role changes, 100 KiB INIT,
oversized roles, escaped Unicode, explicit plan pointers and denied use.

## Memory scope and project identity

`memoryProjectKey` and `memory_project_key` hash trusted native identity facts
using `contracts/memory-identity.schema.json`. The SHA-256 input starts with
the UTF-8 bytes of `voktty-memory-project-v1` followed by NUL. Four fields
follow in order: `kind`, `machineId`, `filesystemId`, `canonicalRoot`. Each is
framed by its UTF-8 byte length as an unsigned 32-bit big-endian integer.
The result is 64 lowercase hexadecimal characters. Input JSON is capped at
16 KiB and each field at 4 KiB UTF-8. Blank machine/filesystem identities and
control characters are rejected. The root must have an absolute POSIX,
Windows drive or UNC form; unresolved remote namespaces are rejected.

The native adapter must supply a local installation identity, its stable
filesystem/connection identity and an authorized canonical execution root.
These APIs do not discover those facts, normalize case or separators, resolve
symlinks, or prove filesystem authorization. POSIX backslashes and Unicode
normalization distinctions are preserved. A native Windows adapter should use
the existing canonical-to-display conversion after native resolution. SSH
identity must include the captured profile and actual connection binding;
WSL must distinguish distributions, and Docker must distinguish engine,
container and user. Presentation scope keys alone are insufficient. Adapter
factories and installation-ID integration remain pending; repository files must
never supply these local identities. The same framing works independently of
object-property order and cannot confuse adjacent field boundaries.

`resolveMemoryScope` and `resolve_memory_scope` consume the shared
`contracts/memory-scope.schema.json` observations. Ancestors start at the
requested directory and follow exact parent keys toward the filesystem root.
Keys use the identity function above. Duplicates, cycles, missing links and
false root termination are rejected. The pure core cannot prove that a supplied
parent really exists; authorized native readers must collect that evidence.
An authorization boundary, cancellation, error, unfinished traversal or more
than five seconds cannot establish absence. At most 128 ancestors are accepted.

The resolver distinguishes absent, reserved-only, valid, invalid, partial,
denied, ambiguous and incomplete scopes. A unique valid ancestor is usable
only after a complete ancestry check without blockers; nested valid kits
remain ambiguous. `rootKey` is the nearest valid kit for inspection, even
when use is blocked. It is never an automatic selection or permission grant.
The policy API accepts all resolver states and denies every state except
`ready`, before checking consent and instruction trust.

`discover` rejects descendant scans. Only explicit `initialize` or `manage`
facts may carry one, bound to the original requested directory. The reader
must enumerate metadata without following directory links or using ignore
files to infer absence. The core accepts at most 20,000 entries, depth 64,
ten seconds and 1,024 reported findings, within its 256 KiB JSON/node budget.
Reaching an output limit must stop the reader with an incomplete result rather
than discard findings. These are observation limits, not a native timer or
cancellation implementation; the future reader must enforce them while running
and keep its concurrency at most four.

Any discovered descendant kit or uncertain finding blocks initialization.
A known parent plus valid child is ambiguous; a partial child or incomplete
management scan blocks use of that parent. Independent children below an empty
container remain listed without selecting or merging their memory. Missing
descendant observations yield `not_checked`; an explicit completed scan with
no findings can yield `clear`. `clear` only classifies the observed scope. It
does not accept a preview, authorize writes, detect later changes or serialize
another machine. Publication must check both the originating cwd and chosen
destination, then revalidate under native destination exclusion. Native readers,
application integration, publication and transport/platform qualification remain pending.

The native local reader now gathers ancestor and explicit descendant observations
from directory handles and runs this resolver. Enumeration requires its own native
permission, defaults to denied, and never inherits from metadata permission.
Limits, unreadable markers, links and directory changes block initialization;
root/ancestor classifications are rechecked across phases. Only configuration
metadata is read, with reserved data preserved. Directory identity and ancestry
are scoped to the actual filesystem. Native Windows discovery cross-compiles;
runtime qualification and authenticated remote readers remain pending.

`conformance/memory-identity.json` contains fixed framing/hash vectors, including
Windows, UNC, Unicode, machine, host and worktree distinctions. The scope corpus
checks full results for nested kits, reserved state, scan binding, interrupted
traversal, budgets and malformed evidence. Both cores run the same cases.

## Pure memory-use decision

`evaluateMemoryUse` and `evaluate_memory_use` evaluate the same versioned
`contracts/memory-use.schema.json` input. The shared conformance corpus covers
consent, local policy, trust, scope changes and transport capabilities. These
APIs perform no IO, persist no policy and never start a provider or a capture.

Inputs belong to the trusted caller, not `kit.json` or other repository data.
The project key is an opaque lowercase SHA-256 identity supplied by the future
native resolver for its canonical filesystem, host/profile and execution root.
These APIs compare that identity exactly; they do not derive or canonicalize it.
Clones, worktrees and different hosts must receive distinct keys. Session grants
also require the exact session ID. Foreign records are ignored rather than
copied to a new scope. Captured caller lifetimes still need separate guards;
serialized identities cannot prove that an asynchronous request remains current.

The instruction digest must cover the current accepted instruction surface,
including bases, assigned role and startup links. The future reader owns its
bounded inventory and digest construction. Missing local trust or a changed
digest prevents delivery, including under `always`. A ready kit without an
instruction digest is invalid input. Absent, invalid, ambiguous and incompletely
discovered kits cannot deliver context or enable captures.

Policy defaults to `manual`. Legacy `ask` is interpreted as `manual` without
prompting; persistence migration remains the local store's responsibility.
`never` overrides a session grant, and an explicit session disable overrides
`always`. Otherwise either an enabled matching session or `always` is required.
Trust and installation alone cannot enable use. Context delivery must also be
supported by the captured adapter and transport.

Capture requires all context conditions plus a matching session's separate
capture consent and capture capability. `always` by itself never authorizes
capture cost. The decision reports eligibility, not delivery, comprehension,
native filesystem authorization, tool approval or permission to initialize.
Revocation prevents future delivery; it cannot erase context already sent.

Input JSON is capped at 16 KiB UTF-8, rejects unknown fields and versions, and
uses the core's Unicode and document-node guards. Session IDs contain at most
256 ASCII letters, digits, dots, underscores, colons or hyphens. Digests contain
exactly 64 lowercase hexadecimal characters. Output schema 1 contains the
effective policy, context/capture booleans and a stable `KIT_MEMORY_*` reason.
Native resolution, policy-store wiring, instruction gathering and UI/CLI delivery
remain pending; callers must construct facts from their owned native sources.

The separate `voktty-memory-local` native library now provides bounded local
installation-ID, policy and instruction-trust storage with OS file exclusion,
atomic JSON replacement and revision checks. Its caller must own a private local
application directory; no repository chooses that location. No session or capture
grant is persisted. Store failures block use rather than reset preferences.
See its crate README for the format, filesystem requirements and platform limits.
Application/CLI wiring and native identity factories remain pending.

Its initial Unix reader now derives local identity from native directory metadata
and the stored installation UUID, and gathers bounded deployment/context facts
using directory descriptors without following symlinks. It requires native read
and metadata authority, rejects stale roots/preferences and invokes the shared
fingerprint/configuration core. It does not resolve scope or publish a kit.
A Windows backend now opens one component relative to captured native handles,
checks reparse attributes, full file IDs, volume identity and per-directory case
behavior, and shares the app's canonical display conversion. Its regression tests
cross-compile on Linux; native Windows runtime qualification remains pending.
Authenticated remote readers and application integration remain pending.

## Base integrity record

The pure preparation API adds `.voktty/kit.lock.json` to the preview before
`kit.json`. It requires an explicit observation of the lock file itself:
absent files can be created, identical bytes are skipped, and blocked or
different files remain conflicts. It performs no filesystem writes. A base
conflict leaves the candidate lock unavailable; a lock-file conflict retains
the candidate for inspection but prevents publication.

The schema 1 record has a `bases` array. Each entry contains a project-relative
`path`, template `version` and lowercase hexadecimal `sha256`. Only manifest
base files are included, sorted by path. Hashes cover exact proposed UTF-8
bytes, including rendered values and the migrated private `.gitignore`, with
no newline normalization. Content, optional root links and the lock itself
are excluded. Canonical lock text uses two-space JSON indentation and one
final LF. Per-base versions allow a future update to preserve unapplied entries.

`contracts/kit-lock.schema.json` is compiled into both cores without runtime
schema retrieval. Parsing also rejects dot segments, reserved runtime paths
and duplicate paths regardless of case. Locks are limited to 64 KiB and 128
entries; preparation limits each source or selected observed file to 256 KiB,
each inventory to 1 MiB, and rejects invalid Unicode or NUL. Unselected root
observations do not affect preparation. The TypeScript core
uses Web Crypto SHA-256 and reports digest failures without a successful plan.
The Rust core uses the already available SHA-256 implementation.

A parsed lock is untrusted project data. Its path list does not establish
base ownership, authorize reads or deletes, grant local trust, or coordinate
writers. Update and removal code must intersect it with the known base
inventory, authorize the destination and recheck current bytes under native
exclusion. Initial deployment still needs that native writer; CLI, update
and removal integration remain pending.

## License

The kit is part of the Voktty repository and is distributed under the same
license, Apache License 2.0. See `LICENSE` at the repository root.
