#!/bin/bash
# Setup script for neuroglancer_iohub environment.
# This environment supports Zarr v2/v3 with iohub, neuroglancer, and zarr-python.
#
# Usage:
#   source scripts/setup-neuroglancer-iohub.sh
#
# The environment is a conda env under /hpc/mydata/$USER/envs/neuroglancer_iohub.

ENV_DIR="/hpc/mydata/${USER}/envs/neuroglancer_iohub"

if [ ! -d "$ENV_DIR" ]; then
    echo "ERROR: Environment not found at $ENV_DIR" >&2
    echo "" >&2
    echo "Create it with:" >&2
    echo "  module load anaconda && module load comp_micro" >&2
    echo "  conda create -p $ENV_DIR python=3.12 neuroglancer iohub numpy click" >&2
    return 1 2>/dev/null || exit 1
fi

echo "Setting up neuroglancer_iohub environment..."

# Load required modules
module load anaconda
module load comp_micro

# Activate environment
conda activate "$ENV_DIR"

# Resolve the scripts directory relative to this setup script
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "  neuroglancer_iohub environment activated"
echo ""
echo "Available tools:"
echo "  - $SCRIPT_DIR/neuroglancer_view.py - Neuroglancer viewer CLI"
echo ""
echo "Usage:"
echo "  $SCRIPT_DIR/neuroglancer_view.py /path/to/data.zarr"
echo "  $SCRIPT_DIR/neuroglancer_view.py --help"
