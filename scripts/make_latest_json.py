#!/usr/bin/env python3
"""Assemble latest.json for the Tauri updater from a freshly built release.

Reads the version from src-tauri/tauri.conf.json, reads the .sig produced by
`tauri build` (requires bundle.createUpdaterArtifacts: true and the signing env
vars set), and writes latest.json pointing at the GitHub release download URL
for that version.

Usage:
    python scripts/make_latest_json.py [--notes "release notes"]

Then attach the resulting latest.json to the GitHub release alongside the
installer. The updater endpoint (releases/latest/download/latest.json) serves
it, so it MUST live on the newest release for auto-update to see new versions.

GitHub replaces spaces in asset filenames with dots in the download URL, so the
installer "Auralis Pulse_X.Y.Z_x64-setup.exe" is fetched as
"Auralis.Pulse_X.Y.Z_x64-setup.exe". This script bakes that in.
"""

from __future__ import annotations

import argparse
import datetime
import json
import sys
from pathlib import Path

REPO = "antonpme/auralis-pulse"
TARGET = "windows-x86_64"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--notes", default=None, help="Release notes shown in the update toast.")
    args = parser.parse_args()

    root = Path(__file__).resolve().parent.parent
    conf = json.loads((root / "src-tauri" / "tauri.conf.json").read_text(encoding="utf-8"))
    version = conf["version"]

    nsis_dir = root / "src-tauri" / "target" / "release" / "bundle" / "nsis"
    installer = nsis_dir / f"Auralis Pulse_{version}_x64-setup.exe"
    sig_file = nsis_dir / f"Auralis Pulse_{version}_x64-setup.exe.sig"

    if not sig_file.exists():
        print(f"ERROR: signature not found: {sig_file}", file=sys.stderr)
        print(
            "Build with TAURI_SIGNING_PRIVATE_KEY set and "
            "bundle.createUpdaterArtifacts: true in tauri.conf.json.",
            file=sys.stderr,
        )
        return 1

    signature = sig_file.read_text(encoding="utf-8").strip()
    asset_name = f"Auralis.Pulse_{version}_x64-setup.exe"
    url = f"https://github.com/{REPO}/releases/download/v{version}/{asset_name}"

    latest = {
        "version": version,
        "notes": args.notes or f"Auralis Pulse v{version}",
        "pub_date": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "platforms": {
            TARGET: {
                "signature": signature,
                "url": url,
            }
        },
    }

    out = root / "latest.json"
    out.write_text(json.dumps(latest, indent=2) + "\n", encoding="utf-8")

    print(f"Wrote {out}")
    print(f"  version:   {version}")
    print(f"  url:       {url}")
    print(f"  signature: {signature[:40]}... ({len(signature)} chars)")
    if not installer.exists():
        print(f"  WARN: installer not found at {installer} (sig present, will still work if you attach the exe)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
