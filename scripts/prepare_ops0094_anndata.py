#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.12"
# dependencies = [
#     "annbatch",
#     "anndata>=0.11",
#     "numpy>=2",
#     "pandas>=2",
#     "rich>=14",
#     "typer>=0.21.1",
#     "zarr>=3",
#     "zarrs>=0.2.1",
# ]
# ///
"""Prepare an OPS h5ad for nd-embedding-atlas: convert to zarr v3, then inject UMAP.

1. Converts the source h5ad to zarr v3 with sharding via annbatch
2. Injects UMAP coordinates into obsm/X_umap in the zarr store

Usage::

    uv run scripts/prepare_ops0094_anndata.py INPUT_H5AD UMAP_CSV OUTPUT_ZARR
"""

from __future__ import annotations

from pathlib import Path

import typer
from rich.console import Console

app = typer.Typer(add_completion=False)
console = Console()


@app.command()
def main(
    input_h5ad: Path = typer.Argument(help="Source h5ad file with cell features."),
    umap_csv: Path = typer.Argument(help="CSV with UMAP coordinates (columns: umap_1, umap_2)."),
    output_zarr: Path = typer.Argument(help="Output path for the zarr v3 store."),
) -> None:
    """Convert OPS h5ad to zarr v3 and inject UMAP embeddings."""
    import anndata as ad
    import numpy as np
    import pandas as pd
    import zarr
    import zarrs  # noqa: F401
    from annbatch import write_sharded
    from rich.progress import Progress, SpinnerColumn, TextColumn, TimeElapsedColumn

    zarr.config.set({"codec_pipeline.path": "zarrs.ZarrsCodecPipeline", "threading.max_workers": None})

    if not input_h5ad.exists():
        console.print(f"[red]Input h5ad not found:[/red] {input_h5ad}")
        raise typer.Exit(1)
    if not umap_csv.exists():
        console.print(f"[red]UMAP CSV not found:[/red] {umap_csv}")
        raise typer.Exit(1)

    # ── Step 1: Convert h5ad → zarr v3 with sharding ────────────────
    if output_zarr.exists():
        console.print(f"[yellow]zarr already exists, skipping conversion:[/yellow] {output_zarr}")
    else:
        console.print(f"[cyan]Reading[/cyan] {input_h5ad}")
        adata = ad.read_h5ad(input_h5ad)
        console.print(f"  {adata.n_obs:,} obs x {adata.n_vars:,} vars")

        console.print(f"\n[cyan]Converting to zarr v3[/cyan] → {output_zarr}")
        with Progress(
            SpinnerColumn(),
            TextColumn("[progress.description]{task.description}"),
            TimeElapsedColumn(),
            console=console,
        ) as progress:
            progress.add_task("Writing zarr v3 with sharding...", total=None)
            output_zarr.parent.mkdir(parents=True, exist_ok=True)
            group = zarr.open_group(output_zarr, mode="w", zarr_version=3)
            write_sharded(group, adata)
            zarr.consolidate_metadata(output_zarr)
        console.print("  [green]Done[/green]")
        del adata

    # ── Step 2: Inject UMAP into zarr obsm ──────────────────────────
    group = zarr.open_group(output_zarr, mode="r+")

    if "obsm" in group and "X_umap" in group["obsm"]:
        console.print("\n[yellow]X_umap already exists in zarr store, skipping injection[/yellow]")
    else:
        console.print(f"\n[cyan]Reading UMAP coordinates from[/cyan] {umap_csv}")
        umap_df = pd.read_csv(umap_csv, index_col=0)
        umap_arr = np.asarray(umap_df[["umap_1", "umap_2"]].values, dtype=np.float32)
        console.print(f"  UMAP shape: {umap_arr.shape}")

        # Validate row count against obs
        n_obs = group["obs"].attrs.get("shape", [0])[0] if "obs" in group else 0
        if n_obs == 0:
            # Fallback: read first obs column length
            obs_group = group["obs"]
            first_key = next(iter(obs_group.keys()), None)
            if first_key is not None:
                n_obs = obs_group[first_key].shape[0]
        if n_obs > 0 and n_obs != umap_arr.shape[0]:
            msg = f"Row count mismatch: zarr has {n_obs} obs, UMAP CSV has {umap_arr.shape[0]}"
            raise ValueError(msg)

        console.print("[cyan]Injecting X_umap into obsm[/cyan]")
        if "obsm" not in group:
            group.create_group("obsm")
        zarr.save_array(output_zarr / "obsm" / "X_umap", umap_arr)

        # Re-consolidate metadata after adding the array
        zarr.consolidate_metadata(output_zarr)
        console.print(f"  [green]Done[/green] — wrote {umap_arr.shape} float32 array")

    console.print("\n[bold green]All done![/bold green]")
    console.print(f"  zarr: {output_zarr}")


if __name__ == "__main__":
    app()
