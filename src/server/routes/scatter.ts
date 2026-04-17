/**
 * Binary scatter data endpoints for the WebGPU scatter renderer.
 *
 * GET /api/scatter-positions       — Float32 interleaved x/y positions
 * GET /api/scatter-categories      — Uint8 category indices
 * GET /api/scatter-continuous-colors — Uint8 RGBA per point
 * POST /api/scatter-selection      — Upload selection to temp table
 * DELETE /api/scatter-selection    — Clear selection temp table
 */

import { sampleContinuous } from "../colormaps.ts";
import { parseJsonBody, ScatterSelectionBodySchema } from "../protocol.ts";
import type { EmbeddingStore } from "../store.ts";

// ─── Binary format helpers ──────────────────────────────────────────────────
// Format (version 1):
//   [1 byte]           version = 1  (uint8)
//   [4 bytes]          header_len   (uint32 LE)
//   [header_len bytes] JSON header  (UTF-8)
//   [0-3 bytes]        zero padding to align to 4-byte boundary
//   [data bytes]       the actual typed array data

function packBinary(header: Record<string, unknown>, data: Uint8Array): Uint8Array {
  const headerBytes = new TextEncoder().encode(JSON.stringify(header));
  const prefixLen = 1 + 4 + headerBytes.byteLength;
  const padding = (4 - (prefixLen % 4)) % 4;
  const totalLen = prefixLen + padding + data.byteLength;

  const result = new Uint8Array(totalLen);
  const view = new DataView(result.buffer);

  // Version byte
  result[0] = 1;
  // Header length (uint32 LE)
  view.setUint32(1, headerBytes.byteLength, true);
  // Header JSON
  result.set(headerBytes, 5);
  // Padding is already zeros
  // Data payload
  result.set(data, prefixLen + padding);

  return result;
}

function binaryResponse(body: Uint8Array): Response {
  return new Response(body as unknown as BodyInit, {
    headers: { "Content-Type": "application/octet-stream" },
  });
}

// ─── Scatter positions ──────────────────────────────────────────────────────

/**
 * Handle GET /api/scatter-positions
 *
 * Returns float32 interleaved x/y positions normalized to [-1, 1].
 * Query params: embedding, x_col, y_col
 */
export async function handleScatterPositions(url: URL, store: EmbeddingStore): Promise<Response> {
  const embedding = url.searchParams.get("embedding");
  const xCol = url.searchParams.get("x_col");
  const yCol = url.searchParams.get("y_col");

  if (!embedding || !xCol || !yCol) {
    return Response.json({ error: "Missing required params: embedding, x_col, y_col" }, { status: 400 });
  }

  try {
    const rows = await store.queryJson(
      `SELECT __row_index__, "${xCol}", "${yCol}" FROM dataset ORDER BY __row_index__ ASC`,
    );

    const n = rows.length;
    const rowIndices: number[] = Array.from<number>({ length: n });
    const xs = new Float64Array(n);
    const ys = new Float64Array(n);

    for (let i = 0; i < n; i++) {
      rowIndices[i] = Number(rows[i].__row_index__);
      const xVal = Number(rows[i][xCol]);
      const yVal = Number(rows[i][yCol]);
      xs[i] = Number.isFinite(xVal) ? xVal : 0;
      ys[i] = Number.isFinite(yVal) ? yVal : 0;
    }

    // Normalize to [-1, 1]
    let maxAbs = 0;
    for (let i = 0; i < n; i++) {
      maxAbs = Math.max(maxAbs, Math.abs(xs[i]), Math.abs(ys[i]));
    }

    const interleaved = new Float32Array(n * 2);
    if (maxAbs > 0) {
      for (let i = 0; i < n; i++) {
        interleaved[i * 2] = xs[i] / maxAbs;
        interleaved[i * 2 + 1] = ys[i] / maxAbs;
      }
    }

    const header = {
      numCells: n,
      embeddingKey: embedding,
      ndim: 2,
      rowIndices,
      positionScale: maxAbs > 0 ? maxAbs : 1.0,
    };

    return binaryResponse(packBinary(header, new Uint8Array(interleaved.buffer)));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 400 });
  }
}

// ─── Scatter categories ─────────────────────────────────────────────────────

/**
 * Handle GET /api/scatter-categories
 *
 * Returns uint8 category indices, one per observation.
 * Query params: cat_col, original_col (optional)
 */
export async function handleScatterCategories(url: URL, store: EmbeddingStore): Promise<Response> {
  const catCol = url.searchParams.get("cat_col");
  const originalCol = url.searchParams.get("original_col");

  if (!catCol) {
    return Response.json({ error: "Missing required param: cat_col" }, { status: 400 });
  }

  try {
    // Fetch category indices ordered by row
    const idxRows = await store.queryJson(`SELECT "${catCol}" FROM obs_base ORDER BY __row_index__ ASC`);

    // Build category name list
    let categoryNames: string[];
    if (originalCol) {
      const nameRows = await store.queryJson(
        `SELECT DISTINCT "${originalCol}" FROM obs_base ORDER BY "${originalCol}" ASC`,
      );
      categoryNames = nameRows.map((r) => String(r[originalCol]));
    } else {
      const distinctRows = await store.queryJson(`SELECT DISTINCT "${catCol}" FROM obs_base ORDER BY "${catCol}" ASC`);
      categoryNames = distinctRows.map((r) => String(r[catCol]));
    }

    const indices = new Uint8Array(idxRows.length);
    for (let i = 0; i < idxRows.length; i++) {
      const val = idxRows[i][catCol];
      indices[i] = val != null ? Number(val) : 0;
    }

    const header = { categoryNames };
    return binaryResponse(packBinary(header, indices));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 400 });
  }
}

// ─── Scatter continuous colors ──────────────────────────────────────────────

/**
 * Handle GET /api/scatter-continuous-colors
 *
 * Returns uint8 RGBA per observation, pre-mapped through a colormap
 * (d3-scale-chromatic interpolators via sampleContinuous). Falls back
 * to grayscale when the named colormap isn't in the continuous catalog.
 *
 * Query params: color_col, colormap, vmin (optional), vmax (optional)
 */
export async function handleScatterContinuousColors(url: URL, store: EmbeddingStore): Promise<Response> {
  const colorCol = url.searchParams.get("color_col");
  const colormap = url.searchParams.get("colormap") ?? "viridis";
  const vminParam = url.searchParams.get("vmin");
  const vmaxParam = url.searchParams.get("vmax");

  if (!colorCol) {
    return Response.json({ error: "Missing required param: color_col" }, { status: 400 });
  }

  try {
    const rows = await store.queryJson(`SELECT "${colorCol}" FROM dataset ORDER BY __row_index__ ASC`);

    const n = rows.length;
    const values = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const v = rows[i][colorCol];
      values[i] = v != null ? Number(v) : Number.NaN;
    }

    // Compute vmin/vmax from data when not provided
    let actualVmin = vminParam != null ? Number(vminParam) : Infinity;
    let actualVmax = vmaxParam != null ? Number(vmaxParam) : -Infinity;
    if (vminParam == null || vmaxParam == null) {
      for (let i = 0; i < n; i++) {
        if (Number.isFinite(values[i])) {
          if (vminParam == null) actualVmin = Math.min(actualVmin, values[i]);
          if (vmaxParam == null) actualVmax = Math.max(actualVmax, values[i]);
        }
      }
    }
    if (!Number.isFinite(actualVmin)) actualVmin = 0;
    if (!Number.isFinite(actualVmax)) actualVmax = 1;

    const span = actualVmax - actualVmin;

    // Map through the requested continuous colormap (grayscale fallback).
    const rgba = new Uint8Array(n * 4);
    for (let i = 0; i < n; i++) {
      let normalized: number;
      if (Number.isFinite(values[i]) && span > 0) {
        normalized = Math.max(0, Math.min(1, (values[i] - actualVmin) / span));
      } else {
        normalized = 0.5;
      }
      const rgb = sampleContinuous(colormap, normalized);
      if (rgb !== null) {
        rgba[i * 4] = rgb[0];
        rgba[i * 4 + 1] = rgb[1];
        rgba[i * 4 + 2] = rgb[2];
      } else {
        const v = Math.round(normalized * 255);
        rgba[i * 4] = v;
        rgba[i * 4 + 1] = v;
        rgba[i * 4 + 2] = v;
      }
      rgba[i * 4 + 3] = 255;
    }

    const header = {
      numPoints: n,
      vmin: actualVmin,
      vmax: actualVmax,
      colormap,
    };
    return binaryResponse(packBinary(header, rgba));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 400 });
  }
}

// ─── Scatter selection ──────────────────────────────────────────────────────

/**
 * Handle POST /api/scatter-selection
 *
 * Writes selected row indices into a DuckDB temp table for efficient
 * hash-join filtering in Mosaic table queries.
 */
export async function handleScatterSelectionPost(req: Request, store: EmbeddingStore): Promise<Response> {
  const parsed = await parseJsonBody(req, ScatterSelectionBodySchema);
  if (!parsed.ok) return parsed.response;
  // SECURITY: Zod guarantees every element is a finite non-negative integer
  // (see ScatterSelectionBodySchema). Interpolating `${i}` into SQL is safe.
  const rowIndices = parsed.data.row_indices;

  try {
    await store.execute("DROP TABLE IF EXISTS __scatter_selection");
    if (rowIndices.length > 0) {
      // Build in batches to avoid overly long SQL
      const batchSize = 1000;
      await store.execute("CREATE TEMP TABLE __scatter_selection (row_index UINTEGER)");
      for (let start = 0; start < rowIndices.length; start += batchSize) {
        const end = Math.min(start + batchSize, rowIndices.length);
        const values = rowIndices
          .slice(start, end)
          .map((i) => `(${i})`)
          .join(", ");
        await store.execute(`INSERT INTO __scatter_selection VALUES ${values}`);
      }
    }

    return Response.json({ ok: true, count: rowIndices.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}

/**
 * Handle DELETE /api/scatter-selection
 *
 * Drops the __scatter_selection temp table.
 */
export async function handleScatterSelectionDelete(store: EmbeddingStore): Promise<Response> {
  try {
    await store.execute("DROP TABLE IF EXISTS __scatter_selection");
    return Response.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}
