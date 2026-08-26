#!/usr/bin/env bash
set -euo pipefail

spike_root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
output_root="${1:-$spike_root/reports}"
target_root="$output_root/target"
source_binary="$target_root/release/voktty-cortex-sqlite-spike"
baseline_binary="$output_root/voktty-cortex-baseline"
sqlite_binary="$output_root/voktty-cortex-sqlite"
database_path="$output_root/startup.db"
report_path="$output_root/metrics.ndjson"

mkdir -p "$output_root"
export CARGO_TARGET_DIR="$target_root"

cargo build --manifest-path "$spike_root/Cargo.toml" --release --locked
cp "$source_binary" "$baseline_binary"
cargo build --manifest-path "$spike_root/Cargo.toml" --release --locked --features sqlite
cp "$source_binary" "$sqlite_binary"

{
  "$baseline_binary" platform
  "$baseline_binary" baseline
  "$sqlite_binary" prepare "$database_path"
  "$sqlite_binary" ready-sqlite "$database_path"
  "$sqlite_binary" launch "$baseline_binary" 20 baseline
  "$sqlite_binary" launch "$sqlite_binary" 20 ready-sqlite "$database_path"
  "$sqlite_binary" sqlite 10000
  "$sqlite_binary" fts5 10000
  printf '{"schema":1,"mode":"binary-size","baselineBytes":%s,"sqliteBytes":%s}\n' \
    "$(wc -c < "$baseline_binary")" "$(wc -c < "$sqlite_binary")"
} > "$report_path"

cat "$report_path"
