# Start here

Every agent session in {project_name} starts here. Voktty injects this file,
your role and your task at the start of the session; outside Voktty, read it
yourself before doing anything else.

The knowledge of this project lives in this repository, not in your memory
or in your provider's memory. Do not trust what you think you remember about
the project: read the file.

## This folder and the usual agent files

- `AGENTS.md` at the project root: the coding rules and conventions every
  agent must follow. Read it as usual. It points here for how work is
  organized.
- `CLAUDE.md` and other runtime-specific files: thin adapters that include
  or point to `AGENTS.md`. Do not duplicate rules in them.
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

- Voktty tells you your agent name and role when it starts you. Outside
  Voktty, the person or agent who started you says it.
- With a name, read `team/roles/<role>.md`. Your entry in `team/agents.json`
  lists the folders you own and the runtime, model and effort you should be
  running on.
- Without a name, you are working directly with {owner_title} and follow the
  rules of the orchestrator role for decisions, but you may also implement.

## Minimal start

0. Classify the request before loading more context:
   - review or analysis: changes no files;
   - diagnosis: explains the cause with evidence, does not patch blindly;
   - implementation: one component, a few files;
   - structural change: several components, contracts, data, security or
     release. Requires a plan (`plans/README.md`).
1. Read `RULES.md`. Always. It is short and every rule has a reason.
2. Read your role file, `PROJECT.md` and `CONTEXT.md`.
3. Check the model you are running on against your roster entry. If the
   roster forbids it, do nothing else: say so and wait.
4. Run `git status --short` and note changes that are not yours. Another
   session may be working on the same branch right now.
5. If you are resuming work or asked "what is left": `plans/TRACKING.md`,
   the affected plan and the newest file in `continuity/handoffs/`.
6. If you are part of a team, send the orchestrator your status in at most
   five lines (what you have in progress, what waits on {owner_title}, what
   you would do next) and wait for a task. Otherwise, answer the request.

Do not read the whole folder at the start. Read what the task needs, and do
not reread what you already read in this session unless it changed.

## Empty or stale memory

If `PROJECT.md` or `CONTEXT.md` still hold only their seed text, or clearly
describe a state the repository has moved past, say so in your first answer.
Before you finish the session, fill in or correct what you learned, following
`capture/refresh.md`. If you are not the one who writes shared files (see
`RULES.md`, "Who writes the memory"), send what you learned to whoever is.

## Before you call something done

- The checks in `PROJECT.md` ("Verification") pass, and you say which ones
  you could not run.
- The plan you worked on shows its real state.
- You wrote a handoff in `continuity/handoffs/` (`capture/handoff.md`): what
  was closed, what is left and the exact next step.

Direct instructions from {owner_title} in your session take precedence over
these documents.
