# Claude Code Guide for Voktty

You are working in Voktty, a production desktop development environment built with Tauri 2, Rust, React 19, TypeScript, xterm.js, CodeMirror, and the Vercel AI SDK. Be deliberate, evidence-driven, and economical with context. Deliver production-quality changes, not plausible prototypes.

`AGENTS.md` is the shared operational contract for every coding agent. This file adds Claude-specific working guidance. `VOKTTY.md` is the canonical architecture and invariant reference. If documents conflict, follow higher-priority instructions, then `AGENTS.md`, then `VOKTTY.md`.

## Start every task correctly

Before changing code:

1. Read `AGENTS.md` and `VOKTTY.md` completely.
2. Read `PROMPTS/iniciar.txt`, `PROMPTS/INDICE.md`, and the relevant active plan or continuity snapshot. `PROMPTS/` is private operational material in Spanish.
3. Run `git status --short` and protect every pre-existing change.
4. State the task classification internally: review, diagnosis, focused implementation, or cross-cutting implementation.
5. Map the affected path before editing. Prefer `graphify query`, `graphify explain`, and `graphify path` when available. Otherwise use focused `rg` queries and read the implementation, its callers, types, tests, and platform branches.

Do not start with a speculative patch. When the request is ambiguous but a safe read-only investigation can reduce uncertainty, investigate first. Ask for direction only when a choice materially changes user-visible behavior, data, security, or external state.

## Claude working model

### Build an evidence chain

For every non-trivial change, establish:

1. The current behavior and where it is implemented.
2. The contract or invariant that must remain true.
3. The smallest responsible owner for the change.
4. The tests that prove the new behavior and guard the regression.
5. The platform, lifecycle, performance, and security consequences.

Use exact symbols, file paths, and observed behavior. Do not infer behavior from filenames or comments alone. When a claim depends on source code, inspect that source code.

### Keep the solution narrow

Prefer an end-to-end vertical slice over a broad partial framework. Reuse existing domain types, lifecycle states, error conventions, and UI primitives. Avoid opportunistic refactors, file moves, dependency changes, or formatting churn unless they are necessary to fulfill the request.

When an existing abstraction is close but unsafe, fix the abstraction at its owner rather than layering a local workaround. Keep pure logic separate from Tauri lifecycle and React rendering so it can be tested directly.

### Treat boundaries as hostile

Validate at every boundary: webview to Tauri, local to remote, disk to parser, process to lifecycle manager, and model to tool execution. For inputs crossing a boundary, establish allowed shape, size, timeout, ownership, cancellation, cleanup, and error behavior.

Never trade away authorization, secret redaction, path safety, process cleanup, replay protection, or resource bounds for implementation speed. A feature that works only on the happy path is incomplete.

## Voktty-specific non-negotiables

- Rust owns filesystem access, process execution, terminals, secrets, Git, native networking, and persistent native state. The frontend communicates through typed Tauri commands only.
- Do not weaken workspace authorization or the secret-path deny-list. Apply security checks to both reads and writes.
- Terminal, PTY, shell integration, and Windows Job Object behavior have strict lifecycle invariants. Read the relevant section in `VOKTTY.md` before touching them.
- `App.tsx` is a coordinator. Put feature behavior in the appropriate module under `src/modules/`.
- Do not unmount live tabs merely to hide them. Tabs retain resources intentionally.
- Preserve canonical frontend paths and platform normalization rules. Do not assume a local POSIX filesystem.
- Use `@/...` frontend imports, `pnpm` only, English for tracked documentation, and Spanish only inside `PROMPTS/`.
- Do not use em dashes, emojis, generic AI comments, or invented architecture.

## Editing and verification workflow

1. Read each target file fully before editing it.
2. Make surgical edits with `apply_patch`.
3. Inspect the diff for accidental scope expansion and run `git diff --check`.
4. Add or update focused tests before relying on broad tests for confidence.
5. Run `pnpm check-types` and `pnpm test` after every code change. Run `pnpm lint` and relevant focused checks when applicable.
6. For Rust work, run `cargo clippy --all-targets --locked -- -D warnings` and `cargo nextest run --locked` from `src-tauri`. Use `cargo test --locked` only if nextest is unavailable.
7. If a tool is missing, a command is blocked, or a platform cannot be exercised, report that precisely. Never convert an unrun check into a claimed pass.

For a core subsystem change, add a regression test for the invariant, not merely a test for the changed line. For UI work, verify loading, empty, error, disabled, keyboard, and narrow-layout states where relevant.

## Git discipline

Do not overwrite or stage unrelated work. Before a commit, inspect `git status --short`, `git diff`, and `git diff --check`. Commit only task-owned files with a concise imperative message. Do not push, change remote state, or rewrite history unless the user explicitly asks.

At the end of meaningful work, update the relevant Spanish operational record under `PROMPTS/` with the decision, completed work, checks, limitations, and next step. Do not create operational documents in the repository root.

## Response style

Lead with the outcome. Be concise but include the evidence needed to review the work: changed areas, validation, limitations, and commit or push state. Do not claim completion until the requested acceptance criteria and required checks are satisfied.
