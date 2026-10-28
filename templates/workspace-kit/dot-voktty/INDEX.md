# Index

`INIT.md` is the entry point when memory use is enabled. This index maps the
folder; it does not depend on any agent's memory.

## Base and content

- **Base files** come from the kit, stay in English and are not edited by the
  project: `INIT.md`, `RULES.md`, this index, every `README.md` and
  `_TEMPLATE.md`, `team/MESSAGING.md`, `team/agents.schema.json`, the bundled
  roles and `capture/`. A kit update replaces them only if the project never
  changed them.
- **Content** belongs to the project, is written in the project language and
  is never touched by a kit update: `PROJECT.md`, `CONTEXT.md`,
  `team/agents.json`, custom roles, plans, tracking, handoffs, the changelog,
  domain and architecture cards, rituals schedule, briefs and the archive.

## Zones

| Zone | Content | When to read it |
|---|---|---|
| `RULES.md` | working rules and their reasons | every session |
| `PROJECT.md` | what the project is, map, verification, project rules, traps | every session |
| `CONTEXT.md` | one page: priorities, risks, active decisions | every session |
| `team/` | optional roster, roles, messaging protocol | when assigned a team role or explicitly delegating |
| `plans/` | plan guide, plan index, tracking board | when planning, resuming or asked "what is left" |
| `continuity/` | handoffs and impact changelog | when starting and closing a session |
| `capture/` | what to write at each trigger: setup, milestone, handoff, refresh, compaction | when the trigger fires |
| `domains/` | one card per component | only the card of the component you touch |
| `architecture/` | cross-cutting standards | when creating a component or crossing two |
| `rituals/` | recurring tasks and their schedule | when a ritual is due |
| `external/` | briefs for agents working outside the team | when handing off a closed block of work |
| `archive/` | closed history by month | when you need the history of something |

## One fact, one owner

| What | Where |
|---|---|
| Working rules | `RULES.md` |
| Project rules, traps, verification commands | `PROJECT.md` |
| Current priorities, risks and decisions | `CONTEXT.md` |
| Who the agents are and what they own | `team/agents.json` |
| What a role does | `team/roles/<role>.md` |
| How agents communicate | `team/MESSAGING.md` |
| How a component fits with the rest | `domains/<COMPONENT>.md` |
| Cross-cutting standards | `architecture/<STANDARD>.md` |
| Work that spans sessions | a plan, listed in `plans/INDEX.md` |
| What happens next and who does it | `plans/TRACKING.md` |
| Immediate handoff and exact next step | the newest file in `continuity/handoffs/` |
| History of changes with impact | `continuity/CHANGELOG.md` |
| Closed history | `archive/YYYY-MM/` |

No plans, handoffs or architecture documents are created outside these
zones. A component documents its own operation next to its code and is only
linked from here.
