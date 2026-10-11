#!/usr/bin/env python3
"""Collect pinned dependency notices, preserving their attribution verbatim."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys

root = Path(__file__).resolve().parent.parent
app = root / 'vendor/lattice-desktop'
spec = importlib.util.spec_from_file_location('notices', app / 'scripts/collect-release-notices.py')
notices = importlib.util.module_from_spec(spec)
sys.dont_write_bytecode = True
spec.loader.exec_module(notices)
notices.records.clear()
mode, output = sys.argv[1:]
if mode == 'node':
    notices.records.append('\n## Swift 6.1 runtime\n\n' + (root / 'docs/licenses/Swift-6.1-LICENSE.txt').read_text())
    build_root = Path(os.environ.get('RELEASE_BUILD_ROOT', str(root / '.build-node/.build')))
    for package in sorted((build_root / 'release-canonical/checkouts').iterdir()):
        if package.is_dir():
            notices.collect('Swift ' + package.name, package, recursive=True)
elif mode == 'app':
    node_dir = 'linux' if sys.platform == 'win32' else 'bin'
    notices.records.append((root / 'build' / node_dir / 'NODE-NOTICES.txt').read_text())
    for base in [app, app / 'vendor/nexus-wallet', app / 'vendor/nexus-wallet/vendor/lattice-sdk']:
        lock = json.loads((base / 'package-lock.json').read_text())['packages']
        for relative, entry in sorted(lock.items()):
            if not relative or entry.get('dev') or entry.get('link'):
                continue
            manifest = base / relative / 'package.json'
            if not manifest.is_file() and entry.get('optional'):
                continue
            if not manifest.is_file():
                raise RuntimeError('Missing installed runtime dependency: ' + relative)
            package = json.loads(manifest.read_text())
            notices.collect(f"npm {package['name']} {package.get('version', '')}", manifest.parent)
    for relative in ['vendor/nexus-wallet/LICENSE', 'vendor/nexus-wallet/THIRD_PARTY_NOTICES.md', 'vendor/nexus-wallet/vendor/lattice-sdk/LICENSE']:
        notices.records.append('\n## ' + relative + '\n\n' + (app / relative).read_text())
    target = 'x86_64-pc-windows-msvc' if sys.platform == 'win32' else 'x86_64-unknown-linux-gnu'
    for manifest in [app / 'src-tauri/Cargo.toml', root / '.build-miner-gpu/Cargo.toml']:
        metadata = json.loads(subprocess.check_output(['cargo', 'metadata', '--locked', '--format-version', '1', '--filter-platform', target, '--manifest-path', str(manifest)]))
        for package in metadata['packages']:
            if package['source']:
                notices.collect(f"Cargo {package['name']} {package['version']}", Path(package['manifest_path']).parent, recursive=True)
else:
    raise ValueError('Expected node or app')
if notices.missing:
    raise RuntimeError('License files unavailable for: ' + ', '.join(sorted(set(notices.missing))))
Path(output).write_text('# Third-party notices\n\nDependency notices preserved verbatim.\n' + ''.join(sorted(set(notices.records))), encoding='utf-8')
