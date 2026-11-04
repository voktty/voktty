# Capture: handoff

Run at the end of every session that changed something, and before your
context is compacted or cleared. Write it while you still remember: after
compaction, the details are gone. Write in the project language.

## Where

A new file in `continuity/handoffs/`, named `YYYY-MM-DD-HHMM-<agent>.md` in
UTC (`solo` when working without a team). Create it exclusively; if that
name exists, add a unique suffix instead of replacing it. Never edit another
agent's handoff.

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
- **Coordination:** reservations released or still held, notes sent and who
  should take the next piece of work.
```

## Also

- Update your own row in `plans/TRACKING.md`.
- Update shared facts under a reservation. If another agent owns those
  files, record the finding here and send that owner a note instead
  (`../team/MESSAGING.md`). Release only your own completed reservations.
- "Next step" is a command or an action, not "continue the work".
