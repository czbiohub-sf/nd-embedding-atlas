#!/bin/bash
# Setup for the ndimg OME-Zarr viewer.
#
# The ndimg viewer requires nd-embedding-atlas installed (not on PyPI),
# so it runs from the project venv — not as a standalone uv script.
#
# ──────────────────────────────────────────────────────────────────────
# Option A — project venv (recommended for development):
#
#   cd /path/to/nd-embedding-atlas
#   uv sync
#   uv run ndimg /path/to/data.zarr                   # CLI entry point
#   uv run python scripts/ndimg_view.py /path/to/data.zarr  # script
#
# Option B — separate venv (for users who don't develop nd-embedding-atlas):
#
#   source scripts/setup-ndimg-iohub.sh   # creates & activates venv
#   ndimg /path/to/data.zarr
#
# ──────────────────────────────────────────────────────────────────────

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_DIR="/hpc/mydata/${USER}/envs/ndimg_iohub"

if [ ! -d "$ENV_DIR" ]; then
    echo "Creating ndimg_iohub environment at $ENV_DIR ..."
    uv venv "$ENV_DIR" --python 3.12
    uv pip install --python "$ENV_DIR/bin/python" -e "$REPO_DIR"
    echo "  Environment created and nd-embedding-atlas installed."
else
    echo "  Environment already exists at $ENV_DIR"
fi

# Activate
# shellcheck disable=SC1091
source "$ENV_DIR/bin/activate"

echo ""
echo "ndimg_iohub environment activated."
echo ""
echo "Usage:"
echo "  ndimg /path/to/data.zarr                   # launch viewer"
echo "  ndimg /path/to/data.zarr --dry-run          # inspect metadata"
echo "  ndimg --help                                 # show options"
echo ""
echo "Or from the project venv (without this script):"
echo "  uv run ndimg /path/to/data.zarr"
echo "  uv run python scripts/ndimg_view.py /path/to/data.zarr"
