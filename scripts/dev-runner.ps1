<#
.SYNOPSIS
  Ejecuta una instancia aislada de Voktty en modo desarrollo sin cerrar
  ni colisionar con la instancia activa (evita single-instance lock y conflicto de puertos).
#>
param(
  [int]$Port = 5173,
  [string]$Identifier = "dev.voktty.runner"
)

$ErrorActionPreference = "Stop"

# Auto-detect an available port if the specified one is blocked by Windows Hyper-V / EACCES
$availablePort = node -e "
const net = require('net');
const candidates = [$Port, 5173, 3000, 8080, 9527, 4321];
function check(idx) {
  if (idx >= candidates.length) { process.stdout.write(String(5173)); process.exit(0); }
  const p = candidates[idx];
  const s = net.createServer();
  s.once('error', () => check(idx + 1));
  s.listen(p, '127.0.0.1', () => { s.close(() => { process.stdout.write(String(p)); process.exit(0); }); });
}
check(0);
"

if ($availablePort -and $availablePort -ne "") {
  $Port = [int]$availablePort
}

Write-Host "🚀 Iniciando Voktty Dev Runner aislado..." -ForegroundColor Cyan
Write-Host "   • Identifier: $Identifier" -ForegroundColor DarkGray
Write-Host "   • Dev Port:   $Port" -ForegroundColor DarkGray

# 1. Compilar el CLI dev
pnpm build:cli:dev

# 2. Generar configuración temporal con override de identifier y devUrl
$configJson = @"
{
  "identifier": "$Identifier",
  "build": {
    "devUrl": "http://127.0.0.1:$Port",
    "beforeDevCommand": "pnpm vite --port $Port --host 127.0.0.1"
  }
}
"@

$tempConfig = [System.IO.Path]::Combine([System.IO.Path]::GetTempPath(), "voktty-dev-runner-$Port.json")
$configJson | Set-Content -Path $tempConfig -Encoding utf8

try {
  pnpm tauri dev --config $tempConfig
} finally {
  if (Test-Path $tempConfig) {
    Remove-Item $tempConfig -Force -ErrorAction SilentlyContinue
  }
}
