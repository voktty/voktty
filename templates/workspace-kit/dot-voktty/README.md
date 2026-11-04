# .voktty

This folder is how work on {project_name} is organized when AI agents take
part in it. It holds the rules, the plans, the tracking board, the handoffs
between sessions and the roster of agents. It lives in Git on purpose: what
an agent learns has to survive the end of its session, a change of machine
and a change of provider.

{project_summary}

## Where to start

- Agents: `INIT.md`, through the project's usual agent instructions. Follow
  its pointers to context, active work, reservations, notes and handoffs.
- People: `PROJECT.md` for what the project is, `INDEX.md` for the map of
  this folder, `plans/TRACKING.md` for what is happening now.

## What it does not replace

`AGENTS.md`, `CLAUDE.md` and any skills folder keep their usual role: agents
still read them, and they hold the coding rules of the project. This folder
adds what a project otherwise lacks: a shared memory that does not depend on
any one agent, with fixed places for plans, tracking, handoffs, briefs for
other agents and the record of who owns what. `INIT.md` says what belongs in
each of them.

Platform, user and runtime instructions retain precedence. Existing agent
files are not replaced or reduced to adapters. Their links point to this
memory while preserving their existing rules. A single agent can work
without a roster or orchestrator; independent agents coordinate through
`team/MESSAGING.md` using files in this project.

During ordinary implementation, agents keep context, plans and handoffs
current. Read-only requests remain read-only. The guides in `capture/`
describe that work; they do not start agents or paid background jobs.

## How it travels

The recommended mode is to commit this folder with the project, so every
machine and every agent gets the same state through Git. If the repository
is public, everything written here is public too: plans, handoffs and
decisions included. Keep that in mind, or use a private repository.

## What is not here

Live coordination and runtime state (session ids, mailboxes, locks,
Voktty's own conversation records) stays out of Git through `.gitignore`.
Agents sharing this working directory see those files, including over SSH.
Separate Git clones share documents, not live reservations or mailbox
delivery. Secrets never go in this folder.

Created with the Voktty Workspace Kit {kit_version} on {created_at}.
