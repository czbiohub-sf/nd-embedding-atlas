#!/bin/bash
# Setup script for idetik_iohub environment.
# This environment provides the idetik WebGL viewer for OME-Zarr data
# via nd-embedding-atlas.
#
# Usage:
#   source scripts/setup-idetik-iohub.sh
#
# The environment is installed under /hpc/mydata/$USER/envs/idetik_iohub.
# To create it for the first time, run:
#
#   uv venv /hpc/mydata/$USER/envs/idetik_iohub --python 3.12
#   uv pip install --python /hpc/mydata/$USER/envs/idetik_iohub/bin/python \
#       -e /hpc/mydata/$USER/code/nd-embedding-atlas

ENV_DIR="/hpc/mydata/${USER}/envs/idetik_iohub"

if [ ! -d "$ENV_DIR" ]; then
    echo "ERROR: Environment not found at $ENV_DIR" >&2
    echo "" >&2
    echo "Create it with:" >&2
    echo "  uv venv $ENV_DIR --python 3.12" >&2
    echo "  uv pip install --python $ENV_DIR/bin/python \\" >&2
    echo "      -e /hpc/mydata/$USER/code/nd-embedding-atlas" >&2
    return 1 2>/dev/null || exit 1
fi

echo "Setting up idetik_iohub environment..."

# Activate uv-managed environment
source "$ENV_DIR/bin/activate"

# Resolve the scripts directory relative to this setup script
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "  idetik_iohub environment activated"
echo ""
echo "Available tools:"
echo "  - $SCRIPT_DIR/idetik_view.py  - idetik OME-Zarr viewer CLI"
echo "  - imviz                        - Typer CLI entry point"
echo ""
echo "Usage:"
echo "  $SCRIPT_DIR/idetik_view.py /path/to/data.zarr"
echo "  $SCRIPT_DIR/idetik_view.py /path/to/data.zarr --dry-run"
echo "  $SCRIPT_DIR/idetik_view.py --help"
