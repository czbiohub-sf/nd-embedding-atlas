#!/usr/bin/env python
"""idetik viewer CLI for OME-Zarr datasets.

Uses the idetik WebGL frontend (via nd-embedding-atlas) for visualization
of OME-Zarr plates and positions.

Requires nd-embedding-atlas installed in the environment (not on PyPI).
Use the project venv or the imviz CLI entry point::

    uv run python scripts/idetik_view.py /path/to/data.zarr
    uv run imviz /path/to/data.zarr
"""

from __future__ import annotations

from pathlib import Path
from typing import Annotated

import typer
from rich.console import Console

app = typer.Typer(add_completion=False)
console = Console()


@app.command()
def main(
    zarr_path: Annotated[Path, typer.Argument(help="Path to the OME-Zarr store to visualize.")],
    position: Annotated[str | None, typer.Option("--position", "-p", help="Position key (e.g. A/1/0).")] = None,
    channels: Annotated[str | None, typer.Option("--channels", "-c", help="Comma-separated channel names.")] = None,
    bind_address: Annotated[str, typer.Option(help="Server bind address.")] = "0.0.0.0",
    port: Annotated[int, typer.Option(help="Server port.")] = 5055,
    dry_run: Annotated[bool, typer.Option("--dry-run", help="Print metadata and exit.")] = False,
) -> None:
    """Launch idetik viewer for OME-Zarr datasets."""
    from nd_embedding_atlas.imviz import get_plate_metadata, serve

    if not zarr_path.exists():
        console.print(f"[red]Path does not exist: {zarr_path}[/red]")
        raise typer.Exit(1)

    console.print(f"Reading metadata from [cyan]{zarr_path}[/cyan]...")
    meta = get_plate_metadata(zarr_path)

    console.print(f"  Type: [bold]{meta['type']}[/bold]")
    console.print(f"  Positions: {len(meta['positions'])}")
    console.print(f"  Channels: {meta['channel_names']}")
    console.print(f"  Shape: {meta['shape']}")
    console.print(f"  Scale: {meta['scale']}")

    if dry_run:
        console.print("\n[green]Dry run complete.[/green]")
        if len(meta["positions"]) <= 20:
            for pos in meta["positions"]:
                console.print(f"    {pos}")
        else:
            for pos in meta["positions"][:10]:
                console.print(f"    {pos}")
            console.print(f"    ... ({len(meta['positions']) - 10} more)")
        return

    channel_list = [c.strip() for c in channels.split(",")] if channels else None

    serve(
        plate_path=zarr_path,
        position=position,
        channels=channel_list,
        host=bind_address,
        port=port,
    )


if __name__ == "__main__":
    app()
