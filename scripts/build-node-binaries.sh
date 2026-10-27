#!/usr/bin/env bash
# Build the node binaries the app carries (`lattice`, `lattice-node`,
# `lattice-mining-coordinator`, `lattice-miner`) from 0xLattice/lattice-node at
# the commit the shared app pins (vendor/lattice-desktop/NODE_COMMIT), with the
# node's own release build: optimized, the Swift runtime linked in, so they run
# in a plain WSL distribution with glibc and SQLite. The app runs them there:
# the node has no Windows build.
#
# Usage: scripts/build-node-binaries.sh
#   Runs on Linux (WSL, Docker or a Linux machine) with a Swift 6.1 toolchain;
#   the swift:6.1-jammy image has one. Needs libsqlite3-dev.
#   Output: build/linux/, with the commit in build/linux/COMMIT.
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
commit="$(tr -d '[:space:]' < "$here/vendor/lattice-desktop/NODE_COMMIT")"
src="$here/.build-node"

if [ ! -d "$src/.git" ]; then
  git clone --quiet https://github.com/0xLattice/lattice-node.git "$src"
fi
git -C "$src" fetch --quiet origin "$commit"
git -C "$src" checkout --quiet --detach "$commit"
if [ -n "$(git -C "$src" status --porcelain --untracked-files=no)" ]; then
  echo "lattice-node checkout has local changes; refusing to bundle it" >&2
  exit 1
fi

(cd "$src" && scripts/build-release-binaries.sh)

out="$here/build/linux"
rm -rf "$out"
mkdir -p "$out"
for name in lattice lattice-node lattice-mining-coordinator lattice-miner; do
  install -m 0755 "$src/.build/release-binaries/$name" "$out/$name"
done
printf '%s\n' "$commit" > "$out/COMMIT"
echo "staged the node binaries at $commit in $out"

python3 "$here/scripts/collect-notices.py" node "$out/NODE-NOTICES.txt"
