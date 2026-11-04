# Capture guides

A freshly deployed `.voktty/` is mostly empty. These guides tell the agent
what to write as it learns about the project and completes work. Context,
plans and handoffs are part of ordinary implementation, not a separate
memory permission workflow. Read-only requests remain read-only.

The files are usable without Voktty or a scheduling service. Follow them
at the relevant point in your work; do not wait for a background trigger.
Do not start another agent or paid turn merely because a setting exists.

| Trigger | Instruction | Who runs it | Files it writes |
|---|---|---|---|
| Project context still contains seed text | `initial.md` | the agent doing the initial reading | `PROJECT.md`, `CONTEXT.md`, relevant `domains/*.md` |
| A milestone or a plan closes | `milestone.md` | the agent that closed it, or an explicitly assigned summary owner | the plan, `plans/INDEX.md`, `plans/TRACKING.md`, `CONTEXT.md`, `continuity/CHANGELOG.md` when there is impact |
| A session ends, or the agent is about to compact its context | `handoff.md` | every agent | one new file in `continuity/handoffs/`, the agent's own row in `plans/TRACKING.md` |
| A work block changes facts or reveals stale context | `refresh.md` | the agent doing the work, respecting reservations and assigned owners | `CONTEXT.md`, `PROJECT.md`, `plans/TRACKING.md`, the active plan |
| The user requests compacting or archiving | `compact.md` | the assigned agent, respecting reservations | live files, `archive/YYYY-MM/`, `archive/LOG.md` |

`../kit.json` contains project language, size limits and existing capture
preferences. Those values are configuration, not evidence that a runtime
observes turn counts, session end, timers or context compaction. Automatic
trigger delivery is separate integration work; it is not needed to follow
these guides. Do not claim that a capture ran without checking its files.

## Two writers, one file

Reserve affected paths and the `memory` resource before rewriting shared
summaries or indexes (`../team/MESSAGING.md`). Re-read the files after taking
the reservation. Respect an explicitly assigned summary owner and send it
your findings when needed. Without that assignment, the agent doing the
work can update summaries itself. Each agent writes a uniquely named handoff.
These reservations coordinate the same working directory, not separate clones.

## What a capture never does

- It never invents. What is unknown is written as unknown.
- It never deletes history: plans, handoffs and changelog entries are
  appended or marked closed, not removed.
- It never commits by itself unless the agent's task says so, and then only
  the files it wrote, by path.
- It never copies secrets, tokens or personal data into the memory.
