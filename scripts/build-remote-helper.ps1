param(
  [ValidateSet("x86_64", "aarch64")]
  [string]$Architecture = "x86_64",
  [string]$Distro = "Ubuntu"
)

$ErrorActionPreference = "Stop"
$target = "$Architecture-unknown-linux-musl"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$wslInput = $repoRoot -replace "\\", "/"
$wslRoot = (& wsl.exe -d $Distro -- wslpath -a $wslInput).Trim()

if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($wslRoot)) {
  throw "Could not translate the repository path into WSL."
}

$buildCommand = @"
if [ -f "`$HOME/.cargo/env" ]; then . "`$HOME/.cargo/env"; fi
cd '$wslRoot/src-tauri'
cargo build --locked -p voktty-remote --release --target $target
"@

& wsl.exe -d $Distro -- bash -lc $buildCommand
if ($LASTEXITCODE -ne 0) {
  throw "Remote helper compilation failed for $target. Install Rust and the musl linker in WSL."
}

$source = Join-Path $repoRoot "src-tauri\target\$target\release\voktty-remote"
$destinationDirectory = Join-Path $repoRoot "src-tauri\resources\remote\linux-$Architecture"
$destination = Join-Path $destinationDirectory "voktty-remote"

if (-not (Test-Path -LiteralPath $source -PathType Leaf)) {
  throw "The compiled helper was not found at $source."
}

New-Item -ItemType Directory -Force -Path $destinationDirectory | Out-Null
Copy-Item -LiteralPath $source -Destination $destination -Force
$hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $destination).Hash.ToLowerInvariant()
Write-Host "Remote helper ready: $destination"
Write-Host "SHA-256: $hash"
