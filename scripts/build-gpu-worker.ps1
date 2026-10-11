# Build the GPU mining worker the app carries (lattice-miner-gpu.exe) from
# adalinxx/lattice-miner-gpu at the commit the shared app pins
# (vendor/lattice-desktop/MINER_GPU_COMMIT), with its OpenCL backend. It is a
# Windows program, unlike the node binaries: the graphics chip is Windows'.
# OpenCL is loaded when it runs, so the build needs no OpenCL library.
#
# Usage: scripts\build-gpu-worker.ps1
#   Needs git and a Rust toolchain.
#   Output: build\windows\lattice-miner-gpu.exe, with the commit in
#   build\windows\MINER_GPU_COMMIT.
$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $PSScriptRoot
$commit = (Get-Content (Join-Path $here "vendor\lattice-desktop\MINER_GPU_COMMIT") -Raw).Trim()
$src = Join-Path $here ".build-miner-gpu"

function Invoke-Git {
  git @args
  if ($LASTEXITCODE -ne 0) { throw "git $($args -join ' ') failed" }
}

if (-not (Test-Path (Join-Path $src ".git"))) {
  Invoke-Git clone --quiet https://github.com/adalinxx/lattice-miner-gpu.git $src
}
Invoke-Git -C $src fetch --quiet origin $commit
Invoke-Git -C $src checkout --quiet --detach $commit
if (git -C $src status --porcelain --untracked-files=no) {
  throw "lattice-miner-gpu checkout has local changes; refusing to bundle it"
}

# The C runtime is linked in, as it is in the app itself: the worker must not
# need the Visual C++ redistributable on a PC that does not have it. The
# target directory is named, so a CARGO_TARGET_DIR set outside cannot leave an
# older build to be picked up below.
$flags = $env:RUSTFLAGS
$env:RUSTFLAGS = "-C target-feature=+crt-static"
Push-Location $src
try {
  cargo build --release --locked --features opencl --target-dir (Join-Path $src "target")
  if ($LASTEXITCODE -ne 0) { throw "cargo build failed" }
} finally {
  Pop-Location
  $env:RUSTFLAGS = $flags
}

$out = Join-Path $here "build\windows"
New-Item -ItemType Directory -Force $out | Out-Null
Copy-Item (Join-Path $src "target\release\lattice-miner-gpu.exe") $out -Force
Set-Content -Path (Join-Path $out "MINER_GPU_COMMIT") -Value $commit -NoNewline
Write-Host "staged the GPU worker at $commit in $out"
