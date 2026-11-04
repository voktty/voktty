# Coordination through project files

Use the files in this project to see who is working, reserve paths and leave
notes for another session. This works with independent agents and without
Voktty, an agent board or a running orchestrator. A role applies only when
{owner_title} assigned it; the bundled roster does not start a team.

## Before taking work

Read `../plans/TRACKING.md`, relevant handoffs and your mailbox. Check the
reservations in `.voktty/locks/` before editing. Take a task within the user's
scope, record it in your tracking row and identify the paths it affects.
Respect an explicitly assigned path owner even if it has no active lock.

## Reservations

A work reservation is a `.lock` file in `.voktty/locks/`. Its contents identify
the agent, a unique owner token for that reservation, task, project-relative
paths, shared resources and UTC update time. For example:

```json
{
  "agent": "developer-a",
  "owner": "developer-a-session-20300101T120000Z-claim-1",
  "task": "T-2: editor retry",
  "paths": ["src/editor/"],
  "resources": [],
  "updatedAt": "2030-01-01T12:00:00Z"
}
```

This is a coordination convention, not a permission grant or an implemented
`voktty lock` command. Use a tool with exclusive file creation; an ordinary
exists-then-write sequence cannot establish exclusive ownership. If your
tools cannot perform the procedure below, report that limitation and choose
non-writing work instead of claiming that a lock was acquired.

### Acquire, update and release

1. Exclusively create `.voktty/locks/claims.lock` as a short-lived guard,
   recording its unique owner. If occupied, do other work or leave a blocker;
   do not spin in a polling loop or replace it.
2. While holding that guard, inspect all work reservations. File paths are
   relative to this project; directory reservations include their descendants.
   Normalize separators and respect the filesystem's case behavior. A parent
   directory and a file below it overlap. Shared resource names overlap exactly.
   Unreadable, partial or ambiguous reservations are blockers, not free paths.
3. If the proposed scope is free, exclusively create a uniquely named work
   `.lock` with the complete reservation. Otherwise leave the existing owner
   untouched. Release your guard before starting the actual work.
4. Recheck your reservation before writes. To extend, update or release it,
   acquire the same guard and verify the exact owner token and scope again.
   A stale session cannot remove a successor's reservation. Release only the
   reservation you still own and then your own guard.
5. Keep tracking current and leave a handoff before giving up unfinished work.

The guard serializes reservation changes, not all implementation work. Agents
with disjoint paths can work concurrently. Reserve `memory` as a shared resource
when updating common summaries or indexes, along with their affected paths.
Reserve `heavy-tests` before a full suite or browser run. These names are
coordination resources, not files you may delete to bypass another owner.

An old timestamp alone never proves abandonment. Contact the owner through a
note or ask {owner_title} to confirm it has stopped before recovering a specific
reservation. Do not recover it while that owner can still write. Inspect its
unfinished files and handoff first; recovery does not authorize reverting work.
The same rule applies to a guard left behind by an interrupted session.

`kit.lock.json` contains template versions and hashes. It does not reserve work.
Reservations coordinate cooperating agents sharing this working directory,
including SSH access to the same filesystem. Separate clones do not share live
locks through Git, and a non-cooperating editor is not blocked by these files.

## Notes and messages

Write a new JSON file to `.voktty/mailbox/<recipient>/inbox/` with a unique name
such as `<UTC timestamp>-<sender>-<unique suffix>.json`. Do not overwrite an
existing note. Include the task, paths, evidence and next action in the text:

```json
{
  "from": "developer-a",
  "to": "developer-b",
  "kind": "verdict",
  "text": "Verdict: T-2 passes on abc1234. Review src/editor/retry.ts; browser check not run.",
  "sentAt": "2030-01-01T12:00:00Z"
}
```

Use `task`, `verdict`, `decision`, `blocker`, `status` or `question`. The first
line must stand alone; the recipient has not seen your conversation. No empty
acknowledgements. Send test failures directly to the implementer and important
decisions to the assigned coordinator, if there is one. Otherwise leave them
in the plan or handoff for the next agent.

The recipient reads its inbox at session start and before taking related work.
After processing a note, move that exact file to its `done/` directory without
overwriting an existing file or consuming a replacement. The mailbox does not
wake an agent or promise delivery while it is busy. Runtime messaging may
supplement the files when available, but it is not a dependency.

Mailboxes and locks stay out of Git. Put durable decisions, results and pending
work in plans or `../continuity/handoffs/` so they survive another clone or machine.
A message never grants tool approval or permission for production, pushes or
irreversible actions. {owner_title} decides in the session that executes them.

## Examples

- **One agent:** read context and tracking, reserve the task's paths, implement,
  verify, update summaries under `memory`, write a handoff and release the claim.
- **Two agents:** A reserves `src/editor/`, B reserves `src/search/`. Both work
  concurrently. B needs an editor change: leave A a note and keep working in
  search. A records the result for B. A third claim on `src/editor/retry.ts`
  is blocked by A's directory reservation. Summary edits take `memory` in turn.
- **Interrupted work:** the next session reads the last handoff and reservations,
  confirms the previous owner stopped, recovers only that claim under the guard
  and records its own owner token before continuing. It preserves unfinished edits.
