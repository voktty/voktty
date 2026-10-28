# Capture

A freshly deployed `.voktty/` is mostly empty: what the project is only
becomes clear as work happens. The memory fills up and stays true because
specific moments trigger a capture. Each file here is the instruction an
agent follows at one of those moments. Automatic delivery requires an enabled
memory session, separate capture consent (including model cost), an available
agent and a supported integration. The settings below do not grant consent.
Without that integration, use these instructions only on request; direct CLI
launches do not guarantee turn, session-end or compaction detection. Reading
project memory alone does not authorize captures or start another agent.

| Trigger | Instruction | Who runs it | Files it writes |
|---|---|---|---|
| A folder with existing code is set up | `initial.md` | orchestrator, or the only agent | `PROJECT.md`, `CONTEXT.md`, `domains/*.md`, `team/agents.json` (proposal only) |
| A milestone or a plan closes | `milestone.md` | the agent that closed it, then the orchestrator | the plan, `plans/INDEX.md`, `plans/TRACKING.md`, `CONTEXT.md`, `continuity/CHANGELOG.md` when there is impact |
| A session ends, or the agent is about to compact its context | `handoff.md` | every agent | one new file in `continuity/handoffs/`, the agent's own row in `plans/TRACKING.md` |
| Periodic (turns, minutes or commits) or the "Save context" button | `refresh.md` | the agent asked; shared files only by the orchestrator | `CONTEXT.md`, `PROJECT.md`, `plans/TRACKING.md`, the active plan |
| A live file passes its limit, the weekly ritual, or the "Compact memory" button | `compact.md` | orchestrator, or the only agent | live files over their limit, `archive/YYYY-MM/`, `archive/LOG.md` |

Settings live in `../kit.json` under `capture`:

- `onSessionEnd`: send `handoff.md` when a session that changed files ends.
- `beforeCompaction`: send `handoff.md` when the agent's context use passes
  `compactionThresholdPercent`, so the handoff is written while the agent
  still remembers.
- `every`: periodic `refresh.md` after a number of `turns`, `minutes` or
  `commits` (0 turns that one off).
- `staleAfterCommits`: warn when the project has this many commits since
  `CONTEXT.md` or `PROJECT.md` last changed.

Size limits per live file are under `limits`, and archiving under
`archive`. The planned Voktty integration measures them: when a limit is
passed, an authorized capture can queue `compact.md` for the orchestrator
or the only agent. Until implemented, measurement and capture are manual.

## Two writers, one file

With a team, shared files have one writer: the orchestrator (`RULES.md`,
"Who writes the memory"). Other agents capture into their own handoffs and
send the orchestrator a message with what should change. Rewriting a shared
file takes the `memory` lock for the minutes it lasts. Voktty also runs at
most one capture at a time per project once that integration is available.
Without an active team, the authorized single agent writes shared files.
Local locks do not serialize writers on other machines or hosts.

## What a capture never does

- It never invents. What is unknown is written as unknown.
- It never deletes history: plans, handoffs and changelog entries are
  appended or marked closed, not removed.
- It never commits by itself unless the agent's task says so, and then only
  the files it wrote, by path.
- It never copies secrets, tokens or personal data into the memory.
