param(
    [string]$OutputDirectory = "reports"
)

$ErrorActionPreference = "Stop"
$spikeRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$outputRoot = [System.IO.Path]::GetFullPath((Join-Path $spikeRoot $OutputDirectory))
$targetRoot = Join-Path $outputRoot "target"
$binaryExtension = if ($IsWindows) { ".exe" } else { "" }
$sourceBinary = Join-Path $targetRoot "release/voktty-cortex-sqlite-spike$binaryExtension"
$baselineBinary = Join-Path $outputRoot "voktty-cortex-baseline$binaryExtension"
$sqliteBinary = Join-Path $outputRoot "voktty-cortex-sqlite$binaryExtension"
$databasePath = Join-Path $outputRoot "startup.db"
$reportPath = Join-Path $outputRoot "metrics.ndjson"

New-Item -ItemType Directory -Force -Path $outputRoot | Out-Null
$env:CARGO_TARGET_DIR = $targetRoot

cargo build --manifest-path (Join-Path $spikeRoot "Cargo.toml") --release --locked
Copy-Item -LiteralPath $sourceBinary -Destination $baselineBinary -Force

cargo build --manifest-path (Join-Path $spikeRoot "Cargo.toml") --release --locked --features sqlite
Copy-Item -LiteralPath $sourceBinary -Destination $sqliteBinary -Force

$lines = @()
$lines += & $baselineBinary platform
$lines += & $baselineBinary baseline
$lines += & $sqliteBinary prepare $databasePath
$lines += & $sqliteBinary ready-sqlite $databasePath
$lines += & $sqliteBinary launch $baselineBinary 20 baseline
$lines += & $sqliteBinary launch $sqliteBinary 20 ready-sqlite $databasePath
$lines += & $sqliteBinary sqlite 10000
$lines += & $sqliteBinary fts5 10000
$lines += "{`"schema`":1,`"mode`":`"binary-size`",`"baselineBytes`":$((Get-Item -LiteralPath $baselineBinary).Length),`"sqliteBytes`":$((Get-Item -LiteralPath $sqliteBinary).Length)}"

$lines | Set-Content -LiteralPath $reportPath -Encoding utf8
Get-Content -LiteralPath $reportPath
