# Capture: a milestone or a plan closed

Run when a milestone's acceptance criteria were checked for real, or when
the last milestone of a plan closes. Write in the project language.

## The agent that closed it

1. In the plan: state `done` with the date, and a Log entry with what was
   done, what turned out different and how it was verified.
2. Your own row in `plans/TRACKING.md`.
3. A `verdict` to the orchestrator (`team/MESSAGING.md`). Working alone,
   continue with the next section yourself.

## The orchestrator

Holding the `memory` lock:

1. `plans/TRACKING.md`: move the item, reorder "Up next", add what now waits
   on {owner_title}, add the work to the release list if it is ready to
   ship.
2. `plans/INDEX.md`: the plan's state; a closed plan moves to "Closed".
3. `CONTEXT.md`: only if a priority, a risk or an active rule changed.
4. `continuity/CHANGELOG.md`: only if the milestone changed architecture,
   a contract, data, security or a flow between components.
5. When a plan closes: its lessons go to `PROJECT.md` ("Project rules" or
   "Traps") or to the domain card they belong to.

Do not copy the plan's detail into the other files: link it.
