"""nd-embedding-atlas CLI."""

from __future__ import annotations

from pathlib import Path
from typing import Annotated

import typer

app = typer.Typer(
    name="nd-embedding-atlas",
    add_completion=False,
    no_args_is_help=True,
)


def _resolve_inputs(paths: list[Path]) -> list[Path]:
    """Expand directories to *.zarr children and filter to AnnData zarrs."""
    result: list[Path] = []
    for p in paths:
        p = p.resolve()
        if p.is_dir() and p.suffix == ".zarr" and (p / "obs").is_dir():
            result.append(p)
        elif p.is_dir():
            result.extend(child for child in sorted(p.glob("*.zarr")) if (child / "obs").is_dir())
    return result


@app.command()
def view(
    paths: Annotated[list[Path], typer.Argument(help="AnnData .zarr paths or directories containing them.")],
    plate: Annotated[Path | None, typer.Option("--plate", "-p", help="OME-Zarr plate for cell crop viewer.")] = None,
    host: Annotated[str, typer.Option(help="Server host.")] = "localhost",
    port: Annotated[int, typer.Option(help="Server port.")] = 5055,
) -> None:
    """Launch the interactive embedding viewer for one or more AnnData datasets."""
    from rich.console import Console

    from nd_embedding_atlas import vz
    from nd_embedding_atlas.io import AnnDataCollection

    console = Console()

    zarr_paths = _resolve_inputs(paths)
    if not zarr_paths:
        console.print("[red]No AnnData .zarr stores found in the given paths.[/red]")
        raise typer.Exit(1)

    console.print(f"Found [cyan]{len(zarr_paths)}[/cyan] dataset(s):")
    collection = AnnDataCollection()
    for p in zarr_paths:
        key = p.stem
        console.print(f"  {key} → {p}")
        collection[key] = p

    console.print(f"\n[bold]{collection.n_obs:,}[/bold] obs x [bold]{collection.n_vars:,}[/bold] vars")

    resolved_plate = str(plate.resolve()) if plate is not None else None
    console.print(f"\nServing at [link=http://{host}:{port}]http://{host}:{port}[/link]")
    vz.serve(collection, plate_path=resolved_plate, host=host, port=port)
