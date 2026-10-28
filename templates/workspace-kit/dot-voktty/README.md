# .voktty

This folder is how work on {project_name} is organized when AI agents take
part in it. It holds the rules, the plans, the tracking board, the handoffs
between sessions and the roster of agents. It lives in Git on purpose: what
an agent learns has to survive the end of its session, a change of machine
and a change of provider.

{project_summary}

## Where to start

- Agents: `INIT.md`, when the user enables memory for the session or asks
  you to read it. Installing the kit alone does not enable an integration.
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
files are not replaced or reduced to adapters. Links from those files are
optional persistent edits, separate from session permission. A single agent
can use this memory without a roster, orchestrator or automatic messages.

Reading context and writing captures require separate permission. Automatic
captures also require accepted model cost and an integration that supports
the trigger; direct CLI sessions can use a manually requested capture.

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
