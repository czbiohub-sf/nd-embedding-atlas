# Plan: imviz FOV table + idetik integration

# Goal:
Browse 5D image FOVs via local or a remote web server. This is a stripped down version of nd-embedding-viewer that does not have the embedding point cloud, but includes an FOV table with key metadata and integrated idetik viewer for performant exploration of 5D FOVs compliant with OME-ngff 0.4 and OME-ngff 0.5 metadata.

Examples of concrete use cases are:
1. Compare the speed of visualization with zarr v2 and zarr v3 stores as we adopt sharded zarr v3 stores with small chunks.
2. Visualize intermediate results of image processing pipeline implemented with biahub that may contain both zarr v2 and zarr v3 stores.
3. Quickly review plate-level images after converting raw data into zarr v2 or zarr v3 stores to decide how the experiment worked.

We use neuroglancer as a baseline implementation and are developing imviz to replace it. imviz will build on top of nd-embedding-atlas and idetik. neuroglancer can read both zarr v2 and zarr v3 stores, and iohub can parse corresponding ome-ngff 0.4 and ome-ngff 0.5 metadata.

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
standalone mode. Accepts one or more zarr store paths. Run from the project venv:

```bash
uv sync                                                            # install project
uv run imviz /path/to/v2.zarr /path/to/v3.zarr                     # multi-store
uv run imviz /path/to/data.zarr                                     # single store
uv run imviz /path/to/data.zarr --dry-run                           # metadata only
uv run python scripts/idetik_view.py /path/to/v2.zarr /path/to/v3.zarr  # script
```

Or create a separate venv:
```bash
source scripts/setup-idetik-iohub.sh   # creates uv venv + editable install
imviz /path/to/v2.zarr /path/to/v3.zarr
```

### pyproject.toml dependency group

A `neuroglancer` dependency group is available for users who want neuroglancer
in the project venv:

```bash
uv sync --group neuroglancer
```

---

## What was done

**Status**: Steps 1-10 complete. Step 11 (browser integration test) pending.
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

### Step 7: Hide scatter panel when no embeddings exist (DONE)

Scatter is meaningless for pure FOV browsing (`obsm: {}`). Hidden entirely using
the existing `hasPlate` conditional pattern in `DockviewShell.tsx`.

- `DashboardShell.tsx`: added `hasEmbeddings = Object.keys(metadata.obsm ?? {}).length > 0`, passed to `DockviewShell`
- `DockviewShell.tsx`: added `hasEmbeddings` prop; `loadDefaultLayout()` skips scatter when `!hasEmbeddings`; table becomes first panel; sidebar references table instead of scatter; `expectedPanels` excludes scatter; callback deps updated

Layout when `hasEmbeddings=false, hasPlate=true`:
```
┌──────────────┬──────────────┐
│  Data Table   │ Image Viewer │
│               ├──────────────┤
│               │    Charts    │
└──────────────┴──────────────┘
```

### Step 8: Accept multiple zarr store paths in CLI and server (DONE)

Both zarr v2 and v3 stores shown in a single FOV table with `dataset`, `store_index`, and `ome_version` columns.

**CLI (`_app.py` + `scripts/idetik_view.py`):**
- `zarr_paths: list[Path]` positional argument (1+); validates all paths; prints per-store metadata with detected OME-NGFF version

**Metadata (`_metadata.py`):**
- `detect_ome_version(plate_path)` → `"0.4"` (v2) or `"0.5"` (v3) via `zarr.json` presence check
- `get_multi_store_fov_dataframe(plate_paths)` → concatenated DataFrame with `dataset` (path stem, parent-disambiguated when stems collide), `store_index`, `ome_version` columns; globally unique `__row_index__`
- Both exported from `imviz/__init__.py`

**Server (`_serve.py`):**
- `create_app()` / `serve()` accept `plate_paths: str | Path | list[str | Path]` (backward-compatible)
- Each store mounted at `/plate_{i}/` (e.g. `/plate_0/`, `/plate_1/`)
- First store's metadata used for channels/scale
- `obs_column_names` includes `dataset`, `ome_version`
- `/api/cell/{row_index}` returns `store_index` in response
- `/data/metadata.json` includes `plate_stores: [{mount, name, ome_version}, ...]`
- Fixed `spatial.fov_col` from `"fov_name"` (wrong) to `"position"` (actual column name)

### Step 9: Fix idetik zarr v2/v3 version detection in frontend (DONE)

Previously hardcoded to `version: "0.5"`. idetik supports both `"0.4"` and `"0.5"`.

- `frontend/src/types.ts`: added `plate_stores` to `Metadata` interface
- `SingleCropViewer.tsx`: source URL uses `store_index` (`` /plate_${storeIndex}/${fov_name} ``); OME version looked up from `metadata.plate_stores[storeIndex].ome_version`; falls back to `"/plate"` mount + `"0.5"` when `plate_stores` absent (backward-compatible with main ndea viewer)

### Step 10: Integration tests (DONE)

Added `tests/test_imviz.py` — 32 pytest tests covering the full imviz stack:

| Test class | # | Coverage |
|---|---|---|
| `test_detect_ome_version_*` | 2 | v2 → `"0.4"`, v3 → `"0.5"` |
| `TestGetPlateMetadata` | 7 | plate type, positions (134), channels, 5D shape, pixel scale, v2/v3 parity |
| `TestGetFovDataframe` | 4 | row count, required columns, sequential index, v2/v3 parity |
| `TestGetMultiStoreFovDataframe` | 7 | combined count (268), extra columns, store_index, ome_version, global row index, stem disambiguation, single-store fallback |
| `TestCreateApp` | 9 | metadata endpoint (obsm empty, plate_stores), parquet, cell endpoint (store 0/1/404), health, embedding stubs, Mosaic SQL query (count=268) |
| `TestCreateAppSingleStore` | 3 | backward-compat: single-path metadata, cell endpoint, Mosaic count (134) |

Tests use `@requires_data` skip marker — auto-skipped in CI when HPC data mount is absent.

Added `httpx>=0.27` to `test` dependency group in `pyproject.toml` (required by Starlette TestClient).

**Test results:**
```
uv run pytest tests/ -v    # 41 passed in 79s (9 existing + 32 new)
```

---

## What remains

### Step 11: Browser integration test

Run the full server and verify the frontend in a browser:

```bash
uv run imviz \
  /hpc/projects/intracellular_dashboard/virtual_stain_ft_infected/2026_01_29_A549_H2B_CAAX_DAPI_DENV_ZIKV/0-convert/convert.zarr \
  /hpc/projects/intracellular_dashboard/virtual_stain_ft_infected/2026_01_29_A549_H2B_CAAX_DAPI_DENV_ZIKV/0-convert_zarrv3/convert.zarr
```

**Expected behavior:**
1. Open `http://localhost:5055` in a browser
2. **No scatter panel** — hidden because `obsm` is empty
3. **Table panel** shows 268 FOV rows (134 × 2 stores) with columns: dataset, position, T, C, Z, Y, X, z_um, y_um, x_um, ome_version
4. Click a v2 FOV row → idetik loads via `/plate_0/` with OME-NGFF 0.4
5. Click a v3 FOV row → idetik loads via `/plate_1/` with OME-NGFF 0.5

**Verify endpoints:**
- `curl http://localhost:5055/api/cell/0` → `{"fov_name": "...", "store_index": 0, ...}`
- `curl http://localhost:5055/api/cell/134` → `{"fov_name": "...", "store_index": 1, ...}`
- `curl http://localhost:5055/data/metadata.json` → `plate_stores` array present

---

## Files modified

### Steps 1-6 (done)

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

### Steps 7-10 (done)

| File | Summary |
|------|---------|
| `frontend/src/dashboard/DashboardShell.tsx` | `hasEmbeddings` detection, passed to DockviewShell |
| `frontend/src/components/layout/DockviewShell.tsx` | Scatter panel hidden when `!hasEmbeddings`; table-first layout |
| `frontend/src/components/crops/SingleCropViewer.tsx` | Dynamic `store_index` + OME version from `plate_stores` |
| `frontend/src/types.ts` | `plate_stores` added to `Metadata` interface |
| `src/nd_embedding_atlas/imviz/_app.py` | CLI: `zarr_paths: list[Path]`, per-store metadata summary |
| `src/nd_embedding_atlas/imviz/_metadata.py` | `detect_ome_version()`, `get_multi_store_fov_dataframe()`, stem disambiguation |
| `src/nd_embedding_atlas/imviz/_serve.py` | Multi-store `/plate_{i}/` mounts, `store_index` in cell API, `plate_stores` in metadata, fixed `fov_col` |
| `src/nd_embedding_atlas/imviz/__init__.py` | Exports `detect_ome_version`, `get_multi_store_fov_dataframe` |
| `scripts/idetik_view.py` | Multi-path CLI, per-store OME version display |
| `tests/test_imviz.py` | 32 integration tests (metadata, dataframes, FastAPI endpoints) |
| `pyproject.toml` | `httpx>=0.27` added to `test` dependency group |

## Test data

- **Zarr v2**: `/hpc/projects/intracellular_dashboard/virtual_stain_ft_infected/2026_01_29_A549_H2B_CAAX_DAPI_DENV_ZIKV/0-convert/convert.zarr`
- **Zarr v3**: `/hpc/projects/intracellular_dashboard/virtual_stain_ft_infected/2026_01_29_A549_H2B_CAAX_DAPI_DENV_ZIKV/0-convert_zarrv3/convert.zarr`

## Test against neuroglancer if needed
Use neuroglancer_view script with above data if you need to check metadata or intensity ranges in the data.