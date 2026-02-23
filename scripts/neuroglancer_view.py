#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.12"
# dependencies = [
#     "iohub==0.3.0a5",
#     "neuroglancer>=2.40",
#     "numpy",
#     "pyyaml",
#     "rich>=14",
#     "typer>=0.21.1",
# ]
# ///
"""Neuroglancer viewer CLI for OME-Zarr datasets with iohub metadata parsing.

Uses iohub for robust OME-NGFF metadata handling and neuroglancer
for visualization with adjustable contrast controls.

Usage::

    uv run scripts/neuroglancer_view.py /path/to/data.zarr
    uv run scripts/neuroglancer_view.py /path/to/data.zarr --position A/1/0
    uv run scripts/neuroglancer_view.py /path/to/data.zarr --channels "Phase3D,GFP"
    uv run scripts/neuroglancer_view.py /path/to/data.zarr --dry-run
"""

from __future__ import annotations

from pathlib import Path
from typing import Annotated

import neuroglancer
import numpy as np
import typer
from iohub.ngff import open_ome_zarr
from rich.console import Console

def _load_channel_colors() -> dict[str, list[float]]:
    """Load channel colors from scripts/channel_colors.yaml and convert hex to RGB [0-1]."""
    import yaml

    yaml_path = Path(__file__).parent / "channel_colors.yaml"
    with yaml_path.open() as f:
        hex_map: dict[str, str] = yaml.safe_load(f)

    colors: dict[str, list[float]] = {}
    for name, hex_str in hex_map.items():
        r = int(hex_str[0:2], 16) / 255
        g = int(hex_str[2:4], 16) / 255
        b = int(hex_str[4:6], 16) / 255
        colors[name] = [r, g, b]
    return colors


CHANNEL_COLORS = _load_channel_colors()

app = typer.Typer(add_completion=False)
console = Console()


@app.command()
def main(
    zarr_path: Annotated[Path, typer.Argument(help="Path to the OME-Zarr store to visualize.")],
    position: Annotated[str | None, typer.Option("--position", "-p", help="Position key (e.g. A/1/0).")] = None,
    channels: Annotated[str | None, typer.Option("--channels", "-c", help="Comma-separated channel names.")] = None,
    bind_address: Annotated[str, typer.Option(help="Server bind address for neuroglancer.")] = "0.0.0.0",
    contrast_percentile_low: Annotated[float, typer.Option(help="Lower percentile for auto-contrast.")] = 1.0,
    contrast_percentile_high: Annotated[float, typer.Option(help="Upper percentile for auto-contrast.")] = 99.0,
    voxel_size: Annotated[
        str | None, typer.Option(help='Override voxel size as "z,y,x" in microns (e.g. "0.2,0.103,0.103").')
    ] = None,
    time_point: Annotated[int, typer.Option("--time-point", "-t", help="Time point to display.")] = 0,
    dry_run: Annotated[
        bool, typer.Option("--dry-run", help="Test loading and setup without launching viewer.")
    ] = False,
) -> None:
    """Launch neuroglancer viewer for OME-Zarr datasets using iohub metadata."""
    console.print(f"Starting neuroglancer viewer for [cyan]{zarr_path}[/cyan]")

    # Open zarr store with iohub
    try:
        dataset = open_ome_zarr(str(zarr_path), mode="r")
        console.print(f"  Dataset type: [bold]{type(dataset).__name__}[/bold]")
        console.print("  Opened with iohub (supports Zarr v2/v3 and OME-NGFF 0.4/0.5)")
    except Exception as e:
        console.print(f"[red]Error opening zarr store: {e}[/red]")
        raise typer.Exit(1) from e

    # Get position
    try:
        pos_obj = _get_position(dataset, position)
    except Exception as e:
        console.print(f"[red]Error getting position: {e}[/red]")
        raise typer.Exit(1) from e

    # Get metadata using iohub's API
    data_shape = pos_obj.data.shape
    channel_names = list(pos_obj.channel_names)
    scale = pos_obj.scale

    console.print("\nPosition metadata:")
    console.print(f"  Shape: {data_shape}")
    console.print(f"  Channels: {channel_names}")
    console.print(f"  Scale (um): {scale}")

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
                console.print(f"[yellow]Warning: Channel '{ch_name}' not found, skipping[/yellow]")

        if not channel_indices:
            console.print("[red]Error: No valid channels specified[/red]")
            raise typer.Exit(1)
    else:
        channel_indices = list(range(len(channel_names)))
        filtered_channel_names = channel_names

    console.print(f"\nDisplaying channels: {filtered_channel_names}")

    # Calculate auto-contrast by sampling (lazy loading)
    console.print("\nCalculating auto-contrast (sampling 10% of pixels)...")
    contrast_ranges = []
    channel_colors = []

    for idx, name in zip(channel_indices, filtered_channel_names, strict=True):
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

            console.print(f"  + {name}: contrast=[{data_min:.1f}, {data_max:.1f}], color={color_name}")
        except Exception as e:
            console.print(f"  [red]x Error processing {name}: {e}[/red]")
            raise typer.Exit(1) from e

    # Determine voxel size
    if voxel_size:
        parts = voxel_size.split(",")
        if len(parts) != 3:
            console.print("[red]Error: voxel size must have 3 values (z,y,x)[/red]")
            raise typer.Exit(1)
        try:
            voxel_size_um = [float(v) for v in parts]
        except ValueError as e:
            console.print(f"[red]Error parsing voxel size: {e}[/red]")
            raise typer.Exit(1) from e
    else:
        voxel_size_um = scale[-3:] if len(scale) >= 3 else [1.0, 1.0, 1.0]

    voxel_size_nm = [v * 1000 for v in voxel_size_um]
    console.print(f"\nVoxel size: {voxel_size_um} um = {voxel_size_nm} nm")

    if dry_run:
        console.print("\n[green]Dry run: setup completed successfully![/green]")
        return

    # Start neuroglancer
    console.print(f"\nStarting neuroglancer server (binding to {bind_address})...")
    neuroglancer.set_server_bind_address(bind_address)
    viewer = neuroglancer.Viewer()

    console.print("\nLoading channels into neuroglancer...")

    with viewer.txn() as s:
        dimensions = neuroglancer.CoordinateSpace(
            names=["z", "y", "x"],
            units=["nm", "nm", "nm"],
            scales=voxel_size_nm,
        )

        for idx, name, (data_min, data_max), color in zip(
            channel_indices, filtered_channel_names, contrast_ranges, channel_colors, strict=True
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
                console.print(f"  + Added layer: {name}")
            except (ValueError, TypeError, RuntimeError) as e:
                console.print(f"  [red]x Error adding layer {name}: {e}[/red]")

        # 30-degree tilt from top-down XY view in the 3D perspective panel.
        # Quaternion for 30° rotation around X axis: [sin(15°), 0, 0, cos(15°)]
        tilt_rad = np.radians(15)
        s.projection_orientation = [np.sin(tilt_rad), 0, 0, np.cos(tilt_rad)]

    console.print("\n[bold green]Neuroglancer viewer is ready![/bold green]")
    console.print(f"\n  URL: {viewer}")
    console.print("\nPress Ctrl+C to exit...")

    try:
        import time

        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        console.print("\n\nShutting down viewer...")


def _get_position(dataset, position_key):
    """Get position object from dataset using iohub API."""
    if hasattr(dataset, "positions"):
        positions_list = list(dataset.positions())
        available_keys = [k for k, _ in positions_list]

        if position_key is None:
            pos_key, _ = positions_list[0]
            console.print(f"Using first position: {pos_key}")
            console.print(f"  (Available positions: {available_keys})")
        else:
            if position_key not in available_keys:
                msg = f"Position '{position_key}' not found. Available: {available_keys}"
                raise ValueError(msg)
            pos_key = position_key
            console.print(f"Using position: {pos_key}")

        return dataset[pos_key]
    else:
        if position_key is not None:
            console.print("[yellow]Warning: Position key ignored (dataset is not a Plate)[/yellow]")
        console.print("Dataset is a single Position")
        return dataset


def _extract_channel_data(data, channel_idx, time_point):
    """Extract channel data as numpy array."""
    shape = data.shape

    if len(shape) == 5:  # TCZYX
        if time_point >= shape[0]:
            msg = f"Time point {time_point} out of range (max: {shape[0] - 1})"
            raise ValueError(msg)
        return np.array(data[time_point, channel_idx, :, :, :])
    elif len(shape) == 4:  # CZYX
        if time_point != 0:
            console.print(f"[yellow]Warning: Time point {time_point} requested but data has no time dimension[/yellow]")
        return np.array(data[channel_idx, :, :, :])
    else:
        msg = f"Unexpected data shape: {shape} (expected CZYX or TCZYX)"
        raise ValueError(msg)


def _sample_contrast_range(data, channel_idx, time_point, low_pct, high_pct, sample_fraction=0.1):
    """Calculate contrast range by efficiently sampling pixels using downsampling."""
    shape = data.shape

    if len(shape) == 5:  # TCZYX
        if time_point >= shape[0]:
            msg = f"Time point {time_point} out of range (max: {shape[0] - 1})"
            raise ValueError(msg)
        z_size, y_size, x_size = shape[2], shape[3], shape[4]
    elif len(shape) == 4:  # CZYX
        z_size, y_size, x_size = shape[1], shape[2], shape[3]
    else:
        msg = f"Unexpected data shape: {shape}"
        raise ValueError(msg)

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
    app()
