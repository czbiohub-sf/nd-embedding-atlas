# MuData Support — Implementation Plan

**Issue:** [#35 — Visualizing Multiple embedding types alongside images](https://github.com/czbiohub-sf/nd-embedding-atlas/issues/35)

---

## Dataset

**MuData:** `/hpc/mydata/sricharan.varra/data/cellanome-ndea/multimodal.zarr`

Prepared by `scripts/prepare_cellanome_mudata.py` (copies from `cellanome-test-2/`, adds embeddings + cell cycle).

| Modality | Shape | X | obsm | Key obs columns |
|---|---|---|---|---|
| `rna` | 14,056 × 18,144 | Log-normalized gene expression | `X_pca` (50d), `X_umap` (2d), `dinov2` (768d) | `phase`, `S_score`, `G2M_score`, `cage_crop_file_name`, `condition`, `lane` |
| `dinov2` | 14,056 × 768 | DINOv2 image embeddings | `X_pca` (50d), `X_phate` (2d), `X_umap` (2d) | `cage_crop_file_name`, `zarr_position`, `zarr_path`, `cage_global_x_um`, `cage_global_y_um` |

- Obs names: UUIDs, aligned between modalities (same 14,056 cells)
- Cell cycle: Tirosh et al. 2016 gene lists, computed via `sc.tl.score_genes_cell_cycle`
- All embeddings computed with `random_state=42`

**OME-Zarr plate:** TBD — needs a `plate_path` or `ome-zarr` config pointing to the Cellanome imaging data. The `zarr_position` and `zarr_path` columns in dinov2 obs contain the FOV references.

**Source data:**
- Original h5ad: `/hpc/projects/multimodal/datasets/20251203141914_P-05_R000414_FC_BH_120325_try4_Adherent_with_SRA_training_4lanes/anndata/seurat-bc3a-l_all.h5ad` (14,359 cells, 12,102 single-cell)
- Colleague's notebook: `https://github.com/czbiohub-sf/biohub_cellanome/blob/main/embedding_umap_Hela.ipynb` — computes PCA, scVI, CONCORD, DINOv2 UMAP, cell cycle, PLS cross-modal. Output at `/hpc/projects/data.science/hejin.huang/Cellanome/anndata2/single_cell_embedded.zarr` (permission denied — we recomputed independently).

---

## Current Architecture (AnnData)

```
CLI input (.zarr / .h5ad / .yaml)
  → AnnDataCollection (dict of DatasetEntry)
  → prepare_obs() → obs_df (pandas DataFrame)
  → EmbeddingStore (DuckDB: obs_base table + emb_* tables → dataset VIEW)
  → ViewerState (holds collection, store, spatial, plates)
  → FastAPI routes serve metadata, queries, embeddings, var columns
  → Frontend: Mosaic cross-filter, scatter, table, viewer
```

Key interfaces:
- `state.collection._concat` — lazy concatenated AnnData for var/X slicing
- `get_obs(collection)` — reads obs via `anndata.io.read_elem` (fast, targeted)
- `get_obsm(collection, key)` — reads one obsm array via `read_elem`
- `EmbeddingStore.register_embedding(obsm_key, coords)` — adds to DuckDB, rebuilds VIEW
- `/data/metadata.json` — reports obsm keys, obs columns, var count, plate info
- `/api/var-column` — materializes one var/X column into DuckDB on demand
- `/api/embeddings/{key}` — materializes one obsm into DuckDB on demand

---

## MuData Architecture

### Core Concept

MuData modalities are **same cells, different feature spaces**. Not different datasets (which are different cells from different experiments). This means:

- One `obs_base` table (shared obs, merged columns from all modalities)
- Per-modality embeddings (prefixed keys: `rna:X_umap`, `dinov2:X_pca`)
- Per-modality var/X access (scoped by modality)
- Cross-modality filtering (lasso in RNA UMAP filters the same cells in DINOv2 UMAP)

### DuckDB Layout

```
obs_base              merged obs from all modalities (14,056 rows)
                      columns: __row_index__, obs_name, phase, S_score, cage_crop_file_name, ...
                      (union of rna.obs + dinov2.obs columns, aligned on obs_names)

emb_rna_pca           rna X_pca (50 cols)
emb_rna_umap          rna X_umap (2 cols)
emb_dinov2_pca        dinov2 X_pca (50 cols)
emb_dinov2_umap       dinov2 X_umap (2 cols)
emb_dinov2_phate      dinov2 X_phate (2 cols)

dataset VIEW          obs_base LEFT JOIN all emb_* ON __row_index__
```

### Metadata Response

```json
{
  "modalities": ["rna", "dinov2"],
  "obsm": {
    "rna:X_pca":     {"prefix": "rna_pca",     "n_dims": 50, "loaded": true,  "modality": "rna"},
    "rna:X_umap":    {"prefix": "rna_umap",    "n_dims": 2,  "loaded": true,  "modality": "rna"},
    "dinov2:X_pca":  {"prefix": "dinov2_pca",  "n_dims": 50, "loaded": false, "modality": "dinov2"},
    "dinov2:X_umap": {"prefix": "dinov2_umap", "n_dims": 2,  "loaded": true,  "modality": "dinov2"},
    "dinov2:X_phate":{"prefix": "dinov2_phate","n_dims": 2,  "loaded": false, "modality": "dinov2"}
  },
  "var_count": {"rna": 18144, "dinov2": 768},
  "modality_obs_columns": {
    "rna": ["phase", "S_score", "G2M_score", "condition", "lane", ...],
    "dinov2": ["cage_crop_file_name", "zarr_position", ...]
  }
}
```

### Frontend UX

- **Embedding picker:** Grouped by modality — `rna · UMAP`, `rna · PCA`, `dinov2 · UMAP`, `dinov2 · PCA`, `dinov2 · PHATE`
- **Color by obs:** Shows columns from all modalities (merged obs). `phase` from RNA is always available regardless of which embedding is shown.
- **Color by var/X:** Scoped to active modality. When showing RNA UMAP, var search shows gene names. When showing DINOv2 UMAP, var search shows DINOv2 feature indices.
- **Cross-filter:** Lasso in any scatter panel filters the same cells across all panels (shared `__row_index__`). Two panels can show RNA UMAP and DINOv2 UMAP side-by-side, cross-filtered.
- **Image viewer:** Links through spatial columns (`cage_crop_file_name` → OME-Zarr path).

---

## Implementation Plan

### Phase 1: Backend — CLI + IO

**Files:** `cli/_app.py`, `cli/_mudata.py` (new), `io/_get.py`, `io/_project.py`

1. Detect MuData input (`.h5mu` file, or zarr with `mod/` group)
2. New `view_mudata()` entry point — reads MuData, extracts modalities
3. Extend `get_obs` to merge obs from all modalities (union of columns, aligned on shared obs_names)
4. Extend `get_obsm` to accept `modality:key` format (e.g. `get_obsm(source, "rna:X_umap")`)
5. Extend `list_obsm_keys` to return per-modality keys
6. YAML config support: `mudata: path/to/multimodal.zarr` alongside `ome-zarr:`

### Phase 2: Backend — State + Store

**Files:** `server/_app.py`, `server/_state.py`, `server/_store.py`

1. `ViewerState` gains `modalities: list[str]`, per-modality var access
2. `EmbeddingStore` handles prefixed keys (`rna:X_umap` → table `emb_rna_umap`, prefix `rna_umap`)
3. `obs_base` built from merged obs (all modalities)
4. VIEW rebuilt with modality-prefixed embedding columns

### Phase 3: Backend — Routes

**Files:** `routes/_data.py`, `routes/_var.py`, `routes/_embeddings.py`

1. Metadata endpoint returns `modalities`, per-modality obsm, per-modality var_count
2. `/api/var/names?modality=rna` — scoped var name search
3. `/api/var-column` takes `modality` param — slices from correct modality's X
4. `/api/embeddings/{mod:key}` — load from correct modality's obsm

### Phase 4: Frontend — Schemas + State

**Files:** `lib/schemas.ts`, `types.ts`, `dashboard/DashboardProvider.tsx`

1. `Metadata` type gains `modalities`, per-modality obsm/var typing
2. `DashboardContext` tracks active modality per panel
3. Obsm entries tagged with `modality` field

### Phase 5: Frontend — UI

**Files:** scatter components, `ColorSourcePicker.tsx`, `useEmbeddingLoader.ts`, `useVarColumn.ts`, `useVarSearch.ts`

1. Embedding picker grouped by modality
2. Var search scoped to active modality
3. `useVarColumn` passes modality to `/api/var-column`
4. Multi-panel: each panel can show a different modality's embedding, cross-filtered via shared `__row_index__`

---

## Key Design Decisions

1. **Modalities ≠ Datasets.** Modalities share cells (same obs_names). Datasets are independent cell populations. MuData modalities go into one `obs_base` table. Multi-dataset mode (`_dataset` column) is orthogonal and can coexist.

2. **Obsm key format: `modality:obsm_key`.** E.g. `rna:X_umap`. This namespaces embeddings without changing the EmbeddingStore interface — it just sees longer key strings.

3. **Merged obs.** All modality obs columns go into one `obs_base`. Column name collisions between modalities are resolved by prefixing: `rna:phase` vs `dinov2:phase` (if both exist). Shared columns (from MuData's top-level `.obs`) stay unprefixed.

4. **Var access scoped by modality.** `state.collection._concat` won't work for MuData — need per-modality AnnData access. The `_materialize_var_sync` function needs a modality parameter to know which X/var to slice.

5. **Backward compatible.** Single AnnData input still works exactly as before. MuData is an additional input type, not a replacement.

---

## Files to Touch

| File | Change |
|---|---|
| `cli/_app.py` | Detect MuData, route to `view_mudata()` |
| `cli/_mudata.py` | **New** — MuData entry point |
| `io/_get.py` | `get_obs_mudata`, `get_obsm_mudata`, `list_obsm_keys_mudata` |
| `io/_project.py` | Support `mudata:` key in YAML |
| `server/_app.py` | Build merged obs_df from MuData, pass modality info to state |
| `server/_state.py` | `ViewerState.modalities`, per-modality var access |
| `server/_store.py` | Handle `mod:key` embedding prefixes |
| `routes/_data.py` | Return modalities, per-modality metadata |
| `routes/_var.py` | Accept `modality` param, slice from correct mod |
| `routes/_embeddings.py` | Load from correct modality obsm |
| `frontend/src/lib/schemas.ts` | `modalities`, per-modality obsm typing |
| `frontend/src/types.ts` | Modality-aware types |
| `frontend/src/dashboard/DashboardProvider.tsx` | Track active modality |
| `frontend/src/scatter-gpu/hooks/useEmbeddingLoader.ts` | Modality-prefixed keys |
| `frontend/src/scatter-gpu/hooks/useVarSearch.ts` | Scoped by modality |
| `frontend/src/scatter-gpu/hooks/useVarColumn.ts` | Pass modality param |
| `frontend/src/components/scatter/ColorSourcePicker.tsx` | Modality-grouped UI |
