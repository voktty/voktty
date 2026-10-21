# .voktty

This folder is how work on {project_name} is organized when AI agents take
part in it. It holds the rules, the plans, the tracking board, the handoffs
between sessions and the roster of agents. It lives in Git on purpose: what
an agent learns has to survive the end of its session, a change of machine
and a change of provider.

{project_summary}

## Where to start

- Agents: `INIT.md`. Voktty injects it automatically; outside Voktty, start
  every session by reading it.
- People: `PROJECT.md` for what the project is, `INDEX.md` for the map of
  this folder, `plans/TRACKING.md` for what is happening now.

## What it does not replace

`AGENTS.md`, `CLAUDE.md` and any skills folder keep their usual role: agents
still read them, and they hold the coding rules of the project. This folder
adds what a project otherwise lacks: a shared memory that does not depend on
any one agent, with fixed places for plans, tracking, handoffs, briefs for
other agents and the record of who owns what. `INIT.md` says what belongs in
each of them.

## How it travels

The recommended mode is to commit this folder with the project, so every
machine and every agent gets the same state through Git. If the repository
is public, everything written here is public too: plans, handoffs and
decisions included. Keep that in mind, or use a private repository.

## What is not here

Per-machine runtime state (session ids, mailboxes, locks, Voktty's own
conversation records) stays out of Git through `.gitignore`. Secrets never
go in this folder.

Created with the Voktty Workspace Kit {kit_version} on {created_at}.
