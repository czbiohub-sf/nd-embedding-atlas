"""Sidecar JSON persistence for ObsSets.

Writes atomically using a same-directory temp file → rename, which is
POSIX-atomic as long as both files are on the same filesystem.
"""

from __future__ import annotations

import json
from pathlib import Path

SIDECAR_SUFFIX = ".obssets.json"


def sidecar_path(project_config_path: Path) -> Path:
    """Return the sidecar path next to the project YAML."""
    return project_config_path.with_suffix(SIDECAR_SUFFIX)


def load_obssets(path: Path) -> list[dict]:
    """Load ObsSets from a sidecar JSON file.

    Returns an empty list if the file does not exist.
    """
    if not path.exists():
        return []
    with open(path) as f:
        return json.load(f)


def save_obssets(path: Path, obssets: list[dict]) -> None:
    """Atomically write ObsSets to the sidecar JSON file.

    Uses a same-directory temp file then renames — POSIX-atomic when
    both files reside on the same filesystem (same directory guarantees this).
    """
    tmp = path.parent / f".{path.name}.tmp"
    tmp.write_text(json.dumps(obssets, default=str, indent=2))
    tmp.replace(path)
