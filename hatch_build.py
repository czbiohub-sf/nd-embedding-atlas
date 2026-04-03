"""Custom hatch build hook that builds the frontend before packaging."""

from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

from hatchling.builders.hooks.plugin.interface import BuildHookInterface


class CustomBuildHook(BuildHookInterface):
    """Build the React frontend if ``frontend/dist/`` does not already exist."""

    def initialize(self, version, build_data):
        """Build the frontend using vp (vite-plus), with graceful fallbacks for HPC environments."""
        frontend_dir = Path(self.root) / "frontend"
        dist_dir = frontend_dir / "dist"

        if dist_dir.is_dir() and any(dist_dir.iterdir()):
            self.app.display_info("Frontend dist/ exists, skipping build")
            return

        # ── Resolve vp (vite-plus) ────────────────────────────────────────────
        # vp install + vp build are the canonical commands for this toolchain.
        # Prefer a globally installed vp; fall back to npx vite-plus on HPC
        # environments where Node.js is available but vp is not globally installed.
        if shutil.which("vp"):
            vp_cmd = ["vp"]
        elif shutil.which("npx"):
            vp_cmd = ["npx", "vite-plus"]
        else:
            msg = "Node.js (with npx) is required to build the frontend. Load it with: module load nodejs"
            raise RuntimeError(msg)

        self.app.display_info("Installing frontend dependencies...")
        subprocess.run([*vp_cmd, "install"], cwd=str(frontend_dir), check=True)

        self.app.display_info("Building frontend...")
        subprocess.run([*vp_cmd, "build"], cwd=str(frontend_dir), check=True)
