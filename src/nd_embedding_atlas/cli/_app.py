"""nd-embedding-atlas CLI — unified entrypoint with auto-detection."""

from __future__ import annotations

from pathlib import Path
from typing import Annotated

import typer

app = typer.Typer(
    name="nd-embedding-atlas",
    add_completion=False,
    no_args_is_help=True,
)


def _is_mudata(p: Path) -> bool:
    """Check if a path is a MuData store (.h5mu file or .zarr with mod/)."""
    from nd_embedding_atlas.io._mudata import is_mudata

    return is_mudata(p)


def _is_anndata(p: Path) -> bool:
    """Check if a path is an AnnData store (.h5ad file or .zarr with obs/)."""
    if p.is_file() and p.suffix == ".h5ad":
        return True
    return p.is_dir() and p.suffix == ".zarr" and (p / "obs").is_dir() and not (p / "mod").is_dir()


def _is_ome_zarr(p: Path) -> bool:
    """Check if a path is an OME-Zarr store (.zarr without obs/)."""
    return p.is_dir() and p.suffix == ".zarr" and not (p / "obs").is_dir() and not (p / "mod").is_dir()


def _resolve_anndata(paths: list[Path]) -> list[Path]:
    """Expand directories to AnnData stores and filter to valid inputs."""
    result: list[Path] = []
    for p in paths:
        p = p.resolve()
        if _is_anndata(p):
            result.append(p)
        elif p.is_dir():
            result.extend(child for child in sorted(p.glob("*.zarr")) if _is_anndata(child))
            result.extend(sorted(p.glob("*.h5ad")))
    return result


def _classify_paths(
    paths: list[Path],
) -> tuple[list[Path], list[Path]]:
    """Split input paths into (anndata_paths, ome_zarr_paths).

    Mixed paths are allowed — an OME-Zarr alongside AnnData is treated as
    the image viewer store, equivalent to passing it via --ome-zarr.

    Returns
    -------
    tuple[list[Path], list[Path]]
        (anndata_paths, ome_zarr_paths) — either or both may be non-empty.
    """
    anndata_paths = _resolve_anndata(paths)
    ome_paths = [p.resolve() for p in paths if _is_ome_zarr(p.resolve())]

    if not anndata_paths and not ome_paths:
        msg = "No AnnData (.zarr with obs/, .h5ad) or OME-Zarr stores found."
        raise typer.BadParameter(msg)

    if anndata_paths and ome_paths and len(ome_paths) > 1:
        msg = "At most one OME-Zarr store may be passed alongside AnnData paths."
        raise typer.BadParameter(msg)

    return anndata_paths, ome_paths


@app.command()
def view(
    paths: Annotated[list[Path], typer.Argument(help="AnnData / OME-Zarr paths, or a multi-dataset YAML config.")],
    # ── AnnData-specific ──
    export_dir: Annotated[
        Path | None, typer.Option("--export-dir", "-e", help="Directory for exported zarr stores.")
    ] = None,
    # ── Shared ──
    port: Annotated[int, typer.Option(help="Server port.")] = 5055,
    dry_run: Annotated[bool, typer.Option("--dry-run", help="Validate inputs and exit without launching.")] = False,
    # ── Hidden (dev / advanced) ──
    host: Annotated[str, typer.Option(help="Server host.", hidden=True)] = "localhost",
    duckdb_threads: Annotated[
        int | None, typer.Option("--duckdb-threads", help="DuckDB internal thread count.", hidden=True)
    ] = None,
    pool_workers: Annotated[
        int | None, typer.Option("--pool-workers", help="Request handler thread pool size.", hidden=True)
    ] = None,
    no_static: Annotated[
        bool, typer.Option("--no-static", help="Skip mounting the built frontend (use with vp dev).", hidden=True)
    ] = False,
) -> None:
    """Launch the viewer. Auto-detects AnnData vs OME-Zarr inputs."""
    # YAML project config detection — must resolve before suffix check to handle symlinks
    resolved_first = paths[0].resolve()
    if resolved_first.suffix in (".yaml", ".yml"):
        from nd_embedding_atlas.cli._project import view_project

        view_project(
            resolved_first,
            export_dir=export_dir,
            duckdb_threads=duckdb_threads,
            pool_workers=pool_workers,
            host=host,
            port=port,
            no_static=no_static,
        )
        return

    # MuData detection — must come before AnnData classification since MuData
    # zarrs also have obs/ but are distinguished by the mod/ group.
    mudata_paths = [p.resolve() for p in paths if _is_mudata(p.resolve())]
    if mudata_paths:
        from nd_embedding_atlas.cli._mudata import view_mudata

        ome_paths = [p.resolve() for p in paths if _is_ome_zarr(p.resolve())]
        view_mudata(
            mudata_paths[0],
            ome_zarr=ome_paths[0] if ome_paths else None,
            export_dir=export_dir,
            duckdb_threads=duckdb_threads,
            pool_workers=pool_workers,
            host=host,
            port=port,
            no_static=no_static,
        )
        return

    anndata_paths, ome_paths = _classify_paths(paths)

    if not anndata_paths:
        # Pure OME-Zarr mode
        from nd_embedding_atlas.cli._ndimg import view_ome_zarr

        view_ome_zarr(ome_paths, host=host, port=port, dry_run=dry_run)
    else:
        from nd_embedding_atlas.cli._ndea import view_anndata

        view_anndata(
            anndata_paths,
            ome_zarr=ome_paths[0] if ome_paths else None,
            export_dir=export_dir,
            duckdb_threads=duckdb_threads,
            pool_workers=pool_workers,
            host=host,
            port=port,
            no_static=no_static,
        )
