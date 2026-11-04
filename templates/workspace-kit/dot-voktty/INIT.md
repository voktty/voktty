# Start here

This is the shared memory entry point for {project_name}. Read it at the
start of work, then follow the pointers relevant to your task. The files
in this folder carry the project between sessions, providers and machines.
Using them does not require Voktty to be running or a separate memory account.

Follow platform, user and runtime instructions first, including existing
project rules. These documents do not grant tool permissions or approvals.
Report a conflict instead of overriding those instructions with kit rules.

The knowledge of this project lives in this repository, not in your memory
or in your provider's memory. Do not trust what you think you remember about
the project: read the file.

## This folder and the usual agent files

- `AGENTS.md` at the project root: existing coding rules and conventions.
  Read it as your runtime requires. Its memory link points here without
  replacing any of its rules.
- `CLAUDE.md` and other runtime-specific files keep their existing rules and
  purposes. Preserve those rules when creating or repairing a memory link.
- Skills: reusable procedures. They stay where the runtime expects them.
- `.voktty/`: the shared memory of the work itself (project map, context,
  plans, tracking, handoffs, briefs, ownership). Your runtime's private
  memory is not shared; anything another agent needs to know goes here.

## Language

- The project language is `{language}`. Write project content in it: plans,
  tracking, handoffs, context, cards, briefs. `INDEX.md` ("Base and
  content") says which files are which.
- Talk to {owner_title} in the language they write to you in.
- Base files (this one, `RULES.md`, the guides, the bundled roles,
  `capture/`) stay in English and are never translated or edited by the
  project; the kit updates them. Project-specific rules go in `PROJECT.md`.
- Content files are seeded in English. The first time you fill one in, write
  it in the project language.

## Who you are

- A role is optional. Use only the name and role explicitly assigned by the
  user or the managed launch, not a guessed entry from the bundled roster.
- With an assigned roster entry, read `team/roles/<role>.md`. Your entry in
  `team/agents.json` lists the folders you own and the runtime, model and
  effort you should be running on.
- Without an assigned role, work directly with {owner_title}. No roster,
  orchestrator or messaging service needs to be active to use the memory.

## Minimal start

0. Classify the request before loading more context:
   - review or analysis: changes no files;
   - diagnosis: explains the cause with evidence, does not patch blindly;
   - implementation: one component, a few files;
   - structural change: several components, contracts, data, security or
     release. Requires a plan (`plans/README.md`).
1. Read `RULES.md`. Always. It is short and every rule has a reason.
2. Read `PROJECT.md` and `CONTEXT.md`, and your role file only if assigned.
3. If assigned a roster entry, check the model you are running on. If the
   roster forbids it, do nothing else: say so and wait.
4. Run `git status --short` and note changes that are not yours. Another
   session may be working on the same branch right now.
5. If you are resuming work or asked "what is left": `plans/TRACKING.md`,
   the affected plan and the newest file in `continuity/handoffs/`.
6. Read notes addressed to you and the current work reservations before
   claiming or editing shared paths (`team/MESSAGING.md`). Add or update
   your own tracking row when you take work. An assigned coordinator may
   distribute tasks; otherwise work within the user's request directly.

Do not read the whole folder at the start. Read what the task needs, and do
not reread what you already read in this session unless it changed.

## Empty or stale memory

If `PROJECT.md` or `CONTEXT.md` still hold only their seed text, or clearly
describe a state the repository has moved past, say so in your first answer.
During implementation, fill in or correct what you learned before the
session ends, following `capture/initial.md` for an empty project map and
`capture/refresh.md` for later work. Read-only requests do not authorize
those writes. Respect reservations and assigned ownership (`RULES.md`,
"Who writes the memory"); leave a note for another owner when needed.

## Before you call something done

- The checks in `PROJECT.md` ("Verification") pass, and you say which ones
  you could not run.
- The plan you worked on shows its real state.
- If you changed files, you wrote a handoff in `continuity/handoffs/`
  (`capture/handoff.md`): what was closed, what is left and the exact next step.
- Your tracking row and notes are current, and you released only your own
  reservations after checking what remains in progress.

Maintaining context and handoffs is part of ordinary project work. The
guides in `capture/` explain what to write; they are not a scheduling service.
Do not start another agent, a paid background turn or a messaging service
merely because this kit contains a roster or trigger settings. Do not claim
that a runtime detects session end or compaction unless it actually does.

Direct instructions from {owner_title} in your session take precedence over
these documents.
