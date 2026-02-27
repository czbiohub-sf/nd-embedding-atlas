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


def _is_anndata(p: Path) -> bool:
    """Check if a path is an AnnData store (.h5ad file or .zarr with obs/)."""
    if p.is_file() and p.suffix == ".h5ad":
        return True
    return p.is_dir() and p.suffix == ".zarr" and (p / "obs").is_dir()


def _is_ome_zarr(p: Path) -> bool:
    """Check if a path is an OME-Zarr store (.zarr without obs/)."""
    return p.is_dir() and p.suffix == ".zarr" and not (p / "obs").is_dir()


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


def _classify_paths(paths: list[Path]) -> tuple[str, list[Path]]:
    """Classify input paths as AnnData or OME-Zarr.

    Returns
    -------
    tuple[str, list[Path]]
        ("anndata", resolved_paths) or ("ome-zarr", resolved_paths).
    """
    anndata_paths = _resolve_anndata(paths)
    ome_paths = [p.resolve() for p in paths if _is_ome_zarr(p.resolve())]

    if anndata_paths and not ome_paths:
        return "anndata", anndata_paths
    if ome_paths and not anndata_paths:
        return "ome-zarr", ome_paths

    if anndata_paths and ome_paths:
        msg = "Cannot mix AnnData and OME-Zarr paths. Use --plate to attach an OME-Zarr to an AnnData viewer."
        raise typer.BadParameter(msg)

    msg = "No AnnData (.zarr with obs/, .h5ad) or OME-Zarr stores found."
    raise typer.BadParameter(msg)


@app.command()
def view(
    paths: Annotated[list[Path], typer.Argument(help="AnnData or OME-Zarr paths.")],
    # ── AnnData-specific ──
    plate: Annotated[Path | None, typer.Option("--plate", "-p", help="OME-Zarr plate for cell crop viewer.")] = None,
    obs_columns: Annotated[
        list[str] | None,
        typer.Option("--obs-columns", help="Subset of obs columns to load (comma-sep or repeated)."),
    ] = None,
    export_dir: Annotated[
        Path | None, typer.Option("--export-dir", "-e", help="Directory for exported zarr stores.")
    ] = None,
    columns_config: Annotated[
        Path | None, typer.Option("--columns-config", "-C", help="YAML file mapping spatial column names.")
    ] = None,
    # ── OME-Zarr-specific ──
    channels: Annotated[str | None, typer.Option("--channels", "-c", help="Comma-separated channel names.")] = None,
    # ── Shared ──
    host: Annotated[str, typer.Option(help="Server host.")] = "localhost",
    port: Annotated[int, typer.Option(help="Server port.")] = 5055,
    dry_run: Annotated[bool, typer.Option("--dry-run", help="Print metadata and exit.")] = False,
) -> None:
    """Launch the viewer. Auto-detects AnnData vs OME-Zarr inputs."""
    kind, resolved = _classify_paths(paths)

    if kind == "ome-zarr":
        from nd_embedding_atlas.cli._ndimg import view_ome_zarr

        view_ome_zarr(resolved, channels=channels, host=host, port=port, dry_run=dry_run)
    else:
        from nd_embedding_atlas.cli._ndea import view_anndata

        view_anndata(
            resolved,
            plate=plate,
            obs_columns=obs_columns,
            export_dir=export_dir,
            columns_config=columns_config,
            host=host,
            port=port,
        )
