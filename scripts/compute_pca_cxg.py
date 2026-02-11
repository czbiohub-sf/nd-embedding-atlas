"""Compute PCA across CXG datasets and write X_pca back to zarr stores.

Loads all zarr stores lazily via dask, runs scanpy preprocessing
(normalize, log1p, HVG, PCA) with dask distributed, and writes
X_pca back into each zarr store's obsm via anndata.io.write_elem.

Usage:
    uv run python scripts/compute_pca_cxg.py
    uv run python scripts/compute_pca_cxg.py --n-comps 30 --n-hvgs 3000
"""

from __future__ import annotations

from pathlib import Path

import typer
from rich.console import Console

app = typer.Typer()
console = Console()

CXG_DIR = Path(__file__).parent.parent / ".." / "ome-atlas-test-data" / "cxg-data"


@app.command()
def main(  # noqa: D103
    directory: Path = typer.Argument(CXG_DIR, help="Directory containing .zarr stores"),
    n_comps: int = typer.Option(50, help="Number of PCA components"),
    n_hvgs: int = typer.Option(2000, help="Number of highly variable genes"),
    n_workers: int = typer.Option(3, help="Number of dask distributed workers"),
) -> None:
    import anndata as ad
    import dask.distributed as dd
    import numpy as np
    import scanpy as sc
    import zarr
    import zarrs  # noqa: F401
    from rich.progress import Progress, SpinnerColumn, TextColumn, TimeElapsedColumn

    zarr.config.set({"codec_pipeline.path": "zarrs.ZarrsCodecPipeline"})

    directory = directory.resolve()
    zarr_paths = sorted(directory.glob("*.zarr"))
    if not zarr_paths:
        console.print(f"[red]No .zarr stores found in {directory}[/red]")
        raise SystemExit(1)

    console.print(f"\n[bold]Computing PCA across {len(zarr_paths)} CXG datasets[/bold]")
    console.print(f"  Directory: {directory}")
    console.print(f"  Components: {n_comps}, HVGs: {n_hvgs}, Workers: {n_workers}\n")

    # Step 1: Start dask distributed cluster
    console.print("[bold]Starting dask distributed cluster...[/bold]")
    cluster = dd.LocalCluster(n_workers=n_workers)
    client = dd.Client(cluster)
    console.print(f"  Dashboard: {client.dashboard_link}\n")

    # Step 2: Load all datasets lazily
    adatas = {}
    dataset_sizes = {}
    with Progress(
        SpinnerColumn(), TextColumn("[progress.description]{task.description}"), TimeElapsedColumn(), console=console
    ) as progress:
        for zp in zarr_paths:
            label = zp.stem[:8]
            task = progress.add_task(f"Loading {label} (lazy)...", total=None)
            adata = ad.experimental.read_lazy(
                zarr.open_group(zp, use_consolidated=True),
                load_annotation_index=True,
            )
            adatas[label] = adata
            dataset_sizes[label] = adata.n_obs
            progress.update(task, completed=True)
            console.print(f"  {label}: {adata.n_obs:,} obs x {adata.n_vars:,} vars (lazy)")

    # Step 3: Concatenate (lazy — dask-backed)
    console.print("\n[bold]Concatenating (lazy)...[/bold]")
    combined = ad.concat(adatas, label="_dataset", index_unique="-")
    console.print(f"  Combined: {combined.n_obs:,} obs x {combined.n_vars:,} vars")
    console.print(f"  X type: {type(combined.X).__name__}")

    # Step 4: Preprocessing with scanpy dask support
    console.print(f"\n[bold]Preprocessing (normalize → log1p → {n_hvgs} HVGs → PCA)[/bold]")

    with Progress(
        SpinnerColumn(), TextColumn("[progress.description]{task.description}"), TimeElapsedColumn(), console=console
    ) as progress:
        task = progress.add_task("Normalizing (lazy)...", total=None)
        sc.pp.normalize_total(combined, target_sum=1e4)
        progress.update(task, completed=True)

        task = progress.add_task("Log-transforming (lazy)...", total=None)
        sc.pp.log1p(combined)
        progress.update(task, completed=True)

        task = progress.add_task(f"Selecting {n_hvgs} HVGs...", total=None)
        sc.pp.highly_variable_genes(combined, n_top_genes=n_hvgs)
        progress.update(task, completed=True)
        n_hvg_actual = combined.var["highly_variable"].sum()
        console.print(f"  Selected {n_hvg_actual:,} HVGs")

        task = progress.add_task(f"Computing PCA ({n_comps} components)...", total=None)
        sc.pp.pca(combined, n_comps=n_comps, use_highly_variable=True)
        progress.update(task, completed=True)

    # Step 5: Materialize PCA result
    pca = combined.obsm["X_pca"]
    if hasattr(pca, "compute"):
        console.print("  Materializing X_pca from dask...")
        pca = pca.compute()
    pca = np.asarray(pca, dtype=np.float32)
    console.print(f"  X_pca: {pca.shape}, dtype={pca.dtype}")

    # Step 6: Write X_pca back to each zarr store
    console.print("\n[bold]Writing X_pca to zarr stores[/bold]")

    offset = 0
    for zp in zarr_paths:
        label = zp.stem[:8]
        n_obs = dataset_sizes[label]
        pca_slice = pca[offset : offset + n_obs]
        offset += n_obs

        store = zarr.open_group(zp, mode="a", use_consolidated=False)
        if "X_pca" in store.get("obsm", {}):
            del store["obsm/X_pca"]
        ad.io.write_elem(store, "obsm/X_pca", pca_slice)
        zarr.consolidate_metadata(zp)

        console.print(f"  [green]Wrote[/green] {label}/obsm/X_pca: {pca_slice.shape}")

    # Cleanup
    client.close()
    cluster.close()

    console.print(
        f"\n[bold green]Done![/bold green] PCA ({n_comps} components) written to {len(zarr_paths)} zarr stores.\n"
    )


if __name__ == "__main__":
    app()
