# Tracking

What happens next, who does it and what waits on {owner_title}. Maintained
by the orchestrator; each agent updates only its own row. Plans hold the
detail; this board holds the order. Written in the project language.

Every item carries an id (`[T-n]` task, `[Q-n]` waiting on {owner_title}),
never reused, so compaction can be checked (`../capture/compact.md`).
Keep "Up next" to the limit in `../kit.json`.

## Up next

- [T-1] Fill in `PROJECT.md` and `CONTEXT.md` (`../capture/initial.md`).

## Waiting on {owner_title}

Decisions and actions only {owner_title} can take, oldest first, each with
the plan it blocks.

- None yet.

## Agents

| Agent | Working on | State | Last update |
|---|---|---|---|
| orchestrator | | idle | {created_at} |
| developer | | idle | {created_at} |
| verifier | | idle | {created_at} |

## Release list

Work that is verified and waiting for approval to ship, in the order it will
ship.

- None yet.
