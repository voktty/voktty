# Cortex portability baseline

## Status

Task 1 evaluation in progress. SQLite with FTS5 is conditionally accepted for the future `voktty-agent-core`. Provenance is closed, but the task remains open until a real macOS run is captured.

This evaluation does not add Cortex, SQLite, memory, agents or background work to the Voktty runtime.

## Local snapshot identity

The only Cortex source used in this evaluation is `PROMPTS/referencias/cortex`.

- Declared project and core version: `2.2.0`.
- Declared upstream: `https://github.com/gambletan/cortex`.
- License present in the snapshot: MIT.
- Clean source manifest: 190 files.
- Aggregate SHA-256: `ab4e2897fa64f41408801d07eefb9fc84db5fa0835a33c4d736d0b66947faea6`.
- Aggregate algorithm: `sha256(path\0sha256\0bytes\n)` over sorted normalized paths.
- Exclusions: `.git/`, `target/` and the pre-existing `$TMPDB4`, `$TMPDB4-shm` and `$TMPDB4-wal` artifacts.
- Upstream tag `v2.2.0`: `6c41b5d8ee6ffc70ab1db70ee033a6a3591de88f`.
- Exact snapshot commit: `fa882ed49ff30468dff6a2f039bd5f7c8e54b76c`.

The snapshot has no embedded Git metadata, so provenance was recovered from the declared official upstream without replacing the local source used for evaluation. The `v2.2.0` tag contains 189 clean files and does not match the snapshot. The snapshot adds `cortex-core/tests/test_ingest_parity.rs` and changes `.github/workflows/release-python.yml`, `cortex-core/src/lib.rs`, `cortex-core/src/storage/sqlite.rs`, `Dockerfile` and `docs/ROADMAP.md`. These changes entered upstream after the tag through commits `514cf02d`, `f54739da`, `2ff0bb45` and `fa882ed4`.

An archive generated from `fa882ed49ff30468dff6a2f039bd5f7c8e54b76c` has the same 190 normalized paths, per-file hashes and aggregate SHA-256 as the local snapshot. There are no missing, additional or changed clean files. The exact supply identity is therefore Cortex 2.2.0 plus the upstream post-tag snapshot commit `fa882ed49ff30468dff6a2f039bd5f7c8e54b76c`.

Generate the manifest with:

```sh
node scripts/cortex-eval/snapshot-manifest.mjs PROMPTS/referencias/cortex
```

## Candidate decision

The accepted storage baseline is:

- `rusqlite` 0.31 with bundled SQLite and FTS5.
- No `encrypted-db` feature, SQLCipher or vendored OpenSSL.
- Lazy open, one initial connection and WAL only when memory is enabled.
- Scope columns and indexes in every durable lookup.
- Embeddings absent by default and outside this baseline.
- Rust owns database paths, migrations, queries and lifecycle.

Cortex's default manifest is rejected because it enables `encrypted-db` and `bundled-sqlcipher-vendored-openssl`. Its four-reader pool, 64 MiB cache pragma, 256 MiB mmap, large LRU caches, sync tables and unrelated people/belief/pattern schemas are also outside Voktty's baseline.

## Measured results

Measurements use the tracked `scripts/cortex-eval/sqlite-spike` executable in release mode. Each NDJSON report starts with the operating system, architecture, family and pointer width reported by the executed binary. Process launch is measured over 20 runs. Query p50/p95 is measured over 100 queries after inserting 10,000 scoped records. RSS is the process physical memory reported by `memory-stats`; it is an observed value, not a deterministic assertion.

| Metric | Windows 11 x64 | Ubuntu 24.04 x64 under WSL2 |
| --- | ---: | ---: |
| Baseline binary | 253,952 B | 555,320 B |
| SQLite/FTS5 binary | 1,902,080 B | 2,610,888 B |
| Binary delta | 1,648,128 B | 2,055,568 B |
| Baseline RSS | 9,019,392 B | 2,080,768 B |
| SQLite ready RSS | 9,990,144 B | 4,448,256 B |
| Idle RSS delta | 970,752 B | 2,367,488 B |
| Baseline launch p50 / p95 | 16.448 / 20.107 ms | 0.601 / 1.055 ms |
| SQLite-ready launch p50 / p95 | 18.195 / 20.690 ms | 0.945 / 1.447 ms |
| Ready-to-query inside process | 1.057 ms | 0.211 ms |

Both observed idle RSS deltas remain below the 4 MiB target. The Linux measurement is a real Linux binary and kernel run, but it is not a bare-metal desktop smoke.

| 10,000-record workload | Windows 11 x64 | Ubuntu 24.04 x64 under WSL2 |
| --- | ---: | ---: |
| Minimal SQLite insert | 11.110 ms | 7.471 ms |
| Minimal first scoped query | 0.262 ms | 0.196 ms |
| Minimal query p95 | 0.322 ms | 0.294 ms |
| Minimal database | 1,421,312 B | 1,421,312 B |
| FTS5 insert with sync triggers | 118.960 ms | 88.628 ms |
| FTS5 first query | 0.087 ms | 0.071 ms |
| FTS5 query p50 / p95 | 3.743 / 4.749 ms | 2.870 / 3.179 ms |
| FTS5 database | 1,810,432 B | 1,810,432 B |

The measured FTS5 p95 is below the 20 ms target on both available systems. RSS after populating and querying 10,000 records is recorded separately from idle: 12,996,608 B on Windows and 7,286,784 B on Linux.

## Supply-chain evidence

The candidate lock contains 36 dependencies across all target platforms.

- `cargo-audit` 0.22.2: zero vulnerabilities and zero warnings. Advisory database commit `bf5c0d245a92671908518d7e765914d437954ed6`, updated 2026-08-21.
- `cargo-deny` 0.20.2 `check licenses`: zero errors and zero warnings across 31 licensed package evaluations.
- Allowed candidate licenses: Apache-2.0, BSD-2-Clause and MIT.
- `cargo-cyclonedx` 0.5.9: CycloneDX 1.5 SBOM generated for all targets with `SOURCE_DATE_EPOCH=0`.
- Normalized SBOM SHA-256: `44194b171773f0d56588d86c790359c82c4763cb8dc498b5fd995607b4480013`.

The committed SBOM is [cortex-task1-sqlite-spike.cdx.json](../security/cortex-task1-sqlite-spike.cdx.json). Checkout-specific file URIs are normalized to `file:///workspace`; package checksums and dependency edges are unchanged.

## Cortex file disposition

The following is the exhaustive disposition for the candidate files named by the implementation plan and their directly relevant tests. No Rust source has been copied verbatim into Voktty at this stage.

| Snapshot path | Decision | Reuse boundary |
| --- | --- | --- |
| `LICENSE` | Accept verbatim | Preserve the complete MIT notice if any substantial code is later derived. |
| `cortex-core/Cargo.toml` | Reject manifest; adapt evidence | Keep only the measured `rusqlite` version. Reject default SQLCipher/OpenSSL and unrelated dependencies. |
| `cortex-core/src/types.rs` | Adapt concepts | Re-design scoped memory provenance, trust, sensitivity, freshness and supersession under Voktty contracts. Do not import generic content variants or embedding fields wholesale. |
| `cortex-core/src/storage/traits.rs` | Adapt concepts | Keep a small repository boundary and batch/FTS operations; remove people, beliefs, patterns, sync and unbounded fallback scans. |
| `cortex-core/src/storage/sqlite.rs` | Adapt selected algorithms | Reuse only migration/transaction/FTS5 ideas. Reject SQLCipher, four-reader pool, large caches/mmap, sync schema, embedding codecs and unrelated entity tables. |
| `cortex-core/src/retrieval.rs` | Adapt selected algorithms | Keep hard query budgets and bounded multi-signal ranking. Replace language heuristics, person graph expansion and vector-first retrieval with Voktty scopes and FTS5 baseline. |
| `cortex-core/src/context.rs` | Adapt selected algorithms | Keep strict output budgets and an export boundary. Historical memory must remain explicitly untrusted and cannot become model instructions. |
| `cortex-core/src/episode.rs` | Adapt selected algorithms | Keep access/freshness signals and bounded decay concepts. No autonomous background cycle. |
| `cortex-core/src/semantic.rs` | Adapt selected algorithms | Keep confidence and explicit supersession concepts. Embedding search remains optional and disabled. |
| `cortex-core/src/consolidation.rs` | Reject engine; adapt archive concepts | Reject the background “sleep” engine and automatic promotion. Retain only supervised, bounded archival/supersession ideas. |
| `cortex-core/tests/test_types.rs` | Adapt | Rebuild tests around Voktty's scoped data model and serialization compatibility. |
| `cortex-core/tests/test_traits_defaults.rs` | Adapt | Keep contract/default-provider testing without unbounded fallback scans. |
| `cortex-core/tests/test_storage.rs` | Adapt | Keep CRUD, transaction, scope, ordering and FTS behavior tests. |
| `cortex-core/tests/test_storage_advanced.rs` | Adapt selected tests | Keep file-backed WAL and corruption boundaries; reject pool/cache/embedding tests. |
| `cortex-core/tests/test_cache_and_perf.rs` | Reject implementation assumptions; adapt smoke | The read-pool/cache model is rejected. Its file-backed open smoke informed the portable patch only. |
| `cortex-core/tests/test_retrieval.rs` | Adapt | Keep budget exhaustion, result caps and score breakdown contracts. |
| `cortex-core/tests/test_retrieval_advanced.rs` | Adapt selected tests | Keep scope isolation and bounded expansion tests; reject language-specific person heuristics. |
| `cortex-core/tests/test_temporal_retrieval.rs` | Adapt selected tests | Keep freshness ordering; avoid hardcoded English/Chinese intent tables in the storage core. |
| `cortex-core/tests/test_context.rs` | Adapt | Keep privacy export and truncation tests, adding untrusted-history injection fixtures. |
| `cortex-core/tests/test_episode.rs` | Adapt selected tests | Keep freshness/access behavior; remove vector requirements. |
| `cortex-core/tests/test_semantic.rs` | Adapt selected tests | Keep confidence, contradiction and supersession behavior; remove vector requirements. |
| `cortex-core/tests/test_consolidation.rs` | Reject cycle; adapt fixtures | Reuse archival/supersession scenarios only under explicit supervision. |
| `cortex-core/tests/test_consolidation_advanced.rs` | Reject cycle; adapt fixtures | Reuse boundedness and empty-store cases only. |
| `cortex-core/tests/test_full_privacy_chain.rs` | Reject | Depends on SQLCipher/cloud sync and conflicts with the portable baseline. |

Rejected wholesale for this integration: `cortex-core/src/sync/`, `cortex-http/`, `cortex-mcp-server/`, `cortex-python/`, `cortex-wasm/`, cloud sync, watchers, daemons, HTTP surfaces, Cortex plugins, automatic tool execution, bundled embeddings and SQLCipher/OpenSSL.

## Portable test patch

The original Windows run passed 150 unit tests and then failed the first two file-backed tests because `/tmp` does not exist. Five file-backed tests in three candidate test files used the same hardcoded path pattern.

`scripts/cortex-eval/cortex-2.2.0-portable-tests.patch` replaces those paths with `tempfile::tempdir()` while keeping each temporary directory alive through database shutdown. The patch applies cleanly to the deterministic snapshot. In an isolated copy:

```sh
cargo test -p cortex-core --locked --no-default-features --no-fail-fast
```

Result on Windows: 556 listed tests passed, zero failed. Warnings remain in Cortex sync, SQLCipher-only privacy tests and embedding codec code. Those areas are explicitly rejected rather than silently “fixed” and imported.

## Remaining gates

Task 1 remains open until `.github/workflows/cortex-portability-evaluation.yml` runs on a real macOS runner and its NDJSON artifact passes `scripts/cortex-eval/validate-report.mjs`. The workflow's final `accept-matrix` job also requires exactly one validated Windows, macOS and Linux artifact, with distinct baseline and SQLite launch measurements and no unknown report modes. No macOS result is inferred from compilation or another operating system.

Only after that gate passes may the Task 1 checkbox be closed and Task 2 begin. Any future derived Cortex code must identify `fa882ed49ff30468dff6a2f039bd5f7c8e54b76c` and preserve the MIT notice.
