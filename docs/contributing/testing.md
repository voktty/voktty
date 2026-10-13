# Testing

This guide elaborates on `VOKTTY.md` and `CONTRIBUTING.md`. If anything conflicts with those files, they win.

## Running checks locally

The canonical commands are what CI runs (`.github/workflows/ci.yml`):

```bash
pnpm lint
pnpm check-types
pnpm test

cd src-tauri
cargo clippy --all-targets --locked -- -D warnings
cargo nextest run --locked        # CI uses nextest
```

If you do not have `cargo-nextest` installed, `cargo test --locked` is the local fallback. Install nextest with `cargo install cargo-nextest`.

## Cross-platform package validation

Before creating a version tag, run the manual `Package validation` workflow from the Actions page against the intended commit. It builds the same desktop targets as the release pipeline:

- Windows x64 with NSIS and MSI packages
- Linux x64 with AppImage, DEB and RPM packages
- macOS ARM64 and Intel with DMG packages

The workflow has read-only repository permissions, disables updater artifacts and operating-system code signing, and uploads its packages only as short-lived workflow artifacts rather than release assets. It cannot create a GitHub release or modify a tag.

Only create and push a release tag after the complete package matrix is green. A successful validation proves compilation and unsigned packaging on every runner. It does not prove Apple notarization or Windows Authenticode signing, which remain separate checks when those credentials are enabled.

## Desktop release publication

The `Release` workflow supports version tags and manual publication. A pushed `vX.Y.Z` tag builds Windows x64, Linux x64, macOS Intel and macOS Apple Silicon. Android builds run independently on `main` or by manual dispatch, upload APKs as workflow artifacts, and never create or modify a release.

For an urgent release from a tested `main` commit:

1. Open Actions > Release > Run workflow and select the `main` branch.
2. Enter a stable version, such as `1.0.18`, that has not already been published. Select Windows, Linux, macOS Apple Silicon and/or macOS Intel; Windows is selected by default.
3. Leave `make_latest` disabled for a selective release. Enable it only when selecting every desktop platform.
4. Run the workflow. Its captured `main` commit must already have a successful completed `CI` run. An incomplete or failing CI run blocks publication.

Every build checks out the same captured commit. Version metadata in `package.json`, Tauri, Cargo and internal lockfile entries is updated only inside the build runners; the workflow does not commit a version bump to `main`. The release records its source commit, successful CI run and selected platforms, and creates the version tag automatically. A published version cannot be replaced. An unfinished draft can be retried with the same source commit and publication inputs.

Selected desktop packages use the existing updater signing, optional Apple signing and SignPath Windows signing. Both Linux SSH helper architectures and all remote Host runtime packages remain included because a Windows desktop can work with Linux, macOS or Windows remote machines. Publication keeps the release in draft until the selected packages, Host packages and signed updater manifest are complete.

A selective release is available from its own Releases page and download links. It does not replace the global `latest` release used by every desktop auto-updater: that manifest has a single version for all platforms. Selecting every platform and enabling `make_latest` publishes a complete auto-update release. Automatic Nix source updates run only when the required Linux and macOS assets exist.

## What must have a test

`CONTRIBUTING.md` requires a test for any change that touches behavior in these load-bearing paths:

- Shell / terminal spawn (what shell launches, with which cwd, env, and login flags)
- Workspace authorization (both the allow and deny side)
- Git command layer (repo-root resolution, pathspec/argument guards, status parsing)
- Filesystem mutation (atomic writes, symlink handling, no-data-loss on partial failure)
- IPC command surface and AI tool surface
- Pure logic with wide reach (cwd inheritance, tab/split tree transforms, OSC/prompt parsing, command guard)

The bar is real coverage of the contract, not a placeholder. Test the edge, the deny path, the "what happens one level above home".

## What does not need a test

UI rendering, themes, syntax-highlight tables, and anything the type-checker already guarantees do not need tests.

## Writing a good test

A good test locks the invariant you are relying on. Examples from the codebase:

- `src-tauri/src/modules/workspace.rs` `auth_tests` verify that an authorized path, a subdir of an authorized root, an unauthorized path, a missing path, and a symlink escape all behave correctly.
- `src-tauri/src/modules/pty/job.rs` tests verify that dropping the Job Object kills the assigned process tree on Windows.
- `src-tauri/src/modules/pty/session.rs` tests verify that dropping a `Session` kills the child process.
- `src-tauri/src/modules/pty/shell_init.rs` tests verify shell classification and WSL fish launch specs.
- `src/modules/ai/lib/security.ts` is exercised by tests that assert specific paths are refused and that canonicalization catches symlink traversal.

## Cross-platform PTY tests

Platform-specific behavior must be gated:

```rust
#[cfg(unix)]
fn shell_has_children(shell_pid: u32) -> bool { ... }

#[cfg(windows)]
fn shell_has_children(shell_pid: u32) -> bool { ... }
```

Tests for ConPTY/Job Object belong behind `#[cfg(windows)]`; tests for Unix PTY lifecycle belong behind `#[cfg(unix)]`. Do not assume a helper that works on one platform works on the other.

## Security function tests

When testing `src/modules/ai/lib/security.ts` or the Rust equivalents, cover:

1. The literal path is refused.
2. The canonicalized path is re-refused (symlink case).
3. Case variants match on case-insensitive filesystems.
4. NTFS alternate data streams and trailing dot/space variants are normalized.
5. Write-only deny prefixes block writes but allow reads where appropriate.

## Invariants

- A local fix with global blast radius must be caught by a test; review alone is not enough.
- Test the deny path and the edge, not just the happy path.
- Keep platform-specific tests behind the right `#[cfg(...)]` gate.

## See also

- [`VOKTTY.md`](https://github.com/voktty/voktty/blob/main/VOKTTY.md) - the architecture source of truth
- [`CONTRIBUTING.md`](https://github.com/voktty/voktty/blob/main/CONTRIBUTING.md) - quality bar, project layout, how to contribute
- [`docs/README.md`](../README.md) - index of contributor guides
