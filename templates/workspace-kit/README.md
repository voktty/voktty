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
