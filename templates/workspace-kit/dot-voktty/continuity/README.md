# Continuity

`../CONTEXT.md` is the short reading at the start of a session: one page,
updated when a priority, a risk or an active rule changes.

- `handoffs/` (immediate handoff): one file per session that changed
  something, saying what was closed, what is left, the exact next step and
  references. How to write one: `../capture/handoff.md`.
- `CHANGELOG.md`: milestones with impact on architecture, contracts, data,
  security or flows between components. Written by the orchestrator.

Routes, decisions and contracts that already live in `../domains/`,
`../architecture/` or a plan are linked here, not copied. Handoffs and the
changelog are written in the project language.

## Why handoffs

A session can end at any moment: the context fills up, the machine
restarts, the quota runs out. The handoff is what lets the next session, on
any machine and any runtime, continue without rediscovering the state. An
entry that says "continue the work" is useless; an entry that says "run the
migration test in tests/migrate.sh, it failed on step 3 with a lock
timeout" is a handoff.

## Why one file per handoff

Agents on different machines finish sessions at the same time. If they all
prepend to one log, every merge conflicts on its first lines. One file per
handoff, named so that names sort by time, merges cleanly and still reads in
order.
