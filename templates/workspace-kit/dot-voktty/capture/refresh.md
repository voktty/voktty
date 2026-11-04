# Capture: refresh the memory

Follow this when a work block changes project facts or reveals stale
context. Write in the project language. During a read-only request, report
the discrepancy without changing files.

## Steps

1. Compare the memory with reality:
   - `git log` since the last change to `CONTEXT.md` and `PROJECT.md`;
   - the plans marked in progress and their real state;
   - what you did and learned in this session.
2. Reserve the affected paths and `memory` resource, then re-read and update
   the documents you own (`../team/MESSAGING.md`):
   - `CONTEXT.md`: priorities, risks and active rules that changed. Keep it
     to one page; move detail to plans or cards.
   - `PROJECT.md`: new components, changed verification commands, new
     project rules and traps.
   - `plans/TRACKING.md` and the active plan: their real state.
3. If another agent has an assigned ownership or reservation: leave the
   finding in your handoff and send that owner a note. Do not overwrite its
   work or wait for an orchestrator that has not been assigned.
4. If nothing changed, change nothing. A refresh with no edits is a valid
   result; say so in one line.
5. Release only your own reservations and keep your tracking row current.

Never rewrite a file only to restyle it. Every edit should carry a fact the
next session needs.
