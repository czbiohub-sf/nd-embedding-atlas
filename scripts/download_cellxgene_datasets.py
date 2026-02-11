#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.12"
# dependencies = [
#     "httpx>=0.28",
#     "rich>=14",
# ]
# ///
"""Download CellxGene datasets for ome-atlas testing."""

from pathlib import Path

import httpx
from rich.console import Console
from rich.progress import BarColumn, DownloadColumn, Progress, SpinnerColumn, TransferSpeedColumn

DATASETS = [
    "b4245b7b-3bc7-4d88-8b1b-d5c22d70981f",
    "8840342c-e7cd-4c46-8cac-9b9934f569ff",
    "3a641906-bbb3-4019-a8d4-9af1722375b7",
]

BASE_URL = "https://datasets.cellxgene.cziscience.com"
DATA_DIR = Path(__file__).parent.parent / "data"


def download_file(dataset_id: str, dest: Path, console: Console) -> None:
    """Download a file with progress bar."""
    if dest.exists():
        console.print(f"[yellow]Skipping[/yellow] {dest.name} (already exists)")
        return

    url = f"{BASE_URL}/{dataset_id}.h5ad"
    console.print(f"[blue]Downloading[/blue] {dest.name}")

    with httpx.stream("GET", url, follow_redirects=True, timeout=None) as response:
        response.raise_for_status()
        total = int(response.headers.get("content-length", 0))

        with Progress(
            SpinnerColumn(),
            "[progress.description]{task.description}",
            BarColumn(),
            DownloadColumn(),
            TransferSpeedColumn(),
            console=console,
        ) as progress:
            task = progress.add_task(dest.name, total=total)

            with dest.open("wb") as f:
                for chunk in response.iter_bytes(chunk_size=8192):
                    f.write(chunk)
                    progress.update(task, advance=len(chunk))

    console.print(f"[green]Downloaded[/green] {dest.name}")


def main() -> None:
    """Download all CellxGene datasets."""
    console = Console()

    console.print(f"\n[bold]Downloading CellxGene datasets to {DATA_DIR}[/bold]\n")

    DATA_DIR.mkdir(parents=True, exist_ok=True)

    for dataset_id in DATASETS:
        dest = DATA_DIR / f"{dataset_id}.h5ad"
        try:
            download_file(dataset_id, dest, console)
        except httpx.HTTPStatusError as e:
            console.print(f"[red]Error downloading {dataset_id}:[/red] {e}")
        except OSError as e:
            console.print(f"[red]Unexpected error:[/red] {e}")

    console.print("\n[bold green]Done![/bold green]\n")


if __name__ == "__main__":
    main()
