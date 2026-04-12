"""Embedding atlas viewer (ndea) command implementation."""

from __future__ import annotations

from pathlib import Path


def view_anndata(
    data_paths: list[Path],
    *,
    ome_zarr: Path | None,
    export_dir: Path | None,
    duckdb_threads: int | None = None,
    pool_workers: int | None = None,
    host: str,
    port: int,
    no_static: bool = False,
) -> None:
    """Launch the embedding atlas viewer.

    Parameters
    ----------
    data_paths
        Resolved AnnData store paths.
    ome_zarr
        Optional OME-Zarr image store for the viewer.
    export_dir
        Directory for exported zarr stores.
    duckdb_threads
        DuckDB internal thread count.
    pool_workers
        Request handler thread pool size.
    host
        Server bind address.
    port
        Server port.
    no_static
        Skip mounting the built frontend.
    """
    from rich.console import Console

    from nd_embedding_atlas.io import DatasetCollection
    from nd_embedding_atlas.server import serve

    console = Console()

    console.print(f"Found [cyan]{len(data_paths)}[/cyan] dataset(s):")
    collection = DatasetCollection()
    for p in data_paths:
        key = p.stem
        console.print(f"  {key} → {p}")
        collection[key] = p

    console.print(f"\n[bold]{collection.n_obs:,}[/bold] obs x [bold]{collection.n_vars:,}[/bold] vars")

    resolved_ome_zarr = str(ome_zarr.resolve()) if ome_zarr is not None else None
    resolved_export = str(export_dir.resolve()) if export_dir is not None else None
    if resolved_export:
        console.print(f"  export dir: {resolved_export}")

    console.print(f"\nServing at [link=http://{host}:{port}]http://{host}:{port}[/link]")
    serve(
        collection,
        plate_path=resolved_ome_zarr,
        export_dir=resolved_export,
        duckdb_threads=duckdb_threads,
        pool_workers=pool_workers,
        host=host,
        port=port,
        no_static=no_static,
    )
