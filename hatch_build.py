"""Custom hatch build hook that builds the frontend before packaging."""

from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

from hatchling.builders.hooks.plugin.interface import BuildHookInterface


class CustomBuildHook(BuildHookInterface):
    """Build the React frontend and copy it into the package source tree."""

    def initialize(self, version, build_data):
        """Build frontend with vp (vite-plus) and copy dist/ into src/_frontend/."""
        frontend_dir = Path(self.root) / "frontend"
        dist_dir = frontend_dir / "dist"
        target_dir = Path(self.root) / "src" / "nd_embedding_atlas" / "_frontend"

        # ── Build frontend if dist/ is missing ───────────────────────────────
        if not (dist_dir.is_dir() and any(dist_dir.iterdir())):
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
        else:
            self.app.display_info("Frontend dist/ exists, skipping build")

        # ── Copy dist/ → src/nd_embedding_atlas/_frontend/ ───────────────────
        self.app.display_info(f"Copying frontend dist/ → {target_dir}")
        if target_dir.exists():
            shutil.rmtree(target_dir)
        shutil.copytree(dist_dir, target_dir)
