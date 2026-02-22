#!/bin/bash
# Setup for the neuroglancer OME-Zarr viewer.
#
# The neuroglancer viewer is fully standalone — all deps are on PyPI.
# uv resolves them automatically via PEP 723 inline script metadata.
#
# ──────────────────────────────────────────────────────────────────────
# Option A — standalone script (no install needed, uv resolves deps):
#
#   uv run scripts/neuroglancer_view.py /path/to/data.zarr
#   uv run scripts/neuroglancer_view.py /path/to/data.zarr --dry-run
#
# Option B — project venv with neuroglancer group:
#
#   source scripts/setup-neuroglancer-iohub.sh   # creates & activates venv
#   python scripts/neuroglancer_view.py /path/to/data.zarr
#
# ──────────────────────────────────────────────────────────────────────

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_DIR="/hpc/mydata/${USER}/envs/neuroglancer_iohub"

if [ ! -d "$ENV_DIR" ]; then
    echo "Creating neuroglancer_iohub environment at $ENV_DIR ..."
    uv venv "$ENV_DIR" --python 3.12
    uv pip install --python "$ENV_DIR/bin/python" \
        -e "$REPO_DIR" \
        "neuroglancer>=2.40" \
        numpy
    echo "  Environment created with nd-embedding-atlas + neuroglancer."
else
    echo "  Environment already exists at $ENV_DIR"
fi

# Activate
# shellcheck disable=SC1091
source "$ENV_DIR/bin/activate"

echo ""
echo "neuroglancer_iohub environment activated."
echo ""
echo "Usage:"
echo "  python scripts/neuroglancer_view.py /path/to/data.zarr            # launch viewer"
echo "  python scripts/neuroglancer_view.py /path/to/data.zarr --dry-run  # inspect metadata"
echo "  python scripts/neuroglancer_view.py --help                         # show options"
echo ""
echo "Or standalone (no setup script needed):"
echo "  uv run scripts/neuroglancer_view.py /path/to/data.zarr"
