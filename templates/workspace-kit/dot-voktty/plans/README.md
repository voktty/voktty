# Plans

Every large request becomes a plan written here **before** code is touched.
A plan is a short document with milestones, and each milestone leaves the
system working.

## Why

The expensive failures in agent-driven projects are rarely one badly written
function. They are pieces nobody walked through end to end: a first release
uncovers one failure after another, each one hiding the next. A plan with
milestones forces each piece to be walked, verified and written down before
the next one is stacked on it.

It is also history. Months later, the reason behind a decision is here, with
its date, and not in the memory of a session that no longer exists.

## When a plan is needed

- The request touches more than one component.
- It changes a contract: URLs, APIs, data schemas, file formats.
- It will take more than one session, or can be interrupted halfway.
- It touches security: authentication, permissions, secrets.

A one-line fix does not need a plan. When in doubt, it does.

## How to write one

One file per plan: `YYYY-MM-DD-short-topic.md`, listed in `INDEX.md`. The
template is at the end.

- **Small milestones, in dependency order.** Each fits in one session. When
  it closes, the project builds, what is released works, and nothing half
  done is visible to users. A milestone that leaves something broken until
  the next one is cut wrong.
- **Every milestone has an acceptance criterion someone can check.** Not
  "login works", but "signing in with a password and a second factor asks
  for the code; a code from three minutes ago is rejected; a recovery code
  works once". If it cannot be checked, it is not a criterion.
- **Decisions come with their reason,** both the ones taken and the ones
  discarded. That is what gets lost between sessions.
- **Risks before starting:** what can go wrong, how it would show, how it is
  mitigated.
- **Estimates in agent hours.**

## How to work with it

1. Write the plan and show it before the first milestone starts.
2. Starting a milestone: its state becomes `in progress`.
3. Closing it: check its acceptance criterion for real, not by reading code.
   State becomes `done` with the date, and the **Log** records what was done,
   what turned out different and how it was verified.
4. **Never start the next milestone with the previous one broken.** Fix it or
   replan in writing, in the plan itself.
5. If the scope changes halfway, change the plan first.
6. After the last milestone: lessons go to `PROJECT.md` ("Project rules") or
   the relevant domain card, and the plan is marked **closed**. It is not
   deleted: it is history.

Closing a milestone or a plan also updates the tracking board and the
context (`../capture/milestone.md`). Every handoff in
`../continuity/handoffs/` points at the plan in progress and the milestone
it is on. Whoever resumes the work starts there.

Plans are written in the project language, with two exceptions that tools
read: the state words (`pending`, `in progress`, `done` for milestones;
`open`, `written`, `waiting`, `parked`, `closed` for plans) and item ids
(`[T-n]`, `[D-n]`, `[Q-n]`) stay exactly as written here, in every language.
Voktty uses them to notice a closed milestone and to check that compaction
lost nothing.

## Template

```markdown
# Plan: <title>

Date: YYYY-MM-DD · State: **open** | closed YYYY-MM-DD
Original request: <what was asked, in its own words>

## Goal
What must be true at the end, in three or four sentences.

## Decisions
- **<decision>.** Why. What was discarded and why.

## Risks
- <risk>: how it would show; how it is mitigated.

## Milestones

### M1: <name> · pending · ~N agent hours
Deliverables:
- ...
Acceptance criteria:
- [ ] <checkable>
How it is verified: <command, test, screen>

### M2: ...

## Out of scope
What was asked, or could be assumed included, and is not. With the reason.

## Log
- YYYY-MM-DD: M1 done. <what turned out different>. Verified with <...>.
```
