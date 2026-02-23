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

**Status**: Steps 1-13 complete. Step 14 (channel controls UI) next.
**Tests**: 34 passed in 170s (9 existing + 25 new imviz tests).
**Branch**: `feature/imviz`
**Date**: 2026-02-22

### Steps 1-6: Foundation (DONE)

1. Migrated `scripts/idetik_view.py` to typer + rich
2. Migrated `scripts/neuroglancer_view.py` to typer + rich + PEP 723 (standalone `uv run --script`)
3. Added `get_fov_dataframe(plate_path)` to `_metadata.py` — per-FOV DataFrame with TCZYX shape + voxel scale
4. Rewrote `imviz/_serve.py` with DuckDB FOV table + `mount_duckdb_endpoints` from `vz._duckdb`
5. uv environment management — `neuroglancer` dependency group, setup scripts rewritten
6. Lint + format pass

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
uv run pytest tests/ -v    # 34 passed in 170s (9 existing + 25 new)
```

### Step 11: Fix charts for constant-value columns (DONE)

Browser testing revealed that the Charts panel showed "No data" for numeric columns (T, C, Z, Y, X, z_um, y_um, x_um) even though the Data Table displayed them correctly. Root cause: all FOVs in the plate have identical values for these columns (e.g. T=9, C=3, Z=126), so `min === max` and the Histogram component returned `null` (no meaningful histogram to draw).

- `Histogram.tsx`: Added early return when `stats.min === stats.max && stats.count > 0` — shows the constant value with row count (e.g. `"126 (268 rows)"`) instead of "No data". Styled as white text on dark blue badge for readability.

### Step 12: Auto-contrast for idetik image viewer (DONE)

Browser testing revealed images were saturated white — channel windows defaulted to `[0, 65535]` (full 16-bit range). idetik renders with the window from OME metadata, so we need data-driven contrast.

Adapted the sampling approach from `neuroglancer_view.py`:

- `_metadata.py`: Added `_sample_contrast_range(data, channel_idx, *, sample_fraction=0.1)` — samples 10% of voxels via strided indexing (cbrt-based stride), returns 1st/99th percentile intensity range
- `_metadata.py`: Added `_apply_auto_contrast(position, channels)` — updates channel windows in-place; skips channels that already have non-default windows
- `get_plate_metadata()`: calls `_apply_auto_contrast(first_pos, result["channels"])` after reading OMERO metadata

Verified auto-contrast values: DAPI [0, 373], TXR [103, 382], BF [13252, 16717] — matches neuroglancer_view.py ranges.

Added 2 new tests: `test_auto_contrast_windows` (metadata level) and `test_metadata_auto_contrast` (API endpoint level).

### Step 13: Browser verification (DONE — partial)

- Auto-contrast fix confirmed: swapped priority so `plate_channels` (server-computed) is used before `omeroChannels` (raw zarr store defaults)
- Charts constant-value badges now visible (white on dark blue)
- Images display with proper contrast (not saturated white)
- Channel controls (visibility toggles, contrast sliders) are **missing** — next step

---

## What remains

### Step 14: Channel controls UI

Add per-channel visibility toggles, contrast sliders, and color indicators to the image viewer panel.

**Existing infrastructure** (already in place):

| Component | File | What it provides |
|---|---|---|
| `MultiChannelLayers` | `frontend/src/lib/MultiChannelLayers.ts` | `setChannelProps()`, `channelProps` getter, change callbacks |
| `ChunkedImageLayer` | `@idetik/core` | Per-layer `setChannelProps([props])` for runtime contrast/color updates |
| `ViewerContext` | `frontend/src/components/viewer/ViewerContext.tsx` | State + actions for layers, Z/T sliders |
| `ViewerControls` | `frontend/src/components/viewer/ViewerControls.tsx` | T/Z/crop sliders (model for channel sliders) |
| `metadata.plate_channels` | Server `/data/metadata.json` | `label`, `color`, `window.{start, end, min, max}` per channel |

**What needs to be added:**

1. **Channel state** in `ViewerState` — array of `{ visible: boolean, color: string, contrastLimits: [number, number] }` per channel
2. **`ChannelControls` component** — for each channel:
   - Color swatch (from `plate_channels[i].color`)
   - Channel label (e.g. "DAPI", "TXR", "BF")
   - Visibility toggle (eye icon)
   - Contrast range slider (dual-thumb, range = `[window.min, window.max]`)
3. **ViewerActions** — `setChannelVisibility(index, visible)`, `setChannelContrast(index, [lo, hi])`
4. **Wire to idetik** — on state change, call `multiChannelRef.current.setChannelProps(newProps)` to update layers at runtime; toggle visibility by setting layer opacity or removing/re-adding layer
5. **Placement** — below the existing T/Z/crop sliders in `ViewerControls`, or as a collapsible section

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

### Steps 7-12 (done)

| File | Summary |
|------|---------|
| `frontend/src/dashboard/DashboardShell.tsx` | `hasEmbeddings` detection, passed to DockviewShell |
| `frontend/src/components/layout/DockviewShell.tsx` | Scatter panel hidden when `!hasEmbeddings`; table-first layout |
| `frontend/src/components/crops/SingleCropViewer.tsx` | Dynamic `store_index` + OME version; prefer server auto-contrast over raw zarr windows |
| `frontend/src/components/charts/Histogram.tsx` | Constant-value columns: white-on-blue badge + muted row count |
| `frontend/src/types.ts` | `plate_stores` added to `Metadata` interface |
| `src/nd_embedding_atlas/imviz/_app.py` | CLI: `zarr_paths: list[Path]`, per-store metadata summary |
| `src/nd_embedding_atlas/imviz/_metadata.py` | `detect_ome_version()`, `get_multi_store_fov_dataframe()`, auto-contrast sampling, stem disambiguation |
| `src/nd_embedding_atlas/imviz/_serve.py` | Multi-store `/plate_{i}/` mounts, `store_index` in cell API, `plate_stores` in metadata, fixed `fov_col` |
| `src/nd_embedding_atlas/imviz/__init__.py` | Exports `detect_ome_version`, `get_multi_store_fov_dataframe` |
| `scripts/idetik_view.py` | Multi-path CLI, per-store OME version display |
| `tests/test_imviz.py` | 34 integration tests (metadata, dataframes, auto-contrast, FastAPI endpoints) |
| `pyproject.toml` | `httpx>=0.27` added to `test` dependency group |

## Test data

- **Zarr v2**: `/hpc/projects/intracellular_dashboard/virtual_stain_ft_infected/2026_01_29_A549_H2B_CAAX_DAPI_DENV_ZIKV/0-convert/convert.zarr`
- **Zarr v3**: `/hpc/projects/intracellular_dashboard/virtual_stain_ft_infected/2026_01_29_A549_H2B_CAAX_DAPI_DENV_ZIKV/0-convert_zarrv3/convert.zarr`

## Test against neuroglancer if needed
Use neuroglancer_view script with above data if you need to check metadata or intensity ranges in the data.