# Capture: handoff

Run at the end of every session that changed something, and before your
context is compacted or cleared. Write it while you still remember: after
compaction, the details are gone. Write in the project language.

## Where

A new file in `continuity/handoffs/`, named `YYYY-MM-DD-HHMM-<agent>.md` in
UTC (`solo` when working without a team). Never edit another agent's
handoff.

## Format

```markdown
# <agent> · YYYY-MM-DD HH:MM UTC · <one-line summary>

- **Plan:** <plan file and milestone, or "none">
- **Done:** what was closed, with commits.
- **Verified:** checks that ran and their results.
- **Not verified:** what could not be checked, and why.
- **Left:** what remains.
- **Next step (exact):** the first command or action of the next session.
- **Waiting on {owner_title}:** decisions or actions, if any.
- **Traps:** anything that cost time and will cost it again.
```

## Also

- Update your own row in `plans/TRACKING.md`.
- If something belongs in a shared file (`PROJECT.md`, `CONTEXT.md`), say it
  in the handoff and, in a team, send it to the orchestrator. Do not rewrite
  shared files you do not own.
- "Next step" is a command or an action, not "continue the work".
