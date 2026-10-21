# {project_name}

What this project is, how it is built and checked, and the rules that apply
only here. Written in the project language by the orchestrator (or by the
only agent, when working alone). Filled in on the first capture
(`capture/initial.md`) and kept current by later ones.

## What it is

{project_summary}

## Map

The main components, where their code lives and who owns each one. One line
per component; detail goes in `domains/<COMPONENT>.md`.

| Component | Path | Owner | Card |
|---|---|---|---|
| | | | |

## Stack and environment

Languages, frameworks, package managers, runtimes and the tools an agent can
expect on the machine.

## Verification

The checks that must pass before work is called done:

```
{verify_commands}
```

## Build and release

How the project is built and released, and who may release.

## Project rules

Rules that apply only to this project, each with its reason and date. A rule
here takes precedence over `RULES.md`.

## Traps

What cost a session once and will cost it again: the symptom, the cause and
how to avoid it. Search by keyword before touching an area.
