# Frontend API Contract

Every HTTP endpoint the frontend calls, with exact request/response shapes.
This is the contract that the Bun.serve backend (Phase 2) must implement.

The Vite dev proxy forwards `/api/*`, `/data/*`, and `/plate/*` to `http://localhost:5055`.

---

## Table of Contents

| # | Endpoint | Method | Section |
|---|----------|--------|---------|
| 1 | `/data/query` | POST | [Mosaic Query Protocol](#1-mosaic-query-protocol) |
| 2 | `/data/metadata.json` | GET | [Metadata](#2-metadata) |
| 3 | `/data/colormaps` | GET | [Colormaps](#3-colormaps) |
| 4 | `/data/categorical-palette` | GET | [Categorical Palette](#4-categorical-palette) |
| 5 | `/api/embeddings/{key}` | POST | [Load Embedding](#5-load-embedding) |
| 6 | `/api/embeddings/{key}/status` | GET | [Embedding Status](#6-embedding-status) |
| 7 | `/api/scatter-positions` | GET | [Scatter Positions (binary)](#7-scatter-positions) |
| 8 | `/api/scatter-categories` | GET | [Scatter Categories (binary)](#8-scatter-categories) |
| 9 | `/api/scatter-continuous-colors` | GET | [Scatter Continuous Colors (binary)](#9-scatter-continuous-colors) |
| 10 | `/api/scatter-selection` | POST/DELETE | [Scatter Selection](#10-scatter-selection) |
| 11 | `/api/obs/{row_index}` | GET | [Observation Info](#11-observation-info) |
| 12 | `/api/obs/{row_index}/detail` | GET | [Observation Detail](#12-observation-detail) |
| 13 | `/api/obs/batch` | GET | [Observation Batch](#13-observation-batch) |
| 14 | `/api/crop/{fov_name}` | POST | [Image Crop](#14-image-crop) |
| 15 | `/api/var/layers` | GET | [Var Layers](#15-var-layers) |
| 16 | `/api/var/names` | GET | [Var Names (Gene Search)](#16-var-names) |
| 17 | `/api/gene-column` | POST | [Gene Column Materialize](#17-gene-column-materialize) |
| 18 | `/api/gene-column/{task_id}/status` | GET | [Gene Column Status](#18-gene-column-status) |
| 19 | `/api/obssets` | GET/POST | [Observation Sets](#19-observation-sets) |
| 20 | `/api/obssets/{id}` | DELETE | [Delete Observation Set](#20-delete-observation-set) |
| 21 | `/api/obssets/{id}/activate` | POST | [Activate Observation Set](#21-activate-observation-set) |
| 22 | `/api/export` | POST | [Export](#22-export) |
| 23 | `/api/export/{task_id}/status` | GET | [Export Status](#23-export-status) |
| 24 | `/api/config` | GET | [Config](#24-config) |
| 25 | `/plate/**` | GET | [Plate Static Files](#25-plate-static-files) |

---

## 1. Mosaic Query Protocol

**Endpoint:** `POST /data/query`
**Used by:** `DashboardProvider.tsx` via Mosaic `restConnector({ uri: "/data/query" })`

The Mosaic coordinator sends all DuckDB queries through this endpoint. The `restConnector` from `@uwdata/mosaic-core` handles serialization.

### Request

```
Content-Type: application/json
```

```typescript
// Mosaic rest connector sends:
interface MosaicQueryRequest {
  type: "arrow" | "json" | "exec";
  sql: string;
}
```

### Response

- **`type: "arrow"`** -> `Content-Type: application/octet-stream` (Arrow IPC stream)
- **`type: "json"`** -> `Content-Type: application/json` (array of row objects)
- **`type: "exec"`** -> `Content-Type: application/json` (empty `{}` on success)

### Notes

- This is the backbone of all Mosaic cross-filter operations.
- The `dataset` VIEW is the primary table queried.
- SQL includes `CREATE TABLE mosaic.preagg_*` for pre-aggregation -- the server must allow these.
- `useColumnTypes` queries `DESCRIBE dataset` via this endpoint.
- `useTrajectoryLoader` queries trajectory data via `coordinator.query()`.
- `rebuildDatasetView` in `mosaic-helpers.ts` sends `CREATE OR REPLACE VIEW` and `SELECT ... FROM information_schema.tables` through this endpoint.

---

## 2. Metadata

**Endpoint:** `GET /data/metadata.json`
**Used by:** `DashboardProvider.tsx` via TanStack Query (`queryKey: ["metadata"]`)

Returns the full dataset metadata used to initialize the dashboard.

### Response

```
Content-Type: application/json
```

```typescript
// Zod schema: MetadataSchema (frontend/src/lib/schemas.ts)
interface Metadata {
  version?: string;
  props: {
    data: {
      id: string;
      projection: { x: string; y: string };
    };
  };
  database: {
    type: string;
    uri?: string;
  };
  obsm: Record<string, {
    prefix: string;
    n_dims: number | null;
    loaded: boolean;
  }>;
  obs_columns?: string[];
  var_count?: number;
  layers?: string[];
  export_dir?: string;
  spatial?: {
    fov_col?: string | null;
    t_col?: string | null;
    bbox_col?: string | null;
    x_col?: string | null;
    y_col?: string | null;
  };
  plate?: boolean;
  dataset_keys?: string[];
  plate_ome_version?: "0.4" | "0.5";
  plate_pixel_scale?: { x: number; y: number };
  plate_channels?: PlateChannel[];
  dataset_channels?: Record<string, PlateChannel[]>;
  plate_stores?: PlateStore[];
  plate_shape?: number[];
  plate_scale?: number[];
  time_points?: number[];
}

interface PlateChannel {
  label: string;
  color: string;      // hex like "FF0000" (no #)
  window: {
    start: number;
    end: number;
    min: number;
    max: number;
  };
}

interface PlateStore {
  mount: string;       // e.g. "/plate" or "/plate/dataset1"
  name: string;        // dataset key
  ome_version: "0.4" | "0.5";
}
```

### Notes

- Schema uses `.passthrough()` for forward compatibility.
- `staleTime: Infinity` -- fetched once per session, refreshed only by `refreshMetadata()`.

---

## 3. Colormaps

**Endpoint:** `GET /data/colormaps`
**Used by:** `useColormapList()` in `hooks/useColormaps.ts`

Returns available colormap names grouped by type.

### Response

```
Content-Type: application/json
```

```typescript
interface ColormapsResponse {
  categorical?: string[];   // e.g. ["tab10", "Set1", ...]
  continuous?: string[];    // e.g. ["viridis", "plasma", ...]
  colormaps?: string[];     // legacy fallback (used if categorical is absent)
}
```

### Notes

- `staleTime: Infinity` -- colormaps never change during a session.

---

## 4. Categorical Palette

**Endpoint:** `GET /data/categorical-palette?colormap={name}&n={count}`
**Used by:** `useColormapPalette()` in `hooks/useColormaps.ts`

Returns hex color strings for a given colormap and number of categories.

### Query Parameters

| Param | Type | Description |
|-------|------|-------------|
| `colormap` | string | Colormap name (e.g. "tab10") |
| `n` | number | Number of distinct colors needed |

### Response

```
Content-Type: application/json
```

```typescript
interface PaletteResponse {
  colors: string[];   // e.g. ["#1f77b4", "#ff7f0e", ...]
}
```

### Notes

- `staleTime: Infinity` -- same colormap + n always produces the same palette.

---

## 5. Load Embedding

**Endpoint:** `POST /api/embeddings/{key}`
**Used by:** `useEmbeddingLoader()` in `scatter-gpu/hooks/useEmbeddingLoader.ts`

Triggers server-side loading of an obsm embedding into DuckDB. Returns immediately; loading happens asynchronously.

### Path Parameters

| Param | Type | Description |
|-------|------|-------------|
| `key` | string | obsm key, e.g. "X_umap" |

### Request

No body. `method: "POST"`.

### Response

```
Content-Type: application/json
```

```typescript
// Acknowledged -- actual readiness is polled via /status
{}
```

---

## 6. Embedding Status

**Endpoint:** `GET /api/embeddings/{key}/status`
**Used by:** `useEmbeddingLoader()` -- polled every 200ms until "ready" or "error"

### Path Parameters

| Param | Type | Description |
|-------|------|-------------|
| `key` | string | obsm key |

### Response

```
Content-Type: application/json
```

```typescript
// Zod schema: EmbeddingStatusSchema (frontend/src/lib/schemas.ts)
interface EmbeddingStatus {
  status: "loading" | "ready" | "error";
  error?: string;
}
```

---

## 7. Scatter Positions

**Endpoint:** `GET /api/scatter-positions?embedding={key}&x_col={col}&y_col={col}`
**Used by:** `useMosaicScatterData()` in `scatter-gpu/hooks/useMosaicScatterData.ts`

Returns all point positions as a binary blob for GPU upload.

### Query Parameters

| Param | Type | Description |
|-------|------|-------------|
| `embedding` | string | obsm key (e.g. "X_umap") |
| `x_col` | string | DuckDB column name for x (e.g. "__ev_X_umap_0__") |
| `y_col` | string | DuckDB column name for y (e.g. "__ev_X_umap_1__") |

### Response

```
Content-Type: application/octet-stream
```

**Binary layout:**

```
Byte 0:                version (uint8) -- must be 1
Bytes 1-4:             header_len (uint32 LE)
Bytes 5..(5+header_len-1): JSON header (UTF-8)
Padding:               align to 4 bytes from byte 0
Data:                  Float32Array (interleaved x,y pairs)
```

**JSON header (Zod: `PositionHeaderSchema`):**

```typescript
// Zod schema: PositionHeaderSchema (frontend/src/scatter-gpu/utils/schemas.ts)
interface PositionHeader {
  numCells: number;         // positive integer
  embeddingKey: string;     // non-empty
  ndim: 2;                  // literal 2
  rowIndices: number[];     // __row_index__ values, length = numCells
  positionScale: number;    // positive, default 1; max-abs divisor for [-1,1] normalization
}
```

**Data section:** `Float32Array` of length `numCells * 2` (interleaved [x0, y0, x1, y1, ...]).

### Notes

- ~4 MB for 500K points. `staleTime: 5 * 60 * 1000` (5 minutes).
- Positions are normalized to [-1, 1] by dividing by `positionScale`.

---

## 8. Scatter Categories

**Endpoint:** `GET /api/scatter-categories?cat_col={col}&original_col={col}`
**Used by:** `useMosaicScatterData()` in `scatter-gpu/hooks/useMosaicScatterData.ts`

Returns category index per point for categorical coloring.

### Query Parameters

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `cat_col` | string | yes | Integer category column (e.g. "__ev_cell_type_id__") |
| `original_col` | string | no | Original string column for human-readable names |

### Response

```
Content-Type: application/octet-stream
```

**Same binary framing as scatter-positions.**

**JSON header (Zod: `CategoryHeaderSchema`):**

```typescript
// Zod schema: CategoryHeaderSchema (frontend/src/scatter-gpu/utils/schemas.ts)
interface CategoryHeader {
  categoryNames: string[];   // e.g. ["T cell", "B cell", "Macrophage"]
}
```

**Data section:** `Uint8Array` of length `numCells` -- one category index per point.

### Notes

- Category index 0 maps to `categoryNames[0]`, etc.
- `staleTime: 30_000` (30 seconds).

---

## 9. Scatter Continuous Colors

**Endpoint:** `GET /api/scatter-continuous-colors?color_col={col}&colormap={name}&vmin={n}&vmax={n}&reversed={bool}`
**Used by:** `useMosaicScatterData()` in `scatter-gpu/hooks/useMosaicScatterData.ts`

Returns pre-computed RGBA colors per point for continuous coloring.

### Query Parameters

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `color_col` | string | yes | Column name for continuous values |
| `colormap` | string | yes | Colormap name (e.g. "viridis") |
| `vmin` | number | no | Min clip value |
| `vmax` | number | no | Max clip value |
| `reversed` | "true" | no | Reverse colormap direction |

### Response

```
Content-Type: application/octet-stream
```

**Same binary framing as scatter-positions.**

**JSON header (Zod: `ContinuousColorsHeaderSchema`):**

```typescript
// Zod schema: ContinuousColorsHeaderSchema (frontend/src/scatter-gpu/utils/schemas.ts)
interface ContinuousColorsHeader {
  numPoints: number;    // positive integer
  vmin: number;         // actual min used
  vmax: number;         // actual max used
  colormap: string;     // echoed back
}
```

**Data section:** `Uint8Array` of length `numPoints * 4` -- RGBA uint8 per point.

### Notes

- Backend applies the colormap; frontend just uploads to GPU.
- `staleTime: 30_000` (30 seconds).

---

## 10. Scatter Selection

**Endpoint:** `POST /api/scatter-selection` and `DELETE /api/scatter-selection`
**Used by:** `useScatterBrushSync.ts` in `scatter-gpu/hooks/useScatterBrushSync.ts`

Syncs large lasso/marquee selections (>=5000 rows) to a server-side DuckDB temp table `__scatter_selection`.

### POST -- Upload Selection

```
Content-Type: application/json
```

```typescript
interface ScatterSelectionBody {
  row_indices: number[];   // __row_index__ values
}
```

**Response:** `200 OK` (body ignored by frontend; `.catch(() => {})` on failure).

### DELETE -- Clear Selection

No body. Drops the `__scatter_selection` temp table.

**Response:** `200 OK` (body ignored).

### Notes

- Small selections (<5000 rows) use inline `IN (...)` SQL -- no server call needed.
- Large selections use `__row_index__ IN (SELECT row_index FROM __scatter_selection)`.

---

## 11. Observation Info

**Endpoint:** `GET /api/obs/{row_index}`
**Used by:** `SingleCropViewer.tsx`, `useGalleryCropQuery.ts`

Returns spatial coordinates for a single observation by DuckDB `__row_index__`.

### Path Parameters

| Param | Type | Description |
|-------|------|-------------|
| `row_index` | number | DuckDB __row_index__ |

### Response

```
Content-Type: application/json
```

```typescript
// Zod schema: ObsInfoSchema (frontend/src/lib/schemas.ts)
interface ObsInfo {
  fov_name: string;
  t: number;
  x: number;               // spatial x in pixels
  y: number;               // spatial y in pixels
  bbox?: {
    y_min: number;
    x_min: number;
    y_max: number;
    x_max: number;
  };
  store_index?: number;     // index into metadata.plate_stores[]
  [key: string]: unknown;   // .passthrough() allows extra fields
}
```

---

## 12. Observation Detail

**Endpoint:** `GET /api/obs/{row_index}/detail`
**Used by:** `PointInfoPane.tsx` in `components/scatter/PointInfoPane.tsx`

Returns all obs metadata columns for a single observation as key-value pairs.

### Path Parameters

| Param | Type | Description |
|-------|------|-------------|
| `row_index` | string | DuckDB __row_index__ (passed as string from highlightId) |

### Response

```
Content-Type: application/json
```

```typescript
// Flat key-value map of all obs columns for this row.
Record<string, string | null>
```

### Notes

- Values are stringified for display. Fields like `track_id`, `fov_name`, `t`, `_dataset` are used by PointInfoPane for trajectory activation.

---

## 13. Observation Batch

**Endpoint:** `GET /api/obs/batch?ids={comma-separated}`
**Used by:** `TrackGallery.tsx` in `components/table/TrackGallery.tsx`

Batch-fetches FOV-local pixel coordinates for multiple observations in one DuckDB query.

### Query Parameters

| Param | Type | Description |
|-------|------|-------------|
| `ids` | string | Comma-separated __row_index__ values (e.g. "42,99,103") |

### Response

```
Content-Type: application/json
```

```typescript
// Keys are stringified row indices.
Record<string, { x: number; y: number }>
```

### Notes

- Populates TanStack Query cache (`["obs-coord", rowIndex]`) so individual crop queries skip their obs fetch.

---

## 14. Image Crop

**Endpoint:** `POST /api/crop/{fov_name}`
**Used by:** `useGalleryCropQuery.ts`, `TrackGallery.tsx`

Returns a composited multi-channel image crop centered on a spatial coordinate.

### Path Parameters

| Param | Type | Description |
|-------|------|-------------|
| `fov_name` | string | FOV identifier (e.g. well/field path) |

### Request

```
Content-Type: application/json
```

```typescript
interface CropRequest {
  t: number;               // time index
  z: number;               // z-slice (typically 0)
  x: number;               // center x in pixels
  y: number;               // center y in pixels
  half: number;            // half-width of crop region in pixels (e.g. 150)
  size: number;            // output image size in pixels (e.g. 200)
  fmt: "webp" | "png";    // output format
  dataset_key?: string;    // for multi-dataset collections
  channels: {
    visible: boolean;
    lo: number;            // contrast low
    hi: number;            // contrast high
    color: string;         // hex color like "FF0000"
    blend: "normal" | "additive" | "multiply" | "subtractive";
  }[];
}
```

### Response

```
Content-Type: image/webp  (or image/png if fmt="png")
```

Binary image data. The frontend creates a `blob:` URL from it.

### Notes

- `staleTime: Infinity` -- same (fov, t, channels hash) always produces the same image.
- `gcTime: 0` -- blob URLs are revoked immediately when the query observer unmounts.
- Channels match the live viewer state so thumbnails reflect what the user sees.

---

## 15. Var Layers

**Endpoint:** `GET /api/var/layers`
**Used by:** `useLayerNames()` in `scatter-gpu/hooks/useLayerNames.ts`

Returns available expression layer names (AnnData `.layers` keys).

### Response

```
Content-Type: application/json
```

```typescript
interface VarLayersResponse {
  layers: string[];   // e.g. ["X", "raw", "normalized"]
}
```

### Notes

- `staleTime: Infinity` -- layers don't change during a session.
- Default fallback in frontend: `["X"]`.

---

## 16. Var Names

**Endpoint:** `GET /api/var/names?q={query}&limit={n}`
**Used by:** `useGeneSearch()` in `scatter-gpu/hooks/useGeneSearch.ts`

Searches gene/variable names with prefix matching.

### Query Parameters

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `q` | string | no | Search prefix (empty = return first N) |
| `limit` | number | yes | Max results (frontend always sends 50) |

### Response

```
Content-Type: application/json
```

```typescript
interface VarNamesResponse {
  names: string[];   // e.g. ["GFP", "GAPDH", "GJA1"]
}
```

### Notes

- Debounced at 200ms in the frontend.

---

## 17. Gene Column Materialize

**Endpoint:** `POST /api/gene-column`
**Used by:** `useVarColumn()` in `scatter-gpu/hooks/useVarColumn.ts`

Starts async materialization of a gene expression column in DuckDB.

### Request

```
Content-Type: application/json
```

```typescript
interface GeneColumnRequest {
  gene: string;    // gene/var name
  layer: string;   // expression layer (e.g. "X")
}
```

### Response

```
Content-Type: application/json
```

```typescript
interface GeneColumnResponse {
  task_id: string;   // UUID for polling
}
```

---

## 18. Gene Column Status

**Endpoint:** `GET /api/gene-column/{task_id}/status`
**Used by:** `useVarColumn()` -- polled every 800ms

### Path Parameters

| Param | Type | Description |
|-------|------|-------------|
| `task_id` | string | UUID from POST /api/gene-column |

### Response

```
Content-Type: application/json
```

```typescript
interface GeneColumnStatusResponse {
  status: "pending" | "running" | "ready" | "error";
  column?: string;   // DuckDB column name when ready
  error?: string;    // error message when failed
}
```

---

## 19. Observation Sets

### GET /api/obssets

**Used by:** `useObsSets()` in `components/scatter/useObsSets.ts`

Returns all saved observation sets.

### Response

```
Content-Type: application/json
```

```typescript
// Zod schema: z.array(ObsSetSchema) (frontend/src/lib/schemas.ts)
interface ObsSet {
  obsset_id: string;
  name: string;
  color: string | null;
  created_count: number;
  current_count: number;
  created_at: string;     // ISO datetime
}

type Response = ObsSet[];
```

### POST /api/obssets

**Used by:** `useCreateObsSet()` in `components/scatter/useObsSets.ts`

Creates a new observation set from the current selection.

### Request

```
Content-Type: application/json
```

```typescript
interface CreateObsSetBody {
  name: string;
  color?: string | null;
  members: {
    dataset_key: string;
    obs_name: string;
  }[];
}
```

### Response

```
Content-Type: application/json
```

```typescript
// Single ObsSet object (same shape as list items)
interface ObsSet { /* same as above */ }
```

---

## 20. Delete Observation Set

**Endpoint:** `DELETE /api/obssets/{id}`
**Used by:** `useDeleteObsSet()` in `components/scatter/useObsSets.ts`

### Path Parameters

| Param | Type | Description |
|-------|------|-------------|
| `id` | string | obsset_id (branded `ObsSetId`) |

### Response

`200 OK` (body ignored).

---

## 21. Activate Observation Set

**Endpoint:** `POST /api/obssets/{id}/activate`
**Used by:** `DashboardProvider.tsx` (obsSetStore subscriber)

Activates an observation set as a cross-filter. Returns a SQL predicate string that the frontend applies via `setObsSetFilter()`.

### Path Parameters

| Param | Type | Description |
|-------|------|-------------|
| `id` | string | obsset_id |

### Response

```
Content-Type: application/json
```

```typescript
interface ActivateResponse {
  predicate: string;   // SQL WHERE clause, e.g. "__row_index__ IN (SELECT ...)"
}
```

---

## 22. Export

**Endpoint:** `POST /api/export`
**Used by:** `ExportDialog.tsx` in `components/toolbar/ExportDialog.tsx`

Starts an async export of the current selection to a zarr file.

### Request

```
Content-Type: application/json
```

```typescript
interface ExportRequest {
  predicate: string | null;    // SQL WHERE clause from brushSelection
  filename: string;            // user-chosen name (without .zarr extension)
  selection_type: string;      // e.g. "unknown"
  embedding_key: string | null;
}
```

### Response (success)

```
Content-Type: application/json
```

```typescript
interface ExportResponse {
  task_id: string;
}
```

### Response (conflict -- another export in progress)

```
HTTP 409
Content-Type: application/json
```

```typescript
interface ExportConflict {
  error: string;
}
```

---

## 23. Export Status

**Endpoint:** `GET /api/export/{task_id}/status`
**Used by:** `ExportDialog.tsx` -- polled every 1000ms

### Path Parameters

| Param | Type | Description |
|-------|------|-------------|
| `task_id` | string | From POST /api/export |

### Response

```
Content-Type: application/json
```

```typescript
interface ExportStatus {
  status: "pending" | "running" | "done" | "error";
  n_obs?: number;          // observation count when done
  output_path?: string;    // file path when done
  error?: string;          // error message when failed
}
```

---

## 24. Config

**Endpoint:** `GET /api/config`
**Used by:** `DashboardProvider.tsx` (referenced in original Python routes)

Returns viewer configuration. May be merged into `/data/metadata.json` in the Bun backend.

### Response

```
Content-Type: application/json
```

```typescript
// Shape depends on implementation -- the frontend currently reads all
// config from /data/metadata.json. This endpoint exists in the Python
// server for compatibility but may be unused. Check actual frontend
// usage before implementing.
```

---

## 25. Plate Static Files

**Endpoint:** `GET /plate/**` (and custom mount paths from `plate_stores[].mount`)
**Used by:** `SingleCropViewer.tsx` via idetik `sourceUrl`

Serves OME-Zarr plate data (static files). The idetik viewer fetches zarr chunks directly.

### URL Construction

```typescript
// SingleCropViewer.tsx line 47-51:
const mountPrefix = activeStore ? activeStore.mount : "/plate";
const sourceUrl = `${window.location.origin}${mountPrefix}/${obsInfo.fov_name}`;
```

### Notes

- This is a static file server, not a JSON API.
- The mount path comes from `metadata.plate_stores[].mount`.
- Default mount path is `/plate`.
- Must serve zarr v3 chunks (nested directory structure or sharded).
- idetik fetches individual chunks via HTTP range requests.

---

## Binary Blob Protocol Summary

Endpoints 7, 8, and 9 share the same binary framing:

```
+--------+------------------+---------------------+---------+-----------+
| Offset | Length           | Content             | Type    | Notes     |
+--------+------------------+---------------------+---------+-----------+
| 0      | 1                | version             | uint8   | must be 1 |
| 1      | 4                | header_len          | uint32  | LE        |
| 5      | header_len       | JSON header         | UTF-8   |           |
| 5+hl   | pad to 4-align   | padding             | zeros   |           |
| aligned| remaining        | data payload        | varies  |           |
+--------+------------------+---------------------+---------+-----------+
```

- **Positions:** data = `Float32Array` (x,y interleaved)
- **Categories:** data = `Uint8Array` (one index per point)
- **Continuous colors:** data = `Uint8Array` (RGBA, 4 bytes per point)

---

## Vite Dev Proxy Configuration

From `vite.config.ts`:

```typescript
server: {
  proxy: {
    "/data": "http://localhost:5055",
    "/api": "http://localhost:5055",
    "/plate": "http://localhost:5055",
  },
},
```

All three prefixes proxy to the Bun.serve backend on port 5055.
