# Capture: refresh the memory

Run when Voktty's periodic trigger fires, when someone presses "Save
context", or when you notice the memory is empty or behind the repository.
Write in the project language.

## Steps

1. Compare the memory with reality:
   - `git log` since the last change to `CONTEXT.md` and `PROJECT.md`;
   - the plans marked in progress and their real state;
   - what you did and learned in this session.
2. If you are the orchestrator, or working alone, update holding the
   `memory` lock:
   - `CONTEXT.md`: priorities, risks and active rules that changed. Keep it
     to one page; move detail to plans or cards.
   - `PROJECT.md`: new components, changed verification commands, new
     project rules and traps.
   - `plans/TRACKING.md` and the active plan: their real state.
3. If you are another agent: write what should change in your handoff and
   send it to the orchestrator as a `status` message. Do not rewrite shared
   files.
4. If nothing changed, change nothing. A refresh with no edits is a valid
   result; say so in one line.

Never rewrite a file only to restyle it. Every edit should carry a fact the
next session needs.
