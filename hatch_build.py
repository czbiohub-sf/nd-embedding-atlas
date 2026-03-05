"""Custom hatch build hook that builds the frontend before packaging."""

from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

from hatchling.builders.hooks.plugin.interface import BuildHookInterface


class CustomBuildHook(BuildHookInterface):
    """Build the React frontend if ``frontend/dist/`` does not already exist."""

    def initialize(self, version, build_data):
        """Run ``pnpm build`` in ``frontend/`` if ``dist/`` is missing."""
        frontend_dir = Path(self.root) / "frontend"
        dist_dir = frontend_dir / "dist"

        if dist_dir.is_dir() and any(dist_dir.iterdir()):
            self.app.display_info("Frontend dist/ exists, skipping build")
            return

        if shutil.which("pnpm"):
            pnpm_cmd = ["pnpm"]
        elif shutil.which("npx"):
            pnpm_cmd = ["npx", "pnpm"]
        else:
            msg = "pnpm (or npx) is required to build the frontend. Install: npm i -g pnpm"
            raise RuntimeError(msg)

        self.app.display_info("Installing frontend dependencies...")
        subprocess.run([*pnpm_cmd, "install", "--frozen-lockfile", "--force"], cwd=str(frontend_dir), check=True)

        self.app.display_info("Building frontend...")
        subprocess.run([*pnpm_cmd, "build"], cwd=str(frontend_dir), check=True)
