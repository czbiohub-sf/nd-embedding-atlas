# Plan: imviz FOV table + idetik integration

# Goal:
Browse 5D image FOVs via local or a remote web server. This is a stripped down version of nd-embedding-viewer that does not have the embedding point cloud, but includes an FOV table with key metadata and integrated idetik viewer for performant exploration of 5D FOVs compliant with OME-ngff 0.4 and OME-ngff 0.5 metadata.

Examples of concrete use cases are:
1. Compare the speed of visualization with zarr v2 and zarr v3 stores as we adopt sharded zarr v3 stores with small chunks.
2. Visualize intermediate results of image processing pipeline implemented with biahub that may contain both zarr v2 and zarr v3 stores.
3. Quickly review plate-level images after converting raw data into zarr v2 or zarr v3 stores to decide how the experiment worked.

We use neuroglancer as a baseline implementation and are developing imviz built on top of nd-embedding-atlas and idetik. neuroglancer can read both zarr v2 and zarr v3 stores, and iohub can parse corresponding ome-ngff 0.4 and ome-ngff 0.5 metadata.

nd-embedding-atlas, idetik, and iohub need to be installed from corresponding repositories main branches to develop this feature.

The paths to github repositories are:
* nd-embedding-atlas: https://github.com/czbiohub-sf/nd-embedding-atlas
* idetik: https://github.com/chanzuckerberg/idetik
* iohub: https://github.com/czbiohub-sf/iohub

---

## Environment management

Both viewer scripts now use **uv** exclusively (no conda).

### neuroglancer_view.py — fully standalone

All dependencies (neuroglancer, iohub, numpy, typer, rich) are on PyPI. The script
uses PEP 723 inline metadata so `uv` resolves deps automatically:

```bash
uv run scripts/neuroglancer_view.py /path/to/data.zarr          # just works
uv run scripts/neuroglancer_view.py /path/to/data.zarr --dry-run
```

No setup script, no venv creation, no `conda`. First run takes ~30s to resolve;
subsequent runs are cached.

Alternatively, for a persistent venv:
```bash
source scripts/setup-neuroglancer-iohub.sh   # creates uv venv + installs deps
python scripts/neuroglancer_view.py /path/to/data.zarr
```

### idetik_view.py — requires project venv

Depends on `nd-embedding-atlas` which is not on PyPI, so it cannot use PEP 723
standalone mode. Run from the project venv:

```bash
uv sync                                                 # install project
uv run imviz /path/to/data.zarr                          # CLI entry point
uv run python scripts/idetik_view.py /path/to/data.zarr  # script
```

Or create a separate venv:
```bash
source scripts/setup-idetik-iohub.sh   # creates uv venv + editable install
imviz /path/to/data.zarr
```

### pyproject.toml dependency group

A `neuroglancer` dependency group is available for users who want neuroglancer
in the project venv:

```bash
uv sync --group neuroglancer
```

---

## What was done

**Status**: Steps 1-5 complete. Steps 6-7 need frontend/integration testing.
**Branch**: `feature/imviz`
**Date**: 2026-02-22


### Step 1: Migrate `scripts/idetik_view.py` to typer + rich (DONE)

- Replaced `click` with `typer` + `rich.Console` + `Annotated` type hints
- Uses `#!/usr/bin/env python` (needs project venv since `nd-embedding-atlas` is not on PyPI)
- Removed the `check_environment()` pattern
- Run via `uv run python scripts/idetik_view.py` or `uv run imviz`

### Step 2: Migrate `scripts/neuroglancer_view.py` to typer + rich + PEP 723 (DONE)

- Replaced `click` with `typer` + `rich.Console` + `Annotated` type hints
- Added PEP 723 inline script metadata with all PyPI deps (neuroglancer, iohub, numpy, typer, rich)
- Added `#!/usr/bin/env -S uv run --script` shebang — fully standalone, no setup needed
- Removed `check_environment()` pattern and all conda references (uv handles deps)
- Fixed lint: `strict=True` in `zip()`, specific exception types, `msg` variable for `raise`
- **Tested**: `uv run scripts/neuroglancer_view.py` dry-run passes with both zarr v2 and v3

### Step 3: Add per-position metadata to `_metadata.py` (DONE)

New function `get_fov_dataframe(plate_path)` returns a DataFrame with columns:

| Column | Type | Description |
|--------|------|-------------|
| `__row_index__` | int | Row index for DuckDB/Mosaic |
| `position` | str | Position key (e.g. `0/2/000000`) |
| `T` | int | Number of timepoints |
| `C` | int | Number of channels |
| `Z` | int | Number of Z slices |
| `Y` | int | Height in pixels |
| `X` | int | Width in pixels |
| `z_um` | float | Z voxel scale in micrometers |
| `y_um` | float | Y voxel scale in micrometers |
| `x_um` | float | X voxel scale in micrometers |

Helper `_position_row()` handles both 4D (CZYX) and 5D (TCZYX) shapes.

Exported from `imviz/__init__.py`.

### Step 4: Rewrite `imviz/_serve.py` with DuckDB FOV table (DONE)

**Removed:**
- `_build_shim_parquet()` — no more fake x/y scatter coordinates
- `_auto_select_script` — the React fiber tree walking hack
- Custom `index_page()` route with patched HTML
- Inline DuckDB + ad-hoc Arrow IPC serialization for `/data/query`

**Added:**
- Real FOV table loaded into DuckDB via `get_fov_dataframe()` + `CREATE TABLE obs_base`
- `mount_duckdb_endpoints(app, con)` from `vz._duckdb` — reuses the Mosaic query protocol (handles `RecordBatchReader` for duckdb >= 1.4)
- `/data/dataset.parquet` endpoint that queries DuckDB with parquet cache
- `/api/cell/{row_index}` queries DuckDB: `SELECT position FROM dataset WHERE __row_index__ = ?`
- `StaticFiles(html=True)` for SPA routing (like `vz/_serve.py`)

**Metadata changes:**
- `obs_columns` now set to `["position", "T", "C", "Z", "Y", "X", "z_um", "y_um", "x_um"]`
- `projection` uses `X`/`Y` columns (dummy — scatter will show a grid of positions)
- `plate`, `plate_channels`, `plate_pixel_scale`, `spatial` unchanged

### Step 5: uv environment management (DONE)

- Added `neuroglancer` dependency group to `pyproject.toml` (`neuroglancer>=2.40`, `numpy`)
- `neuroglancer_view.py`: PEP 723 `uv run --script` — fully standalone, no conda
- `idetik_view.py`: `#!/usr/bin/env python` — runs from project venv (`uv run python scripts/...`)
- Rewrote `setup-idetik-iohub.sh`: uv-only, creates venv + editable install
- Rewrote `setup-neuroglancer-iohub.sh`: uv-only, creates venv + installs neuroglancer
- `uv lock` updated to include neuroglancer in lockfile

### Step 6: Lint + format (DONE)

- `uvx ruff check` — all pass
- `uvx ruff format` — all formatted

---

## Test results

### neuroglancer_view.py (via `uv run scripts/neuroglancer_view.py`)

| Dataset | Zarr version | Result |
|---------|-------------|--------|
| `0-convert/convert.zarr` | v2 | PASS — 134 positions, 3 channels, auto-contrast computed |
| `0-convert_zarrv3/convert.zarr` | v3 | PASS — identical metadata, identical contrast ranges |
| v3 + `--position 0/3/000000 --channels "DAPI,BF"` | v3 | PASS — position/channel filters work |

### idetik_view.py (via `uv run python scripts/idetik_view.py`)

| Dataset | Zarr version | Result |
|---------|-------------|--------|
| `0-convert/convert.zarr` | v2 | PASS — dry-run shows 134 positions |
| `0-convert_zarrv3/convert.zarr` | v3 | PASS — dry-run shows 134 positions |

### get_fov_dataframe()

```
   __row_index__    position  T  C    Z     Y     X  z_um    y_um    x_um
0              0  0/2/000000  9  3  126  2048  2048   0.2  0.1032  0.1032
1              1  0/2/000001  9  3  126  2048  2048   0.2  0.1032  0.1032
...
Total positions: 134
```

---

## What remains (for your colleague)

### Step 7: Full serve test — FOV table + idetik viewer

Run the full server (not dry-run) and verify the frontend:

```bash
uv run imviz /hpc/projects/intracellular_dashboard/virtual_stain_ft_infected/2026_01_29_A549_H2B_CAAX_DAPI_DENV_ZIKV/0-convert_zarrv3/convert.zarr
```

**Expected behavior:**
1. Open `http://localhost:5055` in a browser
2. The **table panel** should show all 134 FOV rows with columns: position, T, C, Z, Y, X, z_um, y_um, x_um
3. The **scatter panel** will show a grid of points (X vs Y — all positions have the same pixel dimensions, so they'll overlap). This is expected and not useful in this mode.
4. Click a row in the table -> the **image viewer panel** should load that FOV via idetik

**Possible issues to watch for:**
- The scatter panel showing "No data" or crashing — the projection columns `X`/`Y` are integers (pixel dimensions), not spatial coordinates. If the frontend requires float columns for scatter, may need to cast them or add dummy float columns.
- The image viewer not loading — verify the `/api/cell/{row_index}` endpoint returns correct `fov_name` by hitting it directly: `curl http://localhost:5055/api/cell/0`
- Mosaic not booting — check browser console for errors from `/data/query`. The DuckDB `dataset` VIEW now has real columns; Mosaic may issue queries that reference old column names.

### Step 8: Consider hiding the scatter panel

Since the scatter is meaningless for pure FOV browsing (no embeddings), consider either:
- **Option A**: Frontend change to hide scatter when `obsm` is empty (check `metadata.obsm === {}`)
- **Option B**: Set `projection` to `null` in metadata and handle gracefully
- **Option C**: Leave as-is — the table is the primary interface

---

## Files modified

| File | Summary |
|------|---------|
| `pyproject.toml` | Added `neuroglancer` dependency group |
| `scripts/idetik_view.py` | click -> typer + rich, runs from project venv |
| `scripts/neuroglancer_view.py` | click -> typer + rich + PEP 723, standalone `uv run --script` |
| `scripts/setup-idetik-iohub.sh` | Rewritten: uv-only, no conda |
| `scripts/setup-neuroglancer-iohub.sh` | Rewritten: uv-only, no conda |
| `src/nd_embedding_atlas/imviz/__init__.py` | Added `get_fov_dataframe` export |
| `src/nd_embedding_atlas/imviz/_metadata.py` | Added `get_fov_dataframe()` + `_position_row()` |
| `src/nd_embedding_atlas/imviz/_serve.py` | Full rewrite: DuckDB FOV table, mount_duckdb_endpoints, removed shim/hack |

## Test data

- **Zarr v2**: `/hpc/projects/intracellular_dashboard/virtual_stain_ft_infected/2026_01_29_A549_H2B_CAAX_DAPI_DENV_ZIKV/0-convert/convert.zarr`
- **Zarr v3**: `/hpc/projects/intracellular_dashboard/virtual_stain_ft_infected/2026_01_29_A549_H2B_CAAX_DAPI_DENV_ZIKV/0-convert_zarrv3/convert.zarr`
