# Lattice Desktop for Windows

A full Lattice node and the Lattice Wallet in one Windows app, as an installer.

This repository is the Windows packaging of
[lattice-desktop](https://github.com/adalinxx/lattice-desktop). The app itself
(the wallet, the node screens, the shell that runs the node) is that
repository, pinned here as the submodule `vendor/lattice-desktop`, and is the
same code on every platform. What is here is only what differs on Windows:

- how the node binaries are built (`scripts/build-node-binaries.sh`),
- how the app is packaged (`tauri.windows.conf.json`, `scripts/build-app.ps1`),
- and the check that the installed app works (`test/installed-app.test.mjs`, CI).

What the app does is described in
[lattice-desktop's README](https://github.com/adalinxx/lattice-desktop#readme).

## The node runs in WSL

The node is built for macOS and Linux; it has no Windows build. The Windows
app carries the Linux node and runs it, unmodified, in the Windows Subsystem
for Linux:

- **WSL is required.** If the PC has none, the app says so. To set it up, open
  PowerShell as administrator, run `wsl --install`, restart, and open Ubuntu
  once to finish. The distribution needs glibc 2.35 or later and SQLite
  (Ubuntu 22.04 or later, Debian 12 or later).
- The app uses the PC's **default distribution**. The first time it runs the
  node it copies the node binaries into `~/.local/share/Lattice/bin/<commit>`
  there; the node's host root is `~/.local/share/Lattice/host` there, on the
  distribution's own filesystem.
- The wallet's vault and settings stay on Windows, in `%APPDATA%\Lattice`.
- The node's loopback port reaches Windows through WSL's localhost forwarding
  (on by default). The app talks to `127.0.0.1` only, as on every platform.
- **The node runs while the app is open.** WSL stops a distribution once
  nothing started from Windows is running in it, so the app keeps it up for
  as long as it is open and stops the node when it quits.
- Mining searches on the processor, inside WSL. There is no graphics-chip
  worker in this package yet.

## Build

The node binaries are a Linux build. On Linux, in WSL, or with Docker:

```sh
git clone --recurse-submodules https://github.com/adalinxx/lattice-desktop-windows.git
cd lattice-desktop-windows
docker run --rm -v "$PWD":/work -w /work swift:6.1-jammy bash -c '
  git config --global --add safe.directory "*" &&
  apt-get update && apt-get install -y libsqlite3-dev &&
  scripts/build-node-binaries.sh'
```

That writes `lattice`, `lattice-node`, `lattice-mining-coordinator` and
`lattice-miner` to `build/linux/`, built from
[lattice-node](https://github.com/adalinxx/lattice-node) at the commit in
`vendor/lattice-desktop/NODE_COMMIT`, with the node's own release build.

Then, on Windows, with Node.js 24 and a Rust toolchain:

```powershell
scripts\build-app.ps1
```

The installer is written to `dist\`. It installs for the current user and
needs no administrator rights.

## Tests

CI builds the installer and then, on a Windows runner:

- runs the shared app's unit tests and the shell's tests on Windows;
- installs the app, sets up WSL, and runs `test/installed-app.test.mjs`, which
  launches the installed app and checks that it copied its node binaries into
  WSL, started the node there through the CLI, and that the node answers on
  Windows' loopback.

The shared app's headless end-to-end tests drive a node directly, so they run
where the node does: on macOS in lattice-desktop, and on Linux in
[lattice-desktop-linux](https://github.com/adalinxx/lattice-desktop-linux).

## Updating

To take a newer app or node, move the submodule:

```sh
git -C vendor/lattice-desktop fetch && git -C vendor/lattice-desktop checkout <commit>
git add vendor/lattice-desktop
```

The node commit follows the app: it is `NODE_COMMIT` in the submodule.
