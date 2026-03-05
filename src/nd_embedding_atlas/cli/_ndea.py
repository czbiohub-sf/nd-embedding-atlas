"""Embedding atlas viewer (ndea) command implementation."""

from __future__ import annotations

from pathlib import Path


def view_anndata(
    data_paths: list[Path],
    *,
    plate: Path | None,
    obs_columns: list[str] | None,
    export_dir: Path | None,
    columns_config: Path | None,
    duckdb_threads: int | None = None,
    pool_workers: int | None = None,
    host: str,
    port: int,
) -> None:
    """Launch the embedding atlas viewer.

    Parameters
    ----------
    data_paths
        Resolved AnnData store paths.
    plate
        Optional OME-Zarr plate for the observation viewer.
    obs_columns
        Subset of obs columns to load.
    export_dir
        Directory for exported zarr stores.
    columns_config
        Path to YAML column mapping file.
    duckdb_threads
        DuckDB internal thread count.
    pool_workers
        Request handler thread pool size.
    host
        Server bind address.
    port
        Server port.
    """
    from rich.console import Console

    from nd_embedding_atlas.io import AnnDataCollection, load_config
    from nd_embedding_atlas.server import serve

    console = Console()

    console.print(f"Found [cyan]{len(data_paths)}[/cyan] dataset(s):")
    collection = AnnDataCollection()
    for p in data_paths:
        key = p.stem
        console.print(f"  {key} → {p}")
        collection[key] = p

    console.print(f"\n[bold]{collection.n_obs:,}[/bold] obs x [bold]{collection.n_vars:,}[/bold] vars")

    # Expand comma-separated values: --obs-columns "a,b,c" → ["a", "b", "c"]
    if obs_columns:
        obs_columns = [col.strip() for raw in obs_columns for col in raw.split(",") if col.strip()]
        console.print(f"  obs columns: {', '.join(obs_columns)}")

    resolved_plate = str(plate.resolve()) if plate is not None else None
    resolved_export = str(export_dir.resolve()) if export_dir is not None else None
    if resolved_export:
        console.print(f"  export dir: {resolved_export}")

    config = None
    if columns_config:
        config = load_config(columns_config)
        obs_cols = set(collection.obs.keys())
        config.validate_against_obs(obs_cols)
        console.print(f"  columns config: {columns_config}")

    console.print(f"\nServing at [link=http://{host}:{port}]http://{host}:{port}[/link]")
    serve(
        collection,
        obs_columns=obs_columns or None,
        plate_path=resolved_plate,
        export_dir=resolved_export,
        columns_config=config,
        duckdb_threads=duckdb_threads,
        pool_workers=pool_workers,
        host=host,
        port=port,
    )
