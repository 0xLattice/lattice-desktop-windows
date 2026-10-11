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
        command = ['cargo', 'metadata', '--locked', '--format-version', '1', '--filter-platform', target, '--manifest-path', str(manifest)]
        if manifest.parent.name == '.build-miner-gpu':
            command += ['--features', 'opencl']
        metadata = json.loads(subprocess.check_output(command))
        for package in metadata['packages']:
            if package['source']:
                label = f"Cargo {package['name']} {package['version']}"
                notices.collect(label, Path(package['manifest_path']).parent, recursive=True)
                fallback = root / 'docs/licenses' / f"{package['name']}-{package['version']}.txt"
                if label in notices.missing and fallback.is_file():
                    notices.records.append(f'\n## {label} — upstream license\n\n' + fallback.read_text(encoding='utf-8'))
                    notices.missing.remove(label)
    notices.records.append('\n## Microsoft WebView2 SDK 1.0.3800.47\n\n' + (root / 'docs/licenses/Microsoft.Web.WebView2-1.0.3800.47.txt').read_text(encoding='utf-8'))
else:
    raise ValueError('Expected node or app')
if notices.missing:
    raise RuntimeError('License files unavailable for: ' + ', '.join(sorted(set(notices.missing))))
Path(output).write_text('# Third-party notices\n\nDependency notices preserved verbatim.\n' + ''.join(sorted(set(notices.records))), encoding='utf-8')
