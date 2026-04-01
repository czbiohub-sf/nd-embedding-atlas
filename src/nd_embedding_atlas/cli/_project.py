"""Project mode CLI entrypoint — launches viewer from a multi-dataset YAML config."""

from __future__ import annotations

from pathlib import Path


def view_project(
    config_path: Path,
    *,
    export_dir: Path | None,
    columns_config: Path | None,
    duckdb_threads: int | None,
    pool_workers: int | None,
    host: str,
    port: int,
    no_static: bool,
) -> None:
    """Launch the viewer from a project YAML configuration file.

    Parameters
    ----------
    config_path
        Resolved path to the project YAML file.
    export_dir
        Directory for exported zarr stores. ``None`` uses ``./exports``.
    columns_config
        Path to YAML column mapping config.
    duckdb_threads
        DuckDB internal thread count.
    pool_workers
        Request handler thread pool size.
    host
        Server bind host.
    port
        Server bind port.
    no_static
        Skip mounting the built frontend.
    """
    from nd_embedding_atlas.io import AnnDataCollection  # noqa: PLC0415
    from nd_embedding_atlas.io._project import load_project  # noqa: PLC0415
    from nd_embedding_atlas.server._app import serve  # noqa: PLC0415

    project = load_project(config_path)
    collection = AnnDataCollection()
    dataset_plates: dict[str, Path] = {}

    for key, spec in project.datasets.items():
        collection[key] = spec.anndata
        if spec.hcs_plate:
            dataset_plates[key] = spec.hcs_plate

    # Load columns_config if provided
    columns_cfg = None
    if columns_config is not None:
        from nd_embedding_atlas.io._config import load_config  # noqa: PLC0415

        columns_cfg = load_config(columns_config)

    serve(
        collection,
        dataset_plates=dataset_plates or None,
        project_config_path=config_path,
        export_dir=export_dir,
        columns_config=columns_cfg,
        duckdb_threads=duckdb_threads,
        pool_workers=pool_workers,
        host=host,
        port=port,
        no_static=no_static,
    )
