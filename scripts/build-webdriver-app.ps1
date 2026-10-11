# Build the app's executable for the UI test: the same code and configuration
# as the installer's, with one browser argument added so that WebDriver can
# attach to its window (a debugging port). The app that ships has no such
# port, and nothing outside it can ask for one: the webview takes its
# arguments from the app's configuration alone.
#
# Usage: scripts\build-webdriver-app.ps1
#   Run scripts\build-app.ps1 first: this rebuilds only the app's own crate.
#   Output: build\webdriver\lattice-desktop-webdriver.exe, to be run from the
#   installed app's directory, where its resources are.
$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $PSScriptRoot
$app = Join-Path $here "vendor\lattice-desktop"
$out = Join-Path $here "build\webdriver"
New-Item -ItemType Directory -Force $out | Out-Null

# The shared window, as configured, plus the argument. The first part is what
# the webview is given when an app names no arguments of its own.
$window = (Get-Content (Join-Path $app "src-tauri\tauri.conf.json") -Raw | ConvertFrom-Json).app.windows[0]
$window | Add-Member -NotePropertyName additionalBrowserArgs -NotePropertyValue "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection --remote-debugging-port=0"
$overlay = Join-Path $out "tauri.webdriver.conf.json"
[System.IO.File]::WriteAllText($overlay, (@{ app = @{ windows = @($window) } } | ConvertTo-Json -Depth 20))

Push-Location $app
try {
  npx tauri build --no-bundle --config (Join-Path $here "tauri.windows.conf.json") --config $overlay
  if ($LASTEXITCODE -ne 0) { throw "tauri build failed" }
} finally {
  Pop-Location
}
Copy-Item (Join-Path $app "src-tauri\target\release\lattice-desktop.exe") (Join-Path $out "lattice-desktop-webdriver.exe") -Force
Get-ChildItem $out
