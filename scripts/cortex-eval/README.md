# Cortex evaluation harness

This directory contains reproducible evidence for Task 1 of the local Cortex evaluation. It does not add Cortex or SQLite to the Voktty runtime.

## Snapshot identity

Generate a deterministic SHA-256 manifest from the local snapshot:

```sh
node scripts/cortex-eval/snapshot-manifest.mjs PROMPTS/referencias/cortex > cortex-task1-manifest.json
```

The manifest excludes Git metadata, Cargo targets and the known `$TMPDB4` SQLite artifacts. The aggregate covers each normalized path, content hash and byte count.

## SQLite/FTS5 spike

Windows:

```powershell
pwsh scripts/cortex-eval/sqlite-spike/run.ps1
```

macOS or Linux:

```sh
bash scripts/cortex-eval/sqlite-spike/run.sh
```

The runner builds a baseline executable and the same executable with `rusqlite` 0.31 using bundled SQLite. It records the operating system and architecture reported by the executed binary, binary size, process launch p50/p95, ready-to-query time, RSS, database size, first-query latency, 100-query p50/p95 and insertion of 10,000 scoped records. FTS5 is exercised through a real virtual table and synchronized triggers. SQLCipher and vendored OpenSSL are not enabled.

Results are NDJSON under `sqlite-spike/reports/` and are intentionally ignored. The first record makes each report attributable even after it is separated from its artifact name. CI uploads them as per-platform artifacts when the manual evaluation workflow is run.

Validate a report and its acceptance budgets with:

```sh
node scripts/cortex-eval/validate-report.mjs \
  scripts/cortex-eval/sqlite-spike/reports/metrics.ndjson macos
```

Replace `macos` with `windows` or `linux` for the other runners. The validator requires all measurement modes, a 64-bit platform record, two 10,000-record workloads, idle RSS delta at most 4 MiB and FTS5 p95 below 20 ms.

The workflow also downloads all three artifacts into one final job and validates them together:

```sh
node scripts/cortex-eval/validate-matrix.mjs \
  cortex-reports/*/metrics.ndjson
```

The matrix gate accepts exactly one attributable report for Windows, macOS and Linux. Every report must contain the closed set of measurement modes and distinct baseline and SQLite launch measurements; duplicate, missing, extra or mismatched platform evidence fails the workflow.

## Supply-chain checks

The candidate lock is `sqlite-spike/Cargo.lock`. Task 1 uses `cargo-audit` 0.22.2, `cargo-deny` 0.20.2 and `cargo-cyclonedx` 0.5.9. The committed SBOM is generated with:

```sh
SOURCE_DATE_EPOCH=0 cargo cyclonedx \
  --manifest-path scripts/cortex-eval/sqlite-spike/Cargo.toml \
  --all-features --target all --format json --spec-version 1.5 \
  --override-filename cortex-task1-sqlite-spike.cdx
mkdir -p docs/security
mv scripts/cortex-eval/sqlite-spike/cortex-task1-sqlite-spike.cdx.json \
  docs/security/cortex-task1-sqlite-spike.cdx.json
node scripts/cortex-eval/normalize-sbom.mjs \
  docs/security/cortex-task1-sqlite-spike.cdx.json .
```

Normalization replaces the checkout-specific file URI with `file:///workspace`; package names, versions, checksums, dependency edges and licenses are unchanged.
