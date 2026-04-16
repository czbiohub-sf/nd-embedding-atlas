/**
 * Obs preparation — detect spatial columns and prepare Arrow IPC for DuckDB.
 *
 * Ports the Python `vz/_prepare.py` logic to TypeScript.
 * Works with Arrow IPC bytes (from axial's toArrowTable or similar).
 */

import type { SpatialColumns } from "./state.ts";

// Re-export the column prefix helper from store
export { obsmColumnPrefix } from "./store.ts";

// ─── Spatial column detection ────────────────────────────────────────────────

/** Auto-detect spatial column names from the set of available obs columns. */
export function detectSpatialColumns(obsColumns: Set<string>): SpatialColumns {
    // FOV / well
    let fov: string | null = null;
    if (obsColumns.has("fov_name")) fov = "fov_name";
    else if (obsColumns.has("well")) fov = "well";

    // Time
    const t = obsColumns.has("t") ? "t" : null;

    // Bounding box
    let bbox: string | null = null;
    if (obsColumns.has("bbox")) bbox = "bbox";
    else if (obsColumns.has("cp_bbox")) bbox = "cp_bbox";

    // Centroid coordinates
    let x: string | null = null;
    let y: string | null = null;
    const candidates: [string, string][] = [
        ["x", "y"],
        ["x_cp1", "y_cp1"],
        ["x_global_pheno", "y_global_pheno"],
    ];
    for (const [xc, yc] of candidates) {
        if (obsColumns.has(xc) && obsColumns.has(yc)) {
            x = xc;
            y = yc;
            break;
        }
    }

    return { fov, t, bbox, x, y };
}

// ─── Bbox parsing ────────────────────────────────────────────────────────────

export interface BboxRect {
    yMin: number;
    xMin: number;
    yMax: number;
    xMax: number;
}

/**
 * Parse a bbox string like "[y_min x_min y_max x_max]" to a BboxRect.
 *
 * @returns Parsed bbox or null if the string is malformed.
 */
export function parseBbox(raw: string): BboxRect | null {
    const parts = raw.replace(/[[\]]/g, "").trim().split(/\s+/);
    if (parts.length !== 4) return null;

    const nums = parts.map(Number);
    if (nums.some(Number.isNaN)) return null;

    return {
        yMin: nums[0],
        xMin: nums[1],
        yMax: nums[2],
        xMax: nums[3],
    };
}

// ─── Prepare result ──────────────────────────────────────────────────────────

export interface PrepareResult {
    /** Arrow IPC bytes ready for DuckDB ingestion via register_buffer. */
    arrowIpc: Uint8Array;
    /** List of obs column names (excluding internal columns). */
    obsColumns: string[];
    /** Detected spatial columns, or null if none found. */
    spatial: SpatialColumns | null;
}

/**
 * Prepare obs data for the EmbeddingStore.
 *
 * Takes Arrow IPC bytes, detects spatial columns, and returns
 * the IPC bytes along with metadata needed by the store.
 *
 * Column names are extracted by querying a temporary DuckDB table,
 * since we receive opaque IPC bytes and avoid depending on an Arrow
 * library at this layer.
 *
 * @param arrowIpc  Arrow IPC stream bytes containing obs data.
 * @param columnNames  List of column names in the Arrow table (caller provides).
 * @param datasetName  Dataset name to inject as `_dataset` column (if needed).
 */
export function prepareObs(
    arrowIpc: Uint8Array,
    columnNames: string[],
    datasetName?: string,
): PrepareResult {
    const colSet = new Set(columnNames);

    // Detect spatial columns
    const spatial = detectSpatialColumns(colSet);
    const hasSpatial = spatial.fov != null || spatial.bbox != null || spatial.x != null;

    // Filter out internal / embedding columns for the obsColumns list
    const internalPrefixes = ["__"];
    const obsColumns = columnNames.filter((c) => !internalPrefixes.some((p) => c.startsWith(p)));

    // If _dataset is missing and a datasetName was provided, the caller
    // should add it before passing to EmbeddingStore.create().
    // We note this in the result metadata but don't modify the IPC bytes here,
    // since the store will handle column injection via DuckDB SQL.

    return {
        arrowIpc,
        obsColumns,
        spatial: hasSpatial ? spatial : null,
    };
}
