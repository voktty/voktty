# External briefs

A closed block of work (code plus tests, no production access) can be handed
to an agent that is not part of the team: another runtime, a cloud agent, a
contractor's tool. This folder holds those briefs.

## Why

A self-contained block done elsewhere costs the team only the review. It
also forces the work to be described completely, which catches gaps before
anyone writes code.

## Rules

- **The brief is complete.** The external agent has no access to the team's
  conversations. Everything it needs is in the brief or linked from it: the
  goal, the plan milestone, the files it may change, the contracts it must
  respect, the acceptance criteria and how to run the checks.
- **Its own worktree, created before the brief is sent.** The external agent
  works on its own branch and never on the shared checkout.
- **Its own test resources.** Its own database, ports and data, separate from
  the team's.
- **No production, no release, no secrets.** The team reviews, tests and
  releases.
- **It leaves a trace.** The external agent writes its progress and its
  verdict at the end of the brief (the "Log" section), so a later session,
  of any runtime, can resume or review it.

## Brief files

One per brief: `YYYY-MM-DD-short-topic.md`, from `_TEMPLATE.md`.
