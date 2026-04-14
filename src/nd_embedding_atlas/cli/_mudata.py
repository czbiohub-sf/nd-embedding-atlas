"""MuData viewer command implementation."""

from __future__ import annotations

from pathlib import Path


def view_mudata(
    mudata_path: Path,
    *,
    ome_zarr: Path | None,
    export_dir: Path | None,
    duckdb_threads: int | None = None,
    pool_workers: int | None = None,
    host: str,
    port: int,
    no_static: bool = False,
) -> None:
    """Launch the embedding atlas viewer for a MuData store."""
    from rich.console import Console

    from nd_embedding_atlas.io._mudata import MuDataSource
    from nd_embedding_atlas.server._app import create_app, serve_app

    console = Console()
    source = MuDataSource(mudata_path)

    console.print(f"MuData store: [cyan]{mudata_path}[/cyan]")
    console.print(f"Modalities: {', '.join(source.modalities)}")
    for mod in source.modalities:
        mod_obsm = [k.split(":", 1)[1] for k in source.obsm_keys() if k.startswith(f"{mod}:")]
        console.print(f"  [bold]{mod}[/bold]: {source.var_counts.get(mod, 0):,} vars, obsm={mod_obsm}")

    console.print(f"\nServing at [link=http://{host}:{port}]http://{host}:{port}[/link]")

    app = create_app(
        source,
        plate_path=str(ome_zarr.resolve()) if ome_zarr else None,
        export_dir=str(export_dir.resolve()) if export_dir else None,
        duckdb_threads=duckdb_threads,
        pool_workers=pool_workers,
        no_static=no_static,
    )
    serve_app(app, host=host, port=port)
