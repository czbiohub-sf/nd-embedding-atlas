"""Convert H5AD files to Zarr v3 format with sharding.

Converts all .h5ad files in the ./data/ directory to Zarr v3 format
using annbatch.write_sharded for efficient chunking and sharding.

Usage:
    uv run python scripts/convert_h5ad_to_zarrv3.py
"""

from pathlib import Path

import anndata as ad
import zarr
import zarrs  # noqa: F401
from annbatch import write_sharded
from rich.console import Console
from rich.progress import Progress, SpinnerColumn, TextColumn, TimeElapsedColumn

# Configure zarr to use zarrs codec pipeline for better performance
zarr.config.set(
    {
        "codec_pipeline.path": "zarrs.ZarrsCodecPipeline",
        "threading.max_workers": None,
    }
)

console = Console()


def convert_h5ad_to_zarr(h5ad_path: Path, output_dir: Path | None = None) -> Path:
    """Convert a single H5AD file to Zarr v3 format with sharding.

    Parameters
    ----------
    h5ad_path
        Path to the input H5AD file.
    output_dir
        Directory for output Zarr store. Defaults to same directory as input.

    Returns
    -------
    Path
        Path to the created Zarr store.
    """
    if output_dir is None:
        output_dir = h5ad_path.parent

    zarr_path = output_dir / f"{h5ad_path.stem}.zarr"

    # Read the H5AD file
    adata = ad.read_h5ad(h5ad_path)

    # Create zarr v3 group
    group = zarr.open_group(zarr_path, mode="w", zarr_version=3)

    # Write with sharding using annbatch defaults
    write_sharded(group, adata)

    # Consolidate metadata for efficient access
    zarr.consolidate_metadata(zarr_path)

    return zarr_path


def main() -> None:
    """Convert all H5AD files in ./data/ to Zarr v3 format."""
    data_dir = Path("data")

    if not data_dir.exists():
        console.print("[red]Error: ./data/ directory not found[/red]")
        raise SystemExit(1)

    h5ad_files = sorted(data_dir.glob("*.h5ad"))

    if not h5ad_files:
        console.print("[yellow]No .h5ad files found in ./data/[/yellow]")
        return

    console.print(f"[bold]Found {len(h5ad_files)} H5AD files to convert[/bold]\n")

    with Progress(
        SpinnerColumn(),
        TextColumn("[progress.description]{task.description}"),
        TimeElapsedColumn(),
        console=console,
    ) as progress:
        for h5ad_path in h5ad_files:
            task = progress.add_task(f"Converting {h5ad_path.name}...", total=None)

            try:
                zarr_path = convert_h5ad_to_zarr(h5ad_path)
                progress.update(task, completed=True)
                console.print(f"  [green]Created:[/green] {zarr_path}")
            except (OSError, zarr.errors.BaseZarrError, ad.ImplicitModificationError) as e:
                progress.update(task, completed=True)
                console.print(f"  [red]Failed:[/red] {h5ad_path.name} - {e}")

    console.print("\n[bold green]Conversion complete![/bold green]")


if __name__ == "__main__":
    main()
