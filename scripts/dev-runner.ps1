<#
.SYNOPSIS
  Ejecuta una instancia aislada de Voktty en modo desarrollo sin cerrar
  ni colisionar con la instancia activa (evita single-instance lock y conflicto de puertos).
#>
param(
  [int]$Port = 6625,
  [string]$Identifier = "dev.voktty.runner"
)

$ErrorActionPreference = "Stop"

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
    "devUrl": "http://localhost:$Port",
    "beforeDevCommand": "pnpm vite --port $Port"
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
