#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.12"
# dependencies = [
#     "rich>=14",
#     "typer>=0.21.1",
# ]
# ///
"""Download DynaCLR zarr v3 datasets from public.czbiohub.org.

Uses wget to mirror the remote zarr stores into the output directory.
Stores that already exist locally are skipped.

Usage::

    uv run scripts/download_dynaclr_datasets.py
    uv run scripts/download_dynaclr_datasets.py /path/to/output
"""

from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

import typer
from rich.console import Console

app = typer.Typer(add_completion=False)
console = Console()

BASE_URL = "https://public.czbiohub.org/comp.micro/nd-embedding-atlas-test-data"

DATASETS = {
    "dataset.zarr": f"{BASE_URL}/dataset.zarr/",
    "annotations_zv3.zarr": f"{BASE_URL}/annotations_zv3.zarr/",
}


def _download_zarr(url: str, output_dir: Path) -> None:
    """Mirror a remote zarr store into *output_dir* via wget."""
    subprocess.run(
        [
            "wget",
            "-m",  # mirror (recursive + timestamps)
            "-np",  # don't ascend to parent directories
            "-nH",  # don't create host-named directory
            "-x",  # force directory structure
            "--cut-dirs=2",  # strip comp.micro/nd-embedding-atlas-test-data/
            "-R",
            "index.html*",
            "-q",  # fully silent
            "-P",
            str(output_dir),
            url,
        ],
        check=True,
    )


@app.command()
def main(
    output: Path = typer.Argument(
        Path(__file__).parent.parent / "data",
        help="Output directory for .zarr stores.",
    ),
) -> None:
    """Download DynaCLR datasets (zarr v3) from public.czbiohub.org."""
    if not shutil.which("wget"):
        msg = "wget is required. Install: brew install wget (macOS) or apt install wget (Linux)"
        raise RuntimeError(msg)

    output = output.resolve()
    output.mkdir(parents=True, exist_ok=True)

    console.print("\n[bold]DynaCLR dataset download[/bold]")
    console.print(f"  Output: {output}")
    console.print(f"  Datasets: {len(DATASETS)}\n")

    for name, url in DATASETS.items():
        zarr_path = output / name

        if zarr_path.exists():
            console.print(f"[yellow]Skipping[/yellow] {name} (already exists)")
            continue

        try:
            with console.status(f"[blue]Downloading[/blue] {name}"):
                _download_zarr(url, output)
            console.print(f"  [green]Done:[/green] {name}\n")
        except subprocess.CalledProcessError as e:
            console.print(f"  [red]Failed:[/red] wget exited with code {e.returncode}\n")
            if zarr_path.exists():
                shutil.rmtree(zarr_path)

    console.print("[bold green]Done![/bold green]\n")


if __name__ == "__main__":
    app()
