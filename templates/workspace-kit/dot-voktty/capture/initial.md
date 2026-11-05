# Capture: create the first project memory

Use this when asked to create project memory, or when the project map and
context still contain seed text during authorized implementation. Write
project content in the language from `../kit.json`. A read-only request
remains read-only: report missing context without writing it.

## Outcome

Create useful memory from the actual project, not another copy of blank
templates or a summary of this chat. A new session must be able to find the
architecture, current work and exact next step from the project files.
Preparing the kit structure does not mean this initial capture has run.

Use the current agent and its normal tools. Do not start another provider,
team or background turn. If the kit structure is absent, report that it
must first be prepared; do not invent base files or claim installation.

## Inspect the project

1. Read `../INIT.md`, root agent instructions, the README and existing
   architecture and contributor documents. Preserve their rules and use
   their canonical locations rather than copying whole documents here.
2. Check the working tree and relevant history. Separate changes observed
   in the project from work done in this session. Do not infer the owner's
   current goal merely from an old branch, TODO or commit title.
3. Inspect manifests, build configuration, entry points, tests and CI.
   Map source folders and each important component's concrete responsibility.
   Exclude dependencies, generated output and caches from the project map.
4. Trace the important operations through their callers and implementations:
   component connections, data structures or schemas, business rules and
   external services. Names alone do not establish how a flow works.
5. Identify contracts that must not move casually: routes, URLs, commands,
   public entry files, schemas, protocols and formats. Record their consumers
   and what would break if changed. If none were found in the inspected
   scope, say that; do not claim an exhaustive absence without evidence.
6. Find how to install, configure, run and verify the project. Run cheap,
   relevant checks when available. Distinguish documented commands from
   commands actually executed and preserve failures and environment limits.
   Follow project rules for shared heavy-test resources before heavier checks.

## Save into the real kit files

Reserve shared paths and the `memory` resource (`../team/MESSAGING.md`),
then re-read current files before editing. Preserve existing project facts,
rules, active plans, sessions and other agents' work. Fill only the gaps;
an interrupted capture is not permission to regenerate everything.

| Destination, relative to `.voktty/` | What belongs there |
|---|---|
| `PROJECT.md` | Purpose, lifecycle, real stack, map and entry points, setup and run commands, verification, build/release constraints and project-specific traps. |
| `domains/<COMPONENT>.md` | Component responsibilities, callers, data model, important flows and contracts with their consumers, using `domains/_TEMPLATE.md`. |
| `architecture/` | Cross-component rules and decisions that need their own durable reference; link existing canonical documents instead of duplicating them. |
| `CONTEXT.md` | Current verified state, active task when known, incomplete work, decisions and risks needed by the next session. Link details rather than writing one giant snapshot. |
| `plans/INDEX.md`, relevant plan and `plans/TRACKING.md` | Existing active work, next actions, unresolved questions and the initial capture's actual progress. Create a plan only when the work requires one. |
| `continuity/handoffs/` | A new, exclusively created handoff following `handoff.md`: files changed, checks, limits, remaining work and the exact next action. |

Describe configuration requirements by names and documentation references.
Never copy credential values, tokens, secret files or unnecessary personal
paths into the memory. Project observation grants no new tool permissions.
Do not run migrations, deployments or releases just to document their commands.

Use the project language for content; base guides remain unchanged. Leave
optional roster and team configuration alone unless the task asks for them.
One agent can complete this capture without creating a team.

## Verify the first memory

- Re-read the documents you wrote. Paths and cross-links must exist or be
  explicitly identified as planned. Keep facts, inferences and unknowns distinct.
- A new session can locate the real entry points, relevant contracts, setup
  requirements, verification results and active work without this conversation.
- Mark unconfirmed facts as unverified. Do not promise perfect reconstruction
  or describe an unexecuted command as a passing check.
- Update your tracking row, write the handoff and release only your own
  completed reservations. If interrupted, record what was inspected and the
  exact next file or action; keep already saved project content.

Report to {owner_title} what was written, what was verified, what remains
unknown and whether this first capture is complete or still partial. Files
existing, a prompt being prepared or a model responding do not by themselves
prove that project context was saved.

For later work, use `refresh.md` to update facts, `milestone.md` when a work
block closes and `handoff.md` before ending or compacting a changed session.
This is the project's ongoing save-and-resume method, not a one-time report.
