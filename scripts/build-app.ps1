# Build the shared app (vendor/lattice-desktop) for Windows and package it as
# an installer, carrying the Linux node binaries in build/linux and the GPU
# mining worker in build/windows.
#
# Usage: scripts\build-app.ps1
#   Build the node binaries first (scripts/build-node-binaries.sh, on Linux)
#   and the GPU worker (scripts\build-gpu-worker.ps1).
#   Needs Node.js 24 and a Rust toolchain.
#   Output: dist\Lattice_<version>_x64-setup.exe
$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $PSScriptRoot
$app = Join-Path $here "vendor\lattice-desktop"
if (-not (Test-Path (Join-Path $here "build\linux\lattice-node"))) {
  throw "no node binaries in build\linux: build them on Linux with scripts/build-node-binaries.sh"
}
if (-not (Test-Path (Join-Path $here "build\windows\lattice-miner-gpu.exe"))) {
  throw "no GPU worker in build\windows: build it with scripts\build-gpu-worker.ps1"
}

Push-Location $app
try {
  npm ci
  if ($LASTEXITCODE -ne 0) { throw "npm ci failed" }
  python -X utf8 (Join-Path $here "scripts\collect-notices.py") app (Join-Path $here "build\THIRD-PARTY-NOTICES.txt")
  if ($LASTEXITCODE -ne 0) { throw "notice collection failed" }
  npx tauri build --config (Join-Path $here "tauri.windows.conf.json")
  if ($LASTEXITCODE -ne 0) { throw "tauri build failed" }
} finally {
  Pop-Location
}

$dist = Join-Path $here "dist"
New-Item -ItemType Directory -Force $dist | Out-Null
Remove-Item (Join-Path $dist "*.exe") -ErrorAction SilentlyContinue
Copy-Item (Join-Path $app "src-tauri\target\release\bundle\nsis\*.exe") $dist
Get-ChildItem $dist
