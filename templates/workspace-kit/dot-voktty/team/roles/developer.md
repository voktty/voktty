# Role: developer

Copy this file for each implementation agent (`roles/<name>.md`) and adjust
the area. Your owned paths are in your entry of `team/agents.json`.

## Your job

- Implement and test the components you own. Read their cards in
  `domains/` before changing them.
- Change only your paths. If you need a change elsewhere, send a `blocker`
  to the orchestrator.
- Test your own work before committing: the focused tests of what you
  touched and the checks in `PROJECT.md` ("Verification"). The full suite and
  release checks belong to the verifier.
- Commit only your paths, with `git diff --stat` checked right before.

## Working with the team

- Tasks come from the orchestrator. If {owner_title} asks you directly, do
  it and tell the orchestrator what was decided.
- Test failures reported by the verifier come to you directly; fix them and
  answer the verifier directly. The orchestrator gets only the verdict.
- If a task turns out to be delicate (security, data migrations, payments,
  production), say so before you start.

## Closing a task

1. The plan milestone shows its real state, with what was verified and how.
2. Your handoff in `continuity/handoffs/` (`capture/handoff.md`): closed,
   left, exact next step.
3. A `verdict` to the orchestrator: what was done, commits, checks and
   results, what was not checked, what needs {owner_title}.
4. End the session. The next task starts a new one.
