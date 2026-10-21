# Voktty Workspace Kit

A ready-to-use structure for running a software project with one or more AI
coding agents and a human owner. It keeps instructions, plans, tracking,
handoffs, roles and the agent roster inside the repository, so any agent on
any machine can pick up the work where the last one stopped.

Voktty deploys it into a project as a `.voktty/` folder. You can also copy it
by hand into any repository and use it with any agent, with or without
Voktty.

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

This kit turns those rules into files with fixed places and a fixed boot
sequence, so the rules are applied the same way every time. `RULES.md`
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
Commands it mentions, such as `voktty agent`, `voktty lock` and `voktty memory check`, arrive with
those features; until then use the file mailbox and lock files described in
`team/MESSAGING.md` and `RULES.md`.

## Layout

```
templates/workspace-kit/
  README.md            this file
  placeholders.json    every {placeholder} used by the template, with defaults
  dot-voktty/          deployed as <project>/.voktty/
  root/                optional pointers deployed at the project root
```

Inside `dot-voktty/` (that is, `.voktty/` once deployed):

| Path | Purpose | Kind |
|---|---|---|
| `README.md` | What the folder is, for people opening the repository | base |
| `INIT.md` | The start sequence every agent session begins with | base |
| `RULES.md` | Working rules, each with its reason | base |
| `INDEX.md` | Map of the folder, base and content, single owner of each fact | base |
| `PROJECT.md` | What the project is, map, verification, project rules, traps | content |
| `CONTEXT.md` | One page of current context: priorities, risks, decisions | content |
| `kit.json` | Kit settings: version, project language, capture triggers, size limits, archiving | content |
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

1. Open the project folder in Voktty.
2. Enable the workspace kit for the folder from the project menu.
3. Choose the project language (by default, the language of Voktty's
   interface) and review the files that will be created. Nothing existing is
   overwritten.
4. If the folder already has code, let an agent read it and write the first
   `PROJECT.md`, `CONTEXT.md` and component cards.

Every agent session Voktty starts in the folder begins with `INIT.md`, so
nobody has to tell an agent where to begin. Agents write project content in
the project language and talk to you in yours. Folders without the kit work
exactly as before.

## Keeping the memory full and small

A new `.voktty/` is mostly empty. Voktty fills it at fixed moments, each with
its instruction in `capture/`: the first reading of an existing project, the
close of a milestone or plan, the end of a session or the moment before an
agent compacts its context, a periodic refresh, and a "Save context" button.

Live files are reread by every session, so they have size limits in
`kit.json`. Voktty measures them; when one is passed, closed history moves
unchanged to `archive/YYYY-MM/` and the live file is rewritten as the current
state. Open work is never archived, and a check confirms that no open item,
plan or decision was lost.

## Using it without Voktty

1. Copy `dot-voktty/` to `<project>/.voktty/`.
2. Copy the files from `root/` to the project root if they do not exist yet.
   If you already have an `AGENTS.md`, add the block from `root/AGENTS.md` to
   it.
3. Replace every `{placeholder}` using `placeholders.json` as the reference.
4. Start each agent session with: "Read `.voktty/INIT.md` and follow it.
   Your agent name is `<name>`."

## Placeholders

Placeholders look like `{project_name}`: lowercase letters, digits and
underscores inside single braces. `placeholders.json` lists every one of
them with its meaning and default. A deployment that leaves an unknown or
required placeholder unfilled is an error, not a silent gap.

## Versioning

`kit.json` records the kit version a project was created from. When a newer
kit is available, Voktty offers it as a reviewable update that only touches
base files the project never changed. Content is never touched by an update.

## License

The kit is part of the Voktty repository and is distributed under the same
license, Apache License 2.0. See `LICENSE` at the repository root.
