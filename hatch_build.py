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

        # ── Resolve pnpm ──────────────────────────────────────────────────────
        # HPC environments typically have Node.js as a module but not pnpm globally.
        # npx can download and run pnpm on demand.
        if shutil.which("pnpm"):
            pnpm_cmd = ["pnpm"]
        elif shutil.which("npx"):
            pnpm_cmd = ["npx", "pnpm"]
        else:
            msg = "Node.js (with npx) is required to build the frontend. Load it with: module load nodejs"
            raise RuntimeError(msg)

        self.app.display_info("Installing frontend dependencies...")
        subprocess.run([*pnpm_cmd, "install", "--frozen-lockfile"], cwd=str(frontend_dir), check=True)

        # ── Resolve vp (vite-plus) ────────────────────────────────────────────
        # Prefer a globally installed vp; fall back to npx which downloads
        # vite-plus on demand (works on HPC with Node.js but no global vp).
        if shutil.which("vp"):
            vp_cmd = ["vp"]
        elif shutil.which("npx"):
            vp_cmd = ["npx", "vite-plus"]
        else:
            msg = "npx not found. Ensure Node.js is loaded: module load nodejs"
            raise RuntimeError(msg)

        self.app.display_info(f"Building frontend with: {' '.join(vp_cmd)}")
        subprocess.run([*vp_cmd, "build"], cwd=str(frontend_dir), check=True)
