#!/usr/bin/env python
"""Neuroglancer viewer CLI for OME-Zarr datasets with iohub metadata parsing.

This version uses iohub for robust OME-NGFF metadata handling and neuroglancer
for visualization with adjustable contrast controls.

Environment Setup:
    source <repo>/scripts/setup-neuroglancer-iohub.sh

    This activates /hpc/mydata/$USER/envs/neuroglancer_iohub.

Dependencies (provided by the environment):
    - click
    - neuroglancer
    - iohub (with zarr v2/v3 support)
    - numpy
"""

import os
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
ENV_NAME = "neuroglancer_iohub"


def check_environment():
    """Check if required packages are available and provide setup instructions."""
    missing_packages = []

    try:
        import click  # noqa: F401
    except ImportError:
        missing_packages.append("click")

    try:
        import neuroglancer  # noqa: F401
    except ImportError:
        missing_packages.append("neuroglancer")

    try:
        import iohub  # noqa: F401
    except ImportError:
        missing_packages.append("iohub")

    try:
        import numpy  # noqa: F401
    except ImportError:
        missing_packages.append("numpy")

    if missing_packages:
        user = os.environ.get("USER", "YOUR_USERNAME")
        setup_script = SCRIPT_DIR / f"setup-{ENV_NAME}.sh"
        env_dir = f"/hpc/mydata/{user}/envs/{ENV_NAME}"

        print("=" * 70, file=sys.stderr)
        print("ERROR: Required packages not found", file=sys.stderr)
        print("=" * 70, file=sys.stderr)
        print(f"\nMissing packages: {', '.join(missing_packages)}", file=sys.stderr)
        print(f"\nThis script requires the {ENV_NAME} conda environment.", file=sys.stderr)
        print("\nPlease run:\n", file=sys.stderr)
        print(f"    source {setup_script}", file=sys.stderr)
        print("\nOr manually activate:", file=sys.stderr)
        print("    module load anaconda", file=sys.stderr)
        print("    module load comp_micro", file=sys.stderr)
        print(f"    conda activate {env_dir}", file=sys.stderr)
        print("\n" + "=" * 70, file=sys.stderr)
        sys.exit(1)


# Check environment before importing heavy dependencies
check_environment()

import click
import neuroglancer
import numpy as np
from iohub.ngff import open_ome_zarr


# Fluorescence microscopy channel color conventions
# Colors are in RGB format [R, G, B] with values 0-1
CHANNEL_COLORS = {
    # DNA stains
    "DAPI": [0.0, 0.5, 1.0],
    "Hoechst": [0.0, 0.5, 1.0],
    "H2B": [0.0, 0.5, 1.0],
    # Green fluorophores
    "GFP": [0.0, 1.0, 0.0],
    "FITC": [0.0, 1.0, 0.0],
    "Alexa488": [0.0, 1.0, 0.0],
    "EGFP": [0.0, 1.0, 0.0],
    # Red fluorophores
    "RFP": [1.0, 0.0, 0.0],
    "mCherry": [1.0, 0.0, 0.0],
    "TXR": [1.0, 0.0, 0.0],
    "Texas Red": [1.0, 0.0, 0.0],
    "TRITC": [1.0, 0.3, 0.0],
    "Alexa594": [1.0, 0.0, 0.0],
    "Alexa568": [1.0, 0.3, 0.0],
    "tdTomato": [1.0, 0.0, 0.0],
    "mScarlet": [1.0, 0.0, 0.0],
    "CAAX": [1.0, 0.0, 0.0],
    # Far-red/Magenta fluorophores
    "Cy5": [1.0, 0.0, 1.0],
    "Alexa647": [1.0, 0.0, 1.0],
    "Cy7": [1.0, 0.0, 0.5],
    # Cyan fluorophores
    "CFP": [0.0, 1.0, 1.0],
    "mTurquoise": [0.0, 1.0, 1.0],
    # Yellow fluorophores
    "YFP": [1.0, 1.0, 0.0],
    "Venus": [1.0, 1.0, 0.0],
    # Brightfield/Phase
    "BF": [1.0, 1.0, 1.0],
    "Phase": [1.0, 1.0, 1.0],
    "Phase3D": [1.0, 1.0, 1.0],
    "Brightfield": [1.0, 1.0, 1.0],
    "DIC": [1.0, 1.0, 1.0],
    # Default for unknown channels
    "default": [1.0, 1.0, 1.0],
}


@click.command()
@click.argument("zarr_path", type=click.Path(exists=True, path_type=Path))
@click.option(
    "--position",
    "-p",
    default=None,
    help='Position key (e.g., "A/1/0" or "0/0/0"). If not specified, uses first position.',
)
@click.option(
    "--channels",
    "-c",
    default=None,
    help="Comma-separated channel names to display (default: all channels)",
)
@click.option(
    "--bind-address",
    default="0.0.0.0",
    help="Server bind address for neuroglancer (default: 0.0.0.0)",
)
@click.option(
    "--contrast-percentile-low",
    default=1.0,
    type=float,
    help="Lower percentile for auto-contrast (default: 1.0)",
)
@click.option(
    "--contrast-percentile-high",
    default=99.0,
    type=float,
    help="Upper percentile for auto-contrast (default: 99.0)",
)
@click.option(
    "--voxel-size",
    default=None,
    help='Override voxel size as "z,y,x" in microns (e.g., "0.2,0.103,0.103")',
)
@click.option(
    "--time-point",
    "-t",
    default=0,
    type=int,
    help="Time point to display for time-series data (default: 0)",
)
@click.option(
    "--dry-run",
    is_flag=True,
    help="Test loading and setup without launching viewer",
)
def main(
    zarr_path,
    position,
    channels,
    bind_address,
    contrast_percentile_low,
    contrast_percentile_high,
    voxel_size,
    time_point,
    dry_run,
):
    """Launch neuroglancer viewer for OME-Zarr datasets using iohub metadata.

    ZARR_PATH: Path to the OME-Zarr store to visualize.

    \b
    Examples:
        # View first position with all channels
        neuroglancer_view.py /path/to/data.zarr

        # View specific position
        neuroglancer_view.py /path/to/data.zarr --position A/1/0

        # View specific channels only
        neuroglancer_view.py /path/to/data.zarr --channels "Phase3D,GFP"

        # Override voxel size
        neuroglancer_view.py /path/to/data.zarr --voxel-size "0.2,0.103,0.103"

        # View time-series data at specific time point
        neuroglancer_view.py /path/to/data.zarr --time-point 5

        # Dry run to test without launching viewer
        neuroglancer_view.py /path/to/data.zarr --dry-run
    """
    click.echo(f"Starting neuroglancer viewer for: {zarr_path}")

    # Open zarr store with iohub
    try:
        dataset = open_ome_zarr(zarr_path, mode="r")
        click.echo(f"Dataset type: {type(dataset).__name__}")
        click.echo("Opened with iohub (supports Zarr v2/v3 and OME-NGFF 0.4/0.5)")
    except Exception as e:
        click.echo(f"Error opening zarr store: {e}", err=True)
        sys.exit(1)

    # Get position
    try:
        pos_obj = _get_position(dataset, position)
    except Exception as e:
        click.echo(f"Error getting position: {e}", err=True)
        sys.exit(1)

    # Get metadata using iohub's API
    data_shape = pos_obj.data.shape
    channel_names = list(pos_obj.channel_names)
    scale = pos_obj.scale

    click.echo("\nPosition metadata:")
    click.echo(f"  Shape: {data_shape}")
    click.echo(f"  Channels: {channel_names}")
    click.echo(f"  Scale (um): {scale}")

    # Filter channels if specified
    if channels:
        requested_channels = [c.strip() for c in channels.split(",")]
        channel_indices = []
        filtered_channel_names = []

        for ch_name in requested_channels:
            if ch_name in channel_names:
                channel_indices.append(channel_names.index(ch_name))
                filtered_channel_names.append(ch_name)
            else:
                click.echo(f"Warning: Channel '{ch_name}' not found, skipping", err=True)

        if not channel_indices:
            click.echo("Error: No valid channels specified", err=True)
            sys.exit(1)
    else:
        channel_indices = list(range(len(channel_names)))
        filtered_channel_names = channel_names

    click.echo(f"\nDisplaying channels: {filtered_channel_names}")

    # Calculate auto-contrast by sampling (lazy loading)
    click.echo("\nCalculating auto-contrast (sampling 10% of pixels)...")
    contrast_ranges = []
    channel_colors = []

    for idx, name in zip(channel_indices, filtered_channel_names):
        try:
            data_min, data_max = _sample_contrast_range(
                pos_obj.data,
                idx,
                time_point,
                contrast_percentile_low,
                contrast_percentile_high,
                sample_fraction=0.1,
            )
            contrast_ranges.append((data_min, data_max))

            color = _get_channel_color(name)
            channel_colors.append(color)
            color_name = f"RGB({color[0]:.1f}, {color[1]:.1f}, {color[2]:.1f})"

            click.echo(f"  + {name}: contrast=[{data_min:.1f}, {data_max:.1f}], color={color_name}")
        except Exception as e:
            click.echo(f"  x Error processing {name}: {e}", err=True)
            sys.exit(1)

    # Determine voxel size
    if voxel_size:
        try:
            voxel_size_um = [float(v) for v in voxel_size.split(",")]
            if len(voxel_size_um) != 3:
                raise ValueError("Must specify 3 values (z,y,x)")
        except Exception as e:
            click.echo(f"Error parsing voxel size: {e}", err=True)
            sys.exit(1)
    else:
        voxel_size_um = scale[-3:] if len(scale) >= 3 else [1.0, 1.0, 1.0]

    voxel_size_nm = [v * 1000 for v in voxel_size_um]
    click.echo(f"\nVoxel size: {voxel_size_um} um = {voxel_size_nm} nm")

    if dry_run:
        click.echo("\n" + "=" * 70)
        click.echo("DRY RUN: Setup completed successfully!")
        click.echo("=" * 70)
        return

    # Start neuroglancer
    click.echo(f"\nStarting neuroglancer server (binding to {bind_address})...")
    neuroglancer.set_server_bind_address(bind_address)
    viewer = neuroglancer.Viewer()

    click.echo("\nLoading channels into neuroglancer...")

    with viewer.txn() as s:
        dimensions = neuroglancer.CoordinateSpace(
            names=["z", "y", "x"],
            units=["nm", "nm", "nm"],
            scales=voxel_size_nm,
        )

        for idx, name, (data_min, data_max), color in zip(
            channel_indices, filtered_channel_names, contrast_ranges, channel_colors
        ):
            try:
                channel_data = _extract_channel_data(pos_obj.data, idx, time_point)

                s.layers[name] = neuroglancer.ImageLayer(
                    source=neuroglancer.LocalVolume(
                        data=channel_data,
                        dimensions=dimensions,
                    ),
                    shader=f"""
#uicontrol invlerp normalized(range=[{data_min}, {data_max}])
void main() {{
  emitRGB(
    vec3({color[0]}, {color[1]}, {color[2]}) * normalized()
  );
}}
""",
                )
                click.echo(f"  + Added layer: {name}")
            except Exception as e:
                click.echo(f"  x Error adding layer {name}: {e}", err=True)

    click.echo(f"\n{'=' * 70}")
    click.echo("Neuroglancer viewer is ready!")
    click.echo(f"\nURL: {viewer}")
    click.echo(f"{'=' * 70}\n")
    click.echo("Press Ctrl+C to exit...")

    try:
        import time

        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        click.echo("\n\nShutting down viewer...")


def _get_position(dataset, position_key):
    """Get position object from dataset using iohub API."""
    if hasattr(dataset, "positions"):
        positions_list = list(dataset.positions())
        available_keys = [k for k, _ in positions_list]

        if position_key is None:
            pos_key, _ = positions_list[0]
            click.echo(f"Using first position: {pos_key}")
            click.echo(f"  (Available positions: {available_keys})")
        else:
            if position_key not in available_keys:
                raise ValueError(
                    f"Position '{position_key}' not found. Available: {available_keys}"
                )
            pos_key = position_key
            click.echo(f"Using position: {pos_key}")

        return dataset[pos_key]
    else:
        if position_key is not None:
            click.echo("Warning: Position key ignored (dataset is not a Plate)", err=True)
        click.echo("Dataset is a single Position")
        return dataset


def _extract_channel_data(data, channel_idx, time_point):
    """Extract channel data as numpy array."""
    shape = data.shape

    if len(shape) == 5:  # TCZYX
        if time_point >= shape[0]:
            raise ValueError(f"Time point {time_point} out of range (max: {shape[0] - 1})")
        return np.array(data[time_point, channel_idx, :, :, :])
    elif len(shape) == 4:  # CZYX
        if time_point != 0:
            click.echo(
                f"Warning: Time point {time_point} requested but data has no time dimension",
                err=True,
            )
        return np.array(data[channel_idx, :, :, :])
    else:
        raise ValueError(f"Unexpected data shape: {shape} (expected CZYX or TCZYX)")


def _sample_contrast_range(data, channel_idx, time_point, low_pct, high_pct, sample_fraction=0.1):
    """Calculate contrast range by efficiently sampling pixels using downsampling."""
    shape = data.shape

    if len(shape) == 5:  # TCZYX
        if time_point >= shape[0]:
            raise ValueError(f"Time point {time_point} out of range (max: {shape[0] - 1})")
        z_size, y_size, x_size = shape[2], shape[3], shape[4]
    elif len(shape) == 4:  # CZYX
        z_size, y_size, x_size = shape[1], shape[2], shape[3]
    else:
        raise ValueError(f"Unexpected data shape: {shape}")

    total_pixels = z_size * y_size * x_size
    target_pixels = int(total_pixels * sample_fraction)
    stride = max(1, int(np.cbrt(total_pixels / target_pixels)))

    if len(shape) == 5:
        sample = np.array(data[time_point, channel_idx, ::stride, ::stride, ::stride])
    else:
        sample = np.array(data[channel_idx, ::stride, ::stride, ::stride])

    data_min = float(np.percentile(sample, low_pct))
    data_max = float(np.percentile(sample, high_pct))

    return data_min, data_max


def _get_channel_color(channel_name):
    """Get RGB color for a channel based on name."""
    for key, color in CHANNEL_COLORS.items():
        if key.lower() == channel_name.lower():
            return color

    channel_name_lower = channel_name.lower()
    for key, color in CHANNEL_COLORS.items():
        if key.lower() in channel_name_lower:
            return color

    return CHANNEL_COLORS["default"]


if __name__ == "__main__":
    main()
