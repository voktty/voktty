# ADR-009: Local Git Incremental Review and Verifiable Baseline Reconciliation

## Status

Accepted on 2026-08-29.

## Context

Reviewing AI-generated and human changes across complex git repositories often suffers from fatigue and reset overhead: when an agent modifies a single line in an already reviewed file, existing tools reset the entire file to unreviewed, forcing the user to re-read all unchanged code.

Voktty already has a robust Git foundation:
- Rust-owned `git_status`, `git_diff`, and `git_diff_content` (`originalContent` and `modifiedContent`).
- Unified Source Control panel and Review Queue (`src/modules/source-control/lib/reviewQueue.ts`).
- Workspace-level boundary and path security.

We needed a local, privacy-first, and high-performance mechanism to remember reviewed states per file and line ranges, and to reconcile them incrementally against subsequent changes without ever mutating the repository's `.git` folder or object database.

## Decisions

### 1. External Content-Addressed Storage
All review snapshots and metadata are persisted exclusively outside the user's repository in Voktty AppData:
- Snapshots: `<dataDir>/voktty/review_blobs/<sha256>`.
- Metadata DB: `<dataDir>/voktty/review.db` (SQLite via bundled `rusqlite`).
No temporary Git objects (such as `git hash-object -w`) are written to the repository.

### 2. Pure In-Memory Diff & Reconciliation Engine
A pure, dependency-light diff and projection engine runs in native Rust (`src-tauri/src/modules/git_review/`):
- `unchanged_segments`: identifies invariant regions between snapshot and current head content.
- `project_ranges`: maps claimed coordinates into current line numbers across subsequent edits.
- `split_range_by_claims`: partitions diff hunks into `reviewed` and `new` intervals, resolving overlaps by timestamp (freshest tick wins).
- `synthesize_reviewed_baseline`: constructs a synthetic "before" buffer where reviewed additions appear as context and unreviewed changes surface cleanly in diff viewers.

### 3. Conservative Failure Policy
Under any ambiguity (e.g. uncertain deletion boundaries or ambiguous rename reconciliation), Voktty errs on the side of caution: content is surfaced as `new` or `ambiguous` rather than hidden.

### 4. Thin IPC DTO Layer
React consumes strongly typed models via `gitReviewBridge.ts`:
- `openReviewSession`, `markFileViewed`, `markRangeClaim`, `unmarkRangeClaim`, `reconcileFileReview`, and `getSessionReviewOverview`.

## Consequences

- **Performance**: High-speed in-memory diffing and instant SQLite metadata queries with zero shell execution overhead.
- **Safety**: Repositories remain completely untouched; no dirty files or stray git objects.
- **Interoperability**: Works completely offline on local repositories and worktrees without requiring network or GitHub PR connectivity.
