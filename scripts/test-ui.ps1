# The installed app in its own window, driven through WebDriver with real
# clicks and keys: the shared app's UI test (vendor\lattice-desktop\test\ui),
# with nothing standing in for the shell or the node, which runs in WSL.
#
# It REPLACES the node's host root in the default WSL distribution
# (~/.local/share/Lattice/host) with a private one that has no peers, and
# makes a wallet in %APPDATA%\Lattice: it is restricted to a disposable CI runner. The app must have been opened once, so its node
# binaries are in WSL.
#
# Usage: scripts\test-ui.ps1 -App <.exe> -NativeDriver <msedgedriver.exe>
#   -App is the executable scripts\build-webdriver-app.ps1 builds, copied into
#   the installed app's directory (%LOCALAPPDATA%\Lattice): WebDriver cannot
#   attach to the app that ships, which opens no debugging port.
#   Needs Node.js 24, tauri-driver (`cargo install tauri-driver --locked`) and
#   a msedgedriver.exe matching the PC's WebView2 runtime, named in
#   -NativeDriver (https://github.com/chippers/msedgedriver-tool fetches one).
param(
  [Parameter(Mandatory = $true)][string]$App,
  [Parameter(Mandatory = $true)][string]$NativeDriver,
  [string]$Test = "vendor\lattice-desktop\test\ui\desktop.ui.test.mjs"
)
$ErrorActionPreference = "Stop"
if ($env:CI -ne "true") { throw "This test resets disposable CI data and must not run on a personal installation." }
$here = Split-Path -Parent $PSScriptRoot

function Invoke-Wsl {
  $out = wsl.exe -e @args
  if ($LASTEXITCODE -ne 0) { throw "wsl -e $($args -join ' ') failed" }
  $out
}
function Get-FreePort {
  $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
  $listener.Start()
  $port = $listener.LocalEndpoint.Port
  $listener.Stop()
  $port
}

$distro = (Invoke-Wsl printenv WSL_DISTRO_NAME).Trim()
$linuxHome = (Invoke-Wsl printenv HOME).Trim()
$data = "$linuxHome/.local/share/Lattice"
$root = "$data/host"
$commit = (Get-Content (Join-Path (Split-Path -Parent $App) "linux\COMMIT") -Raw).Trim()
$lattice = "$data/bin/$commit/lattice"

# No window of the app left open, nor the webview processes one leaves behind
# when it is killed: a new window would join them, and they were not started
# for WebDriver.
$left = Get-Process lattice-desktop, msedgewebview2 -ErrorAction SilentlyContinue
if ($left) {
  Write-Host "stopping: $(($left | ForEach-Object { "$($_.ProcessName) $($_.Id)" }) -join ', ')"
  $left | Stop-Process -Force -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 2
}

# A private node for the app to find: stopped, emptied, no peers, free ports.
wsl.exe -e $lattice mine stop --root $root 2>$null | Out-Null
wsl.exe -e $lattice down --root $root 2>$null | Out-Null
Invoke-Wsl rm -rf $root | Out-Null
Invoke-Wsl $lattice init --root $root | Out-Null
$topologyFile = "\\wsl$\$distro" + ("$root/lattice.json" -replace '/', '\')
$topology = Get-Content $topologyFile -Raw | ConvertFrom-Json
$topology | Add-Member -Force -NotePropertyName rpc -NotePropertyValue (Get-FreePort)
$topology | Add-Member -Force -NotePropertyName listen -NotePropertyValue (Get-FreePort)
$topology | Add-Member -Force -NotePropertyName peers -NotePropertyValue @()
[System.IO.File]::WriteAllText($topologyFile, ($topology | ConvertTo-Json -Depth 20))
Remove-Item -Recurse -Force "$env:APPDATA\Lattice\wallet" -ErrorAction SilentlyContinue

$env:LATTICE_UI_TOPOLOGY_FILE = $topologyFile
$env:LATTICE_UI_APP = $App
$env:LATTICE_UI_NATIVE_DRIVER = (Resolve-Path $NativeDriver).Path
try {
  node --test (Join-Path $here $Test)
  if ($LASTEXITCODE -ne 0) { throw "the UI test failed" }
} finally {
  # A failed run may leave the node up; the app's own exit would have stopped it.
  wsl.exe -e $lattice mine stop --root $root 2>$null | Out-Null
  wsl.exe -e $lattice down --root $root 2>$null | Out-Null
  $global:LASTEXITCODE = 0
}
