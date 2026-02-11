# /// script
# requires-python = ">=3.12"
# dependencies = [
#     "anndata>=0.12.9",
#     "geff>=1.1.4",
#     "rich>=14.3.1",
#     "scipy>=1.14",
#     "typer>=0.21.1",
#     "zarr>=3.1.5",
#     "zarrs>=0.2.1",
# ]
# ///
"""Convert cell tracking AnnData to GEFF format and build obsp adjacency matrix.

Reads tracking data from a zarr-backed AnnData, constructs a directed tracking
graph (parent -> child edges from obs["parent_id"]), computes lineage IDs via
connected components, writes the graph to GEFF format, and creates a new AnnData
zarr store augmented with obsp["tracking"] (sparse adjacency) and obs["lineage_id"].

Usage::

    uv run scripts/convert_tracking_to_geff.py /path/to/annotations.zarr /path/to/output/
    uv run scripts/convert_tracking_to_geff.py  # uses defaults
"""

from __future__ import annotations

from pathlib import Path
from typing import TYPE_CHECKING, Any

import typer
from rich.console import Console

if TYPE_CHECKING:
    import anndata as ad
    import numpy as np
    import pandas as pd
    import scipy.sparse as sp
    from numpy.typing import NDArray

app = typer.Typer(add_completion=False)
console = Console()

DEFAULT_INPUT = Path(__file__).resolve().parent.parent / ".." / "ome-atlas-test-data" / "annotations_zv3.zarr"
DEFAULT_OUTPUT = Path(__file__).resolve().parent.parent / ".." / "ome-atlas-test-data" / "geff"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _configure_zarr() -> None:
    """Activate the zarrs Rust codec pipeline for faster zarr I/O."""
    import zarr
    import zarrs  # noqa: F401

    zarr.config.set({"codec_pipeline.path": "zarrs.ZarrsCodecPipeline"})


def _read_adata(path: Path) -> ad.AnnData:
    """Read a zarr-backed AnnData eagerly and log its shape.

    Parameters
    ----------
    path
        Path to the source zarr store.

    Returns
    -------
    The loaded AnnData object (fully in memory).
    """
    import anndata as ad

    console.print(f"[bold]Reading AnnData from[/bold] {path}")
    adata = ad.io.read_zarr(path)
    console.print(f"  Shape: {adata.n_obs:,} obs x {adata.n_vars:,} vars")
    console.print(f"  obs columns: {list(adata.obs.columns)}")
    return adata


def _build_edge_list(obs: pd.DataFrame) -> tuple[NDArray[np.int64], NDArray[np.int64], int, int]:
    """Build directed parent-to-child edge arrays from tracking columns.

    Cell IDs are only unique within a FOV, so parent lookups are scoped
    by (fov_name, parent_id).

    Parameters
    ----------
    obs
        Observation DataFrame with columns ``fov_name``, ``id``, and ``parent_id``.

    Returns
    -------
    A tuple of ``(src_indices, tgt_indices, n_roots, n_dangling)`` where
    ``src_indices[i] -> tgt_indices[i]`` represents a parent-to-child edge.
    """
    import numpy as np
    import pandas as pd

    # Build a lookup: (fov_name, cell_id) -> row index
    lookup = pd.Series(
        np.arange(len(obs), dtype=np.int64),
        index=pd.MultiIndex.from_arrays(
            [obs["fov_name"].astype(str), obs["id"].astype(np.int64)],
            names=["fov", "cell_id"],
        ),
    )

    parent_ids = obs["parent_id"].to_numpy().astype(np.int64)
    has_parent = parent_ids != -1
    n_roots = int((~has_parent).sum())

    # Look up the row index for each child's parent within the same FOV
    children = obs.loc[has_parent]
    parent_keys = pd.MultiIndex.from_arrays(
        [children["fov_name"].astype(str), parent_ids[has_parent]],
        names=["fov", "cell_id"],
    )

    # reindex returns NaN for parents not found in the lookup
    parent_row_indices = lookup.reindex(parent_keys).to_numpy()
    valid = ~np.isnan(parent_row_indices)
    n_dangling = int((~valid).sum())

    src = parent_row_indices[valid].astype(np.int64)
    tgt = np.where(has_parent)[0][valid].astype(np.int64)

    console.print("\n[bold]Edge construction[/bold]")
    console.print(f"  Valid edges: {len(src):,}")
    console.print(f"  Root cells (parent_id == -1): {n_roots:,}")
    console.print(f"  Dangling edges (parent not found): {n_dangling}")

    return src, tgt, n_roots, n_dangling


def _build_adjacency(
    src: NDArray[np.int64],
    tgt: NDArray[np.int64],
    *,
    n_nodes: int,
) -> sp.csr_matrix:
    """Build a sparse CSR adjacency matrix from edge arrays.

    Parameters
    ----------
    src
        Source (parent) row indices.
    tgt
        Target (child) row indices.
    n_nodes
        Total number of nodes (matrix dimension).

    Returns
    -------
    A ``(n_nodes, n_nodes)`` CSR matrix with 1.0 at each edge.
    """
    import numpy as np
    import scipy.sparse as sp

    data = np.ones(len(src), dtype=np.float32)
    return sp.csr_matrix((data, (src, tgt)), shape=(n_nodes, n_nodes))


def _compute_lineages(adj: sp.csr_matrix) -> tuple[int, NDArray[np.int64]]:
    """Compute lineage IDs as weakly connected components of the tracking graph.

    Parameters
    ----------
    adj
        Sparse adjacency matrix.

    Returns
    -------
    A tuple of ``(n_components, labels)`` where ``labels[i]`` is the lineage
    ID for observation *i*.
    """
    import numpy as np
    from scipy.sparse.csgraph import connected_components

    n_components, labels = connected_components(adj, directed=False)
    sizes = np.bincount(labels)

    console.print("\n[bold]Lineage computation[/bold]")
    console.print(f"  Connected components (lineages): {n_components}")
    console.print(f"  Largest lineage: {sizes.max()} cells")
    console.print(f"  Singleton lineages: {int((sizes == 1).sum())}")

    return n_components, labels.astype(np.int64)


def _compute_tracklet_ids(obs: pd.DataFrame) -> tuple[NDArray[np.int64], int]:
    """Map (fov_name, track_id) pairs to globally unique integer tracklet IDs.

    Parameters
    ----------
    obs
        Observation DataFrame with columns ``fov_name`` and ``track_id``.

    Returns
    -------
    A tuple of ``(tracklet_ids, n_unique)`` with a dense integer array of
    tracklet assignments and the number of unique tracklets.
    """
    import numpy as np
    import pandas as pd

    composite_key = obs["fov_name"].astype(str) + ":" + obs["track_id"].astype(str)
    codes, _ = pd.factorize(composite_key, sort=True)
    tracklet_ids = codes.astype(np.int64)
    n_unique = int(tracklet_ids.max() + 1)

    console.print(f"  Unique tracklets: {n_unique}")
    return tracklet_ids, n_unique


def _build_geff_metadata(obs: pd.DataFrame) -> Any:
    """Construct the GEFF metadata object for the tracking graph.

    Parameters
    ----------
    obs
        Observation DataFrame (used only for schema, not data).

    Returns
    -------
    A ``GeffMetadata`` instance describing the graph schema.
    """
    from geff_spec import Axis, GeffMetadata, PropMetadata

    node_prop_specs = {
        "t": ("int64", "frame"),
        "x": ("int64", "pixel"),
        "y": ("int64", "pixel"),
        "track_id": ("int64", None),
        "lineage_id": ("int64", None),
        "fov_name": ("str", None),
        "cell_id": ("int64", None),
        "infection_status": ("str", None),
    }

    return GeffMetadata(
        geff_version="1.1",
        directed=True,
        axes=[
            Axis(name="t", type="time", unit="frame"),
            Axis(name="x", type="space", unit="pixel"),
            Axis(name="y", type="space", unit="pixel"),
        ],
        track_node_props={"tracklet": "track_id", "lineage": "lineage_id"},
        node_props_metadata={
            name: PropMetadata(identifier=name, dtype=dtype, **({"unit": unit} if unit else {}))
            for name, (dtype, unit) in node_prop_specs.items()
        },
        edge_props_metadata={},
        extra={},
    )


def _build_node_props(
    obs: pd.DataFrame,
    *,
    tracklet_ids: NDArray[np.int64],
    lineage_labels: NDArray[np.int64],
) -> dict[str, dict[str, Any]]:
    """Assemble the node property arrays for GEFF output.

    Parameters
    ----------
    obs
        Observation DataFrame.
    tracklet_ids
        Globally unique tracklet IDs per observation.
    lineage_labels
        Lineage (connected component) IDs per observation.

    Returns
    -------
    A dict mapping property names to ``{"values": array, "missing": None}``.
    """
    import numpy as np

    int_cols = {"t": "t", "x": "x", "y": "y", "cell_id": "id"}
    str_cols = {"fov_name": "fov_name", "infection_status": "infection_status"}

    props: dict[str, dict[str, Any]] = {}
    for prop_name, col_name in int_cols.items():
        props[prop_name] = {"values": obs[col_name].to_numpy().astype(np.int64), "missing": None}
    for prop_name, col_name in str_cols.items():
        # np.array() infers a fixed-width Unicode dtype (e.g. <U10) which
        # GEFF's write_arrays requires; .to_numpy() yields dtype=object.
        props[prop_name] = {"values": np.array([str(v) for v in obs[col_name]]), "missing": None}

    props["track_id"] = {"values": tracklet_ids, "missing": None}
    props["lineage_id"] = {"values": lineage_labels, "missing": None}

    return props


def _write_sharded(output_path: Path, adata: ad.AnnData) -> None:
    """Write AnnData to zarr v3 with sharding (handles sparse obsp).

    Adapted from ``scripts/convert_anndata_to_zarrv3.py``.

    Parameters
    ----------
    output_path
        Destination zarr store path.
    adata
        AnnData to write.
    """
    from collections.abc import Mapping

    import anndata as ad
    import zarr

    shard_exponent = 18
    chunk_to_shard_ratio = 4

    def callback(
        func: ad.experimental.Write,
        g: zarr.Group,
        k: str,
        elem: ad.typing.RWAble,
        dataset_kwargs: Mapping[str, Any],
        iospec: ad.experimental.IOSpec,
    ) -> None:
        if iospec.encoding_type in {"array"}:
            dataset_kwargs = {
                "shards": tuple(int(2 ** (shard_exponent / len(elem.shape))) for _ in elem.shape),
                **dataset_kwargs,
            }
            dataset_kwargs["chunks"] = tuple(i // chunk_to_shard_ratio for i in dataset_kwargs["shards"])
        elif iospec.encoding_type in {"csr_matrix", "csc_matrix"}:
            dataset_kwargs = {"shards": (2**16,), "chunks": (2**8,), **dataset_kwargs}
        func(g, k, elem, dataset_kwargs=dataset_kwargs)

    group = zarr.open_group(output_path, mode="w", zarr_version=3)
    ad.experimental.write_dispatched(group, "/", adata, callback=callback)
    zarr.consolidate_metadata(output_path)


def _write_geff(
    geff_path: Path,
    *,
    n_nodes: int,
    src: NDArray[np.int64],
    tgt: NDArray[np.int64],
    node_props: dict[str, dict[str, Any]],
    metadata: Any,
    zarr_format: int,
) -> None:
    """Write the tracking graph in GEFF zarr format.

    Parameters
    ----------
    geff_path
        Output path for the ``.geff.zarr`` store.
    n_nodes
        Total number of graph nodes.
    src
        Source (parent) row indices.
    tgt
        Target (child) row indices.
    node_props
        Node property dict as expected by ``geff.core_io.write_arrays``.
    metadata
        ``GeffMetadata`` instance.
    zarr_format
        Zarr format version (2 or 3).
    """
    import numpy as np
    from geff.core_io import write_arrays

    node_ids = np.arange(n_nodes, dtype=np.int64)
    edge_ids = np.column_stack([src, tgt]).astype(np.int64) if len(src) > 0 else np.empty((0, 2), dtype=np.int64)

    console.print(f"\n[bold]Writing GEFF to[/bold] {geff_path}")
    write_arrays(
        geff_store=str(geff_path),
        node_ids=node_ids,
        node_props=node_props,
        edge_ids=edge_ids,
        edge_props={},
        metadata=metadata,
        zarr_format=zarr_format,
        overwrite=True,
    )
    console.print(f"  [green]Written:[/green] {n_nodes:,} nodes, {len(src):,} edges")


def _augment_and_write_adata(
    adata: ad.AnnData,
    *,
    lineage_labels: NDArray[np.int64],
    adj: sp.csr_matrix,
    output_path: Path,
) -> None:
    """Add tracking adjacency and lineage IDs to AnnData and write to zarr.

    Parameters
    ----------
    adata
        Source AnnData to augment (modified in place).
    lineage_labels
        Lineage ID for each observation.
    adj
        Sparse tracking adjacency matrix.
    output_path
        Destination zarr store path.
    """
    n_components = int(lineage_labels.max() + 1)

    adata.obs["lineage_id"] = lineage_labels
    adata.obsp["tracking"] = adj

    console.print("\n[bold]Augmented AnnData[/bold]")
    console.print(f"  Added obs['lineage_id']: {n_components} unique values")
    console.print(f"  Added obsp['tracking']: {adj.shape}, nnz={adj.nnz}")

    console.print(f"\n[bold]Writing augmented AnnData (zarr v3 + sharding) to[/bold] {output_path}")
    _write_sharded(output_path, adata)
    console.print(f"  [green]Written:[/green] {output_path}")


def _verify_roundtrip(
    *,
    geff_path: Path,
    augmented_path: Path,
    expected_nodes: int,
    expected_edges: int,
) -> None:
    """Re-read both outputs and verify counts match expectations.

    Parameters
    ----------
    geff_path
        Path to the GEFF zarr store.
    augmented_path
        Path to the augmented AnnData zarr store.
    expected_nodes
        Expected number of GEFF nodes.
    expected_edges
        Expected number of GEFF edges / obsp nnz.

    Raises
    ------
    AssertionError
        If any round-trip check fails.
    """
    import anndata as ad
    from geff.core_io import read_to_memory

    console.print("\n[bold]Verification[/bold]")

    geff_data = read_to_memory(str(geff_path))
    console.print(f"  GEFF nodes: {len(geff_data['node_ids']):,}")
    console.print(f"  GEFF edges: {len(geff_data['edge_ids']):,}")
    console.print(f"  GEFF node props: {list(geff_data['node_props'].keys())}")
    console.print(f"  GEFF directed: {geff_data['metadata'].directed}")
    console.print(f"  GEFF track_node_props: {geff_data['metadata'].track_node_props}")

    adata_check = ad.io.read_zarr(augmented_path)
    console.print(f"  AnnData shape: {adata_check.shape}")
    console.print(f"  AnnData obsp keys: {list(adata_check.obsp.keys())}")
    console.print(f"  AnnData obsp['tracking'] nnz: {adata_check.obsp['tracking'].nnz}")

    assert len(geff_data["node_ids"]) == expected_nodes
    assert len(geff_data["edge_ids"]) == expected_edges
    assert "lineage_id" in adata_check.obs.columns
    assert "tracking" in adata_check.obsp
    assert adata_check.obsp["tracking"].nnz == expected_edges

    console.print("\n[bold green]Done![/bold green]")


# ---------------------------------------------------------------------------
# CLI entry point
# ---------------------------------------------------------------------------


@app.command()
def main(
    input_zarr: Path = typer.Argument(DEFAULT_INPUT, help="Path to source AnnData zarr store."),
    output_dir: Path = typer.Argument(DEFAULT_OUTPUT, help="Output directory for GEFF and augmented AnnData."),
    *,
    zarr_format: int = typer.Option(2, help="Zarr format for GEFF output (2 or 3)."),
) -> None:
    """Convert cell tracking data to GEFF and augment AnnData with obsp."""
    _configure_zarr()

    input_zarr = input_zarr.resolve()
    output_dir = output_dir.resolve()
    output_dir.mkdir(parents=True, exist_ok=True)

    # 1. Read source AnnData (eager -- small dataset)
    adata = _read_adata(input_zarr)

    # 2. Build directed edge list from parent_id column
    src, tgt, _n_roots, _n_dangling = _build_edge_list(adata.obs)

    # 3. Build sparse adjacency matrix
    adj = _build_adjacency(src, tgt, n_nodes=adata.n_obs)

    # 4. Compute lineage IDs via connected components
    _n_components, lineage_labels = _compute_lineages(adj)

    # 5. Compute globally unique tracklet IDs
    tracklet_ids, _n_tracklets = _compute_tracklet_ids(adata.obs)

    # 6. Write GEFF graph
    node_props = _build_node_props(adata.obs, tracklet_ids=tracklet_ids, lineage_labels=lineage_labels)
    metadata = _build_geff_metadata(adata.obs)
    geff_path = output_dir / "tracking.geff.zarr"
    _write_geff(
        geff_path,
        n_nodes=adata.n_obs,
        src=src,
        tgt=tgt,
        node_props=node_props,
        metadata=metadata,
        zarr_format=zarr_format,
    )

    # 7. Augment AnnData with obsp["tracking"] and obs["lineage_id"]
    augmented_path = output_dir / "annotations_tracking.zarr"
    _augment_and_write_adata(adata, lineage_labels=lineage_labels, adj=adj, output_path=augmented_path)

    # 8. Verify round-trip
    _verify_roundtrip(
        geff_path=geff_path,
        augmented_path=augmented_path,
        expected_nodes=adata.n_obs,
        expected_edges=len(src),
    )


if __name__ == "__main__":
    app()
