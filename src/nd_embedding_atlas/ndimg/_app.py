"""CLI command for launching the ndimg viewer."""

from __future__ import annotations

from pathlib import Path
from typing import Annotated

import typer

app = typer.Typer(
    name="ndimg",
    add_completion=False,
    no_args_is_help=True,
)


@app.command()
def view(
    zarr_paths: Annotated[list[Path], typer.Argument(help="Path(s) to OME-Zarr plate(s) or position(s).")],
    position: Annotated[str | None, typer.Option("--position", "-p", help="Position key (e.g. A/1/0).")] = None,
    channels: Annotated[str | None, typer.Option("--channels", "-c", help="Comma-separated channel names.")] = None,
    host: Annotated[str, typer.Option(help="Server bind address.")] = "0.0.0.0",
    port: Annotated[int, typer.Option(help="Server port.")] = 5055,
    dry_run: Annotated[bool, typer.Option("--dry-run", help="Print metadata and exit.")] = False,
) -> None:
    """Launch the ndimg OME-Zarr image viewer."""
    from rich.console import Console

    from nd_embedding_atlas.ndimg._metadata import detect_ome_version, get_plate_metadata

    console = Console()

    for zarr_path in zarr_paths:
        if not zarr_path.exists():
            console.print(f"[red]Path does not exist: {zarr_path}[/red]")
            raise typer.Exit(1)

    for zarr_path in zarr_paths:
        ome_ver = detect_ome_version(zarr_path)
        console.print(f"Reading metadata from [cyan]{zarr_path}[/cyan] (OME-NGFF {ome_ver})...")
        meta = get_plate_metadata(zarr_path)

        console.print(f"  Type: [bold]{meta['type']}[/bold]")
        console.print(f"  Positions: {len(meta['positions'])}")
        console.print(f"  Channels: {meta['channel_names']}")
        console.print(f"  Shape: {meta['shape']}")
        console.print(f"  Scale: {meta['scale']}")

    if dry_run:
        console.print("\n[green]Dry run complete.[/green]")
        for zarr_path in zarr_paths:
            meta = get_plate_metadata(zarr_path)
            console.print(f"\n  [bold]{zarr_path.stem}[/bold] ({len(meta['positions'])} positions):")
            if len(meta["positions"]) <= 10:
                for pos in meta["positions"]:
                    console.print(f"    {pos}")
            else:
                for pos in meta["positions"][:5]:
                    console.print(f"    {pos}")
                console.print(f"    ... ({len(meta['positions']) - 5} more)")
        return

    channel_list = [c.strip() for c in channels.split(",")] if channels else None

    from nd_embedding_atlas.ndimg._serve import serve

    console.print(f"\nServing at [link=http://{host}:{port}]http://{host}:{port}[/link]")
    serve(
        plate_paths=zarr_paths,
        position=position,
        channels=channel_list,
        host=host,
        port=port,
    )
