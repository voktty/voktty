# AI Agent Guide

This file applies to any AI coding agent working in Voktty. It defines the operational contract. `VOKTTY.md` remains the canonical architecture and invariant reference. `PROMPTS/` contains private operational continuity material in Spanish.

## Priority and scope

Follow instructions in this order:

1. System, platform, and user instructions.
2. This file.
3. `VOKTTY.md` and the relevant canonical document under `docs/`.
4. The active plan and continuity records under `PROMPTS/`.

Do not widen the task without authorization. For an analysis, review, or diagnosis request, inspect and report evidence without editing production files. For an implementation request, make the smallest complete change that satisfies the request, verify it, and report the result.

## Required session start

Before proposing or changing code, complete this sequence:

1. Read `VOKTTY.md` completely.
2. Read `PROMPTS/iniciar.txt`, `PROMPTS/INDICE.md`, and the active plan or snapshot relevant to the task.
3. Run `git status --short`. Treat every existing change as user-owned unless the task clearly identifies it.
4. Classify the work:
   - **Review or diagnosis**: read-only investigation and evidence-backed findings.
   - **Focused change**: a local component, hook, copy, or test change.
   - **Cross-cutting change**: IPC, PTY, filesystem, workspace authorization, Git, secrets, network, persistence, protocol, or platform behavior.
5. Discover the relevant code before editing. Use `graphify query`, `graphify explain`, and `graphify path` when the graph is available. Otherwise use `rg` first and direct file reads second. Inspect callers, ownership boundaries, tests, and platform-specific paths before changing a public contract.

If a required document or graph is unavailable, state the limitation and use the safest direct inspection path. Never invent repository state.

## Architecture boundaries

- Rust in `src-tauri/` owns operating-system access, processes, PTYs, filesystem, Git, network proxying, secrets, and persistent native state.
- React in `src/` owns presentation, interaction, local view state, and typed IPC clients. It must not bypass Rust ownership of native resources.
- Keep a functional core and imperative shell. Put new rules, parsers, transforms, and state transitions in small dependency-light functions with tests. Keep Tauri commands and React components thin.
- Preserve the module boundary. New frontend behavior belongs in the matching `src/modules/<area>/` module, not in `App.tsx` unless it is application composition.
- Treat IPC, serialized state, wire protocols, persisted schemas, and Tauri commands as contracts. Validate input at the Rust boundary, constrain size and lifetime, define failure behavior, and add regression coverage before expanding them.
- Preserve cross-platform behavior. Inspect Windows, macOS, Linux, WSL, SSH, Docker, SMB/UNC, and Android branches when the changed path can reach them. Do not assume POSIX paths or local filesystems.

## Safety, security, and data handling

- Never expose or log keys, tokens, private paths, environment variables, credentials, or user content unnecessarily.
- Keep secret-path protections on both reads and writes. Do not add bypasses for convenience.
- Do not weaken workspace authorization, SSRF protection, Tauri capabilities, command approval, process ownership, or protocol authentication to make a feature work.
- Prefer bounded resources: explicit timeouts, size limits, cancellation, cleanup ownership, and stale-result protection for asynchronous work.
- Do not add a dependency when a maintained existing capability is sufficient. Evaluate bundle size, runtime cost, platform support, licensing, and supply-chain impact before adding one.
- Do not make destructive filesystem, Git, migration, or external-service changes unless the user explicitly authorized the exact scope.

## Implementation discipline

- Read the whole file before editing it. Follow existing local patterns rather than introducing a parallel abstraction.
- Use `apply_patch` for edits. Keep diffs narrow and avoid unrelated formatting, refactors, lockfile churn, generated files, or dependency upgrades.
- Use `rg` or `rg --files` for discovery. Do not use broad slow searches when a scoped query is possible.
- Frontend imports use `@/...`; do not introduce cross-module relative imports.
- Use `pnpm` only. Never use npm, npx, or yarn.
- Keep code self-explanatory. Comments explain a non-obvious reason, not an implementation narration. Do not add AI filler, emojis, or em dashes.
- Keep tracked documentation and contributor-facing text in English. `PROMPTS/` is the only Spanish operational area. Do not create plans, snapshots, handoff notes, or work logs outside `PROMPTS/`.
- Update a canonical document only when the implementation changes its long-lived contract. Update `PROMPTS/` for task status, decisions, and handoff context.

## Verification

Run checks proportional to risk, and always run these after any code change:

```bash
pnpm check-types
pnpm test
```

Also run the relevant focused checks, such as `pnpm lint`, i18n validation, format checks, build checks, or targeted tests. For Rust changes, run:

```bash
cd src-tauri && cargo clippy --all-targets --locked -- -D warnings
cd src-tauri && cargo nextest run --locked
```

Use `cargo test --locked` only when `cargo-nextest` is unavailable. If the environment lacks a required tool or a command hangs, do not claim it passed. Record the exact fallback command, outcome, and limitation.

Every core-subsystem change needs a test that protects its invariant. A passing typecheck is not behavioral verification.

## Git and handoff

- Inspect `git diff`, `git diff --check`, and `git status --short` before committing.
- Stage only files that belong to the task. Preserve unrelated changes and untracked user files.
- Never run destructive Git commands such as `reset --hard`, force-push, or history rewriting unless explicitly requested.
- Do not push, open pull requests, merge, or modify remote state unless explicitly requested.
- Use concise imperative commit messages that describe the change. Do not include unrelated cleanup in the same commit.
- After meaningful work, update the relevant Spanish plan, snapshot, or log under `PROMPTS/` with completed work, verification, known limits, and the next safe step.

## Completion standard

Report the outcome first, then the key implementation facts, validation results, limitations, and commit or push state. Never describe work as complete when required checks, platform validation, or an agreed acceptance criterion remains outstanding.
