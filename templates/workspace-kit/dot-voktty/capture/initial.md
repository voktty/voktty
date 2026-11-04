# Capture: initial reading of the project

Follow this when the project map or context still contains seed text and
the user's work includes implementation or initial project analysis with
documentation. Write in the project language (`../kit.json`, `language`).
For a read-only request, report what is missing without filling it in.

## Goal

Leave `PROJECT.md`, `CONTEXT.md` and the domain cards good enough that the
next agent, on any runtime, can start working without rediscovering the
project.

## Steps

1. Read the root `AGENTS.md`, `README.md` and any existing architecture or
   contributor documents. They are the project's own words; prefer them to
   your inferences.
2. Map the repository: top-level folders, manifests (package, build and
   dependency files), entry points, test setup, CI configuration, release
   scripts. Read files; do not guess from names alone.
3. Identify the components: units with their own responsibility, code
   folder and contracts with the rest. Usually between 2 and 12.
4. Run the cheapest checks you can (type check, lint, a focused test) to
   confirm the verification commands. Do not run full suites, browsers or
   anything that loads the machine without the heavy-test lock.
5. Reserve the affected paths and `memory` resource (`../team/MESSAGING.md`),
   re-read the current documents and write what is relevant:
   - `PROJECT.md`: what it is, the map, stack and environment, the
     verification commands you confirmed, build and release as far as you
     could see, and traps you found (for example, a step the README gets
     wrong).
   - `domains/<COMPONENT>.md` for each component, from `domains/_TEMPLATE.md`.
   - `CONTEXT.md`: what seems in progress (open branches, recent commits,
     TODO lists), active risks you saw.
6. Leave team configuration alone unless it is part of the user's task.
   Reading a project does not require creating or starting a team.
7. Write a handoff (`handoff.md`), update tracking and release your reservations.

## Rules

- Mark everything you inferred but could not confirm with "(unverified)".
- Keep each card short. A card that tries to document the whole component
  will not be maintained.
- Your answer to {owner_title}: what you wrote, what you could not confirm,
  and the questions only they can answer.
