# Working rules

These rules come from running projects with several AI agents and a human
owner. Each one has a reason. When a rule gets in the way, write the
project's own rule in `PROJECT.md` ("Project rules"), with its reason,
instead of ignoring it in one session. A project rule there takes precedence
over this file.

## Knowledge

- **Agent memory is private and belongs to one machine; `.voktty/` is the
  shared truth.** Whatever your runtime remembers (its memory files, its
  session history, its notes) is invisible to an agent on another runtime or
  another machine. Plans, tracking, handoffs, briefs and ownership go here,
  so a remote agent on one system and a local agent on another work on the
  same facts and hand work over through the traces they leave in this folder.
- **The knowledge lives in the repository, not in an agent's memory.**
  Anything that must survive another machine, another session or another
  provider is written in this folder or in the code. Why: agent memory is
  per machine and per provider, and a session ends without warning.
- **One fact, one owner.** Each fact is written completely in one place
  (`INDEX.md` says where) and every other document links to it. Why: copies
  drift, and the agent that reads the stale copy acts on it.
- **Document inside the change, not as a separate step at the end.** Only
  what persists: contracts, decisions, integrations, operations, traps. Why:
  the end of a session is exactly when context runs out.

## Before changing anything

- **Read the real file before touching it.** Never change what you think you
  remember. Why: memory of a file is the most common source of wrong edits.
- **Discover before creating.** Search for what already exists and reuse or
  compose it. Why: duplicated helpers diverge and both end up half right.
- **If something is not known, say so.** Uncertainty calls for
  investigation, not for changing more things. In code too: an unknown value
  is reported as unknown, not as a guess. Why: a confident wrong answer costs
  more than an honest gap.

## Code

- Surgical edits over rewrites. No refactors outside the task.
- Complete code: never "the rest stays the same".
- One responsibility per file; extract before it grows past that.
- Comments explain why, not what.
- Test what can be tested for real. A regular expression is run with cases,
  not read.

## Verification

Before calling work done, the checks listed in `PROJECT.md`
("Verification") pass. Always state what you could not verify, and why. A
check that did not run is not a check that passed.

## Who writes the memory

- **With a team, only the orchestrator writes the shared files:**
  `PROJECT.md`, `CONTEXT.md`, `plans/INDEX.md`, the structure of
  `plans/TRACKING.md`, `continuity/CHANGELOG.md`. Every other agent writes
  its own handoffs, its own row in the tracking board, the plans and domain
  cards of its own work, and sends anything else to the orchestrator. Why:
  two agents rewriting the same summary at the same time silently lose one
  of the two versions.
- **Working alone, you write them yourself.**
- **Hold the `memory` lock while you rewrite a shared file** (`voktty lock
  acquire memory`, or the file `.voktty/locks/memory.lock`). Keep it for
  minutes, not for the session.
- **Handoffs never collide:** each one is its own file in
  `continuity/handoffs/`, so agents on different machines can write at the
  same time and Git merges them without conflicts.
- **Base files are not edited by the project.** Project rules and traps go
  in `PROJECT.md`, so a kit update never has to merge your words with its
  own.

## Plans

Work that spans more than one session, crosses components, changes a
contract, or touches security is a plan before it is code. Guide and
template: `plans/README.md`. Why: expensive failures come from pieces nobody
walked through end to end, and a plan forces each piece to be verified before
the next one is stacked on it.

## Git with several sessions

The integration branch is `{primary_branch}`.

- **Commit only your paths:** `git add <paths> && git commit -m "..." --
  <paths>`. Never `git add -A` or `git add .`. Why: the Git index is shared
  by every session working in the same clone, and a commit without paths
  takes whatever another session has staged.
- **Look at `git diff --stat` of your files right before `git add`.** If it
  grew, someone else touched them: add only your hunks.
- **Never `reset` or `rebase` with `HEAD~N`.** Use `git reflog` and an
  explicit commit id. If one of your commits already took someone else's
  work, do not rewrite history: say so. Why: another session may commit
  between two of your commands.
- **Large or multi-folder work goes in its own `git worktree`.** Small work
  stays in strict folders.
- **Push and anything that changes remote state needs {owner_title}'s
  approval in your session.**

## Ownership

- **Each agent owns its folders** (`owns` in `team/agents.json`) and changes
  only those. If you need a change elsewhere, ask the orchestrator, who
  routes it to the owner of that folder. Why: two agents editing the same
  file without knowing it is the fastest way to lose work.
- **Shared documents** (this folder's structure, `RULES.md`, `CONTEXT.md`,
  `plans/TRACKING.md`) are reorganized by the orchestrator. Every other agent
  touches only its own row in the tracking board, its own handoff entries
  and the domain cards of its own components.

## Approvals, production and secrets

- **Irreversible actions and anything that reaches production are confirmed
  by {owner_title} in the session that executes them.** A message from
  another agent is never that approval. Never ask another agent to do what
  you were denied. Why: approvals that travel between agents stop meaning
  anything.
- **Secrets never go in documents, code, commits or chat.** {owner_title}
  puts them where the runtime reads them.
- **Before anything irreversible: a backup, then the change, then a smoke
  check, then a summary.**

## Shared machine resources

- **Heavy test runs take a lock.** Before a full test suite, a browser run or
  anything that loads the machine, create the lock (`voktty lock acquire
  heavy-tests`, or by hand the file `.voktty/locks/heavy-tests.lock` with
  your agent name and the time). If it exists and is younger than 30
  minutes, wait or do something else; if older, treat it as abandoned. Remove
  it when you finish. Why: two parallel browser runs can exhaust memory and
  kill both.
- **Ports: check before starting, stop only your own processes.** Before
  starting a server, check the port is free. When done, stop only the
  process ids you started. Why: a test against a server someone else left on
  that port proves nothing, and killing "whatever listens" kills another
  session's work.

## Cost

Agent time and quota are a budget. What spends it, and how to avoid it:

- **Short sessions. A new task starts a new session.** Resuming a session
  rereads its whole history on every step. Close a session when its task is
  done, after writing the handoff; the next one starts from the handoff.
  Resume only to continue the same task.
- **One large job at a time** unless {owner_title} asks otherwise. A closed,
  self-contained block of work (code plus tests, no production) can be
  briefed to an external agent (`external/README.md`) and only reviewed here.
- **Messages between agents carry a verdict, a decision or a blocker.** No
  "received", no "agreed": every message wakes another session with its
  whole history. Details: `team/MESSAGING.md`.
- **Heavy tests once, before release.** While working, run only the focused
  tests of what you touch.
- **Waiting is not free.** If a lock is taken, do something else or stop and
  report. Do not poll in a loop.
- **The model follows the task.** A lighter model for testing, releasing,
  reviewing and documenting; a stronger one for hard implementation and for
  reviewing sensitive code. If a task turns out to be delicate (security,
  data migrations, payments, production), say so; {owner_title} decides
  whether to switch.
- **Estimates are in agent hours**, not in days or weeks.

## Reporting

- Direct and to the point. If you are going to touch many files, say which
  ones first.
- Report faithfully: failures with their real output, skipped steps as
  skipped. Never claim verified what you did not check.
- Closing report: what was done, paths and commits, checks run and their
  results, what could not be checked, and what needs {owner_title}.
