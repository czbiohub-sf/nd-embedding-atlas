#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.12"
# dependencies = [
#     "annbatch",
#     "anndata>=0.12.9",
#     "httpx>=0.28",
#     "rich>=14",
#     "typer>=0.21.1",
#     "zarr>=3.1.5",
#     "zarrs>=0.2.1",
# ]
# ///
"""Download CellxGene datasets and convert to Zarr v3 with sharding.

Downloads .h5ad files from CellxGene into a temp directory, converts each to
Zarr v3 format using annbatch write_sharded, and writes the final .zarr stores to
the output directory. Temp files are cleaned up after each successful conversion.

Datasets that already exist as .zarr in the output directory are skipped.

These datasets are for testing the scalability of the embedding-atlas backend and the ability
to handle large concatenated AnnData objects.

The datasets are from: https://cellxgene.cziscience.com/collections/bc7397a3-ea49-4d57-84b8-80bd6885d4c4

Usage::

    uv run scripts/download_cellxgene_datasets.py
    uv run scripts/download_cellxgene_datasets.py /path/to/output
"""

from __future__ import annotations

import tempfile
from pathlib import Path

import typer
from rich.console import Console

app = typer.Typer(add_completion=False)
console = Console()

DATASETS = [
    "b4245b7b-3bc7-4d88-8b1b-d5c22d70981f",
    "8840342c-e7cd-4c46-8cac-9b9934f569ff",
    "3a641906-bbb3-4019-a8d4-9af1722375b7",
]

BASE_URL = "https://datasets.cellxgene.cziscience.com"
DEFAULT_OUTPUT = Path(__file__).parent.parent / "data"


def _download(dataset_id: str, dest: Path) -> None:
    """Download a single .h5ad file with a progress bar."""
    import httpx
    from rich.progress import BarColumn, DownloadColumn, Progress, SpinnerColumn, TransferSpeedColumn

    url = f"{BASE_URL}/{dataset_id}.h5ad"
    console.print(f"  [blue]Downloading[/blue] {dataset_id}.h5ad")

    with httpx.stream("GET", url, follow_redirects=True, timeout=None) as response:
        response.raise_for_status()
        total = int(response.headers.get("content-length", 0))

        with Progress(
            SpinnerColumn(),
            "[progress.description]{task.description}",
            BarColumn(),
            DownloadColumn(),
            TransferSpeedColumn(),
            console=console,
        ) as progress:
            task = progress.add_task(dest.name, total=total)
            with dest.open("wb") as f:
                for chunk in response.iter_bytes(chunk_size=8192):
                    f.write(chunk)
                    progress.update(task, advance=len(chunk))


def _convert(h5ad_path: Path, zarr_path: Path) -> None:
    """Convert a single .h5ad to Zarr v3 with sharding."""
    import anndata as ad
    import zarr
    import zarrs  # noqa: F401
    from annbatch import write_sharded

    zarr.config.set({"codec_pipeline.path": "zarrs.ZarrsCodecPipeline", "threading.max_workers": None})

    console.print(f"  [cyan]Reading[/cyan] {h5ad_path.name}")
    adata = ad.read_h5ad(h5ad_path)
    console.print(f"    {adata.n_obs:,} obs x {adata.n_vars:,} vars")

    console.print(f"  [cyan]Writing[/cyan] {zarr_path.name}")
    group = zarr.open_group(zarr_path, mode="w", zarr_version=3)
    write_sharded(group, adata)
    zarr.consolidate_metadata(zarr_path)


@app.command()
def main(
    output: Path = typer.Argument(DEFAULT_OUTPUT, help="Output directory for .zarr stores."),
) -> None:
    """Download CellxGene datasets and convert to Zarr v3."""
    from rich.progress import Progress, SpinnerColumn, TextColumn, TimeElapsedColumn

    output = output.resolve()
    output.mkdir(parents=True, exist_ok=True)

    console.print("\n[bold]CellxGene → Zarr v3 pipeline[/bold]")
    console.print(f"  Output: {output}")
    console.print(f"  Datasets: {len(DATASETS)}\n")

    with tempfile.TemporaryDirectory(prefix="ndea_") as tmpdir:
        tmp = Path(tmpdir)

        for dataset_id in DATASETS:
            zarr_path = output / f"{dataset_id}.zarr"

            if zarr_path.exists():
                console.print(f"[yellow]Skipping[/yellow] {dataset_id} (.zarr already exists)")
                continue

            console.print(f"[bold]{dataset_id}[/bold]")
            h5ad_path = tmp / f"{dataset_id}.h5ad"

            try:
                _download(dataset_id, h5ad_path)

                with Progress(
                    SpinnerColumn(),
                    TextColumn("[progress.description]{task.description}"),
                    TimeElapsedColumn(),
                    console=console,
                ) as progress:
                    task = progress.add_task("Converting to Zarr v3...", total=None)
                    _convert(h5ad_path, zarr_path)
                    progress.update(task, completed=True)

                console.print(f"  [green]Done:[/green] {zarr_path}\n")

            except Exception as e:  # noqa: BLE001
                console.print(f"  [red]Failed:[/red] {e}\n")
                # Clean up partial zarr output on failure
                if zarr_path.exists():
                    import shutil

                    shutil.rmtree(zarr_path)
            finally:
                h5ad_path.unlink(missing_ok=True)

    console.print("[bold green]Done![/bold green]\n")


if __name__ == "__main__":
    app()
