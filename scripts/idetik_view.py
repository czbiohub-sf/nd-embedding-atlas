#!/usr/bin/env python
"""idetik viewer CLI for OME-Zarr datasets.

Uses the idetik WebGL frontend (via nd-embedding-atlas) for visualization
of OME-Zarr plates and positions.

Environment Setup:
    source <repo>/scripts/setup-idetik-iohub.sh

    This activates /hpc/mydata/$USER/envs/idetik_iohub.

Dependencies (provided by the environment):
    - nd-embedding-atlas (includes idetik frontend, FastAPI, iohub)
    - click
"""

import os
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
ENV_NAME = "idetik_iohub"


def check_environment():
    """Check if required packages are available and provide setup instructions."""
    missing_packages = []

    try:
        import click  # noqa: F401
    except ImportError:
        missing_packages.append("click")

    try:
        import nd_embedding_atlas  # noqa: F401
    except ImportError:
        missing_packages.append("nd-embedding-atlas")

    try:
        import iohub  # noqa: F401
    except ImportError:
        missing_packages.append("iohub")

    if missing_packages:
        user = os.environ.get("USER", "YOUR_USERNAME")
        setup_script = SCRIPT_DIR / f"setup-{ENV_NAME}.sh"
        env_dir = f"/hpc/mydata/{user}/envs/{ENV_NAME}"

        print("=" * 70, file=sys.stderr)
        print("ERROR: Required packages not found", file=sys.stderr)
        print("=" * 70, file=sys.stderr)
        print(f"\nMissing packages: {', '.join(missing_packages)}", file=sys.stderr)
        print(f"\nThis script requires the {ENV_NAME} environment.", file=sys.stderr)
        print("\nPlease run:\n", file=sys.stderr)
        print(f"    source {setup_script}", file=sys.stderr)
        print("\nOr manually activate:", file=sys.stderr)
        print(f"    source {env_dir}/bin/activate", file=sys.stderr)
        print("\n" + "=" * 70, file=sys.stderr)
        sys.exit(1)


# Check environment before importing heavy dependencies
check_environment()

import click
from nd_embedding_atlas.imviz import get_plate_metadata, serve


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
    help="Server bind address (default: 0.0.0.0)",
)
@click.option(
    "--port",
    default=5055,
    type=int,
    help="Server port (default: 5055)",
)
@click.option(
    "--dry-run",
    is_flag=True,
    help="Print metadata and exit without launching viewer",
)
def main(zarr_path, position, channels, bind_address, port, dry_run):
    """Launch idetik viewer for OME-Zarr datasets.

    ZARR_PATH: Path to the OME-Zarr store to visualize.

    \b
    Examples:
        # View first position with all channels
        idetik_view.py /path/to/data.zarr

        # View specific position
        idetik_view.py /path/to/data.zarr --position A/1/0

        # View specific channels only
        idetik_view.py /path/to/data.zarr --channels "Phase3D,GFP"

        # Dry run to inspect metadata
        idetik_view.py /path/to/data.zarr --dry-run
    """
    click.echo(f"Reading metadata from: {zarr_path}")

    meta = get_plate_metadata(zarr_path)

    click.echo(f"\nDataset type: {meta['type']}")
    click.echo(f"  Positions: {len(meta['positions'])}")
    click.echo(f"  Channels: {meta['channel_names']}")
    click.echo(f"  Shape: {meta['shape']}")
    click.echo(f"  Scale: {meta['scale']}")

    if dry_run:
        click.echo(f"\n{'=' * 70}")
        click.echo("DRY RUN: Metadata read successfully!")
        click.echo(f"{'=' * 70}")
        if len(meta["positions"]) <= 20:
            for pos in meta["positions"]:
                click.echo(f"    {pos}")
        else:
            for pos in meta["positions"][:10]:
                click.echo(f"    {pos}")
            click.echo(f"    ... ({len(meta['positions']) - 10} more)")
        return

    channel_list = [c.strip() for c in channels.split(",")] if channels else None

    serve(
        plate_path=zarr_path,
        position=position,
        channels=channel_list,
        host=bind_address,
        port=port,
    )


if __name__ == "__main__":
    main()
