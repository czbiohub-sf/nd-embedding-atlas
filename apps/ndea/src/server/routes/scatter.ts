/**
 * Binary scatter data endpoints for the WebGPU scatter renderer.
 *
 * GET /api/scatter-positions         : v1, Float32 position columns (x, y, then z in 3D)
 * GET /api/scatter-categories        : v1, Uint8 category indices
 * GET /api/scatter-continuous-values : v2, Float32 raw values + vmin/vmax header
 *                                        (the frontend samples the colormap on the GPU)
 */

import { ObsmSliceLoader } from "../slice-loader.ts";
import type { ServerSession } from "../state.ts";
import { quoteIdent } from "@ndea/protocol";
import { routeError } from "../request-body.ts";
import type { DatasetQuerySession } from "../store.ts";

// ─── Binary format helpers ──────────────────────────────────────────────────
// Format (version 1):
//   [1 byte]           version = 1  (uint8)
//   [4 bytes]          header_len   (uint32 LE)
//   [header_len bytes] JSON header  (UTF-8)
//   [0-3 bytes]        zero padding to align to 4-byte boundary
//   [data bytes]       the actual typed array data

function packBinary(header: Record<string, unknown>, data: Uint8Array, version = 1): Uint8Array {
  const headerBytes = new TextEncoder().encode(JSON.stringify(header));
  const prefixLen = 1 + 4 + headerBytes.byteLength;
  const padding = (4 - (prefixLen % 4)) % 4;
  const totalLen = prefixLen + padding + data.byteLength;

  const result = new Uint8Array(totalLen);
  const view = new DataView(result.buffer);

  result[0] = version;
  view.setUint32(1, headerBytes.byteLength, true);
  result.set(headerBytes, 5);
  // Padding is already zeros
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
 * Parse a trailing `_<digits>` dim index off a SQL-safe obsm column name
 * like `dinov2_pca_7` → 7. Returns null if the suffix isn't present.
 */
function parseDimIndex(col: string): number | null {
  const m = /_(\d+)$/.exec(col);
  return m ? Number(m[1]) : null;
}

/**
 * Lazily construct the `ObsmSliceLoader` for an embedding key and cache it
 * on `state.obsmLoaders`. Width is discovered via a metadata-only shape
 * read against the first accessor that carries the key: no data load.
 */
async function getOrCreateObsmLoader(state: ServerSession, embedding: string): Promise<ObsmSliceLoader> {
  const existing = state.obsmLoaders.get(embedding);
  if (existing) return existing;
  const width = await ObsmSliceLoader.detectWidth(embedding, state.accessors.entries());
  const loader = new ObsmSliceLoader(embedding, state.accessors.entries(), width);
  state.obsmLoaders.set(embedding, loader);
  return loader;
}

/**
 * Handle GET /api/scatter-positions
 *
 * Returns float32 position columns normalized to [-1, 1]: n x values, n y
 * values, then n z values when `z_col` asks for 3D (`header.ndim`).
 * Query params: embedding, x_col, y_col, z_col (optional)
 *
 * Phase 0: bypasses DuckDB entirely. Reads the columns directly from the
 * ObsmSliceLoader (zarr slice reads, ~one column per dim). Aborts propagate
 * through `req.signal` into the zarr read so abandoned fetches don't waste
 * bandwidth.
 */
export async function handleScatterPositions(url: URL, state: ServerSession, signal: AbortSignal): Promise<Response> {
  const embedding = url.searchParams.get("embedding");
  const xCol = url.searchParams.get("x_col");
  const yCol = url.searchParams.get("y_col");
  const zCol = url.searchParams.get("z_col");

  if (!embedding || !xCol || !yCol) {
    return Response.json({ error: "Missing required params: embedding, x_col, y_col" }, { status: 400 });
  }

  if (!state.availableObsmKeys.includes(embedding)) {
    return Response.json(
      { error: `Unknown embedding "${embedding}". Available: [${state.availableObsmKeys.join(", ") || "none"}]` },
      { status: 404 },
    );
  }

  const dims = [xCol, yCol, ...(zCol ? [zCol] : [])].map(parseDimIndex);
  if (!dims.every((dim) => dim !== null)) {
    return Response.json(
      { error: `x_col / y_col / z_col must end in "_<dim>" (got x_col="${xCol}", y_col="${yCol}", z_col="${zCol}")` },
      { status: 400 },
    );
  }

  try {
    const loader = await getOrCreateObsmLoader(state, embedding);
    const outOfRange = dims.find((dim) => dim >= loader.width);
    if (outOfRange !== undefined) {
      return Response.json(
        {
          error: `"${embedding}" has ${loader.width} columns; dim ${outOfRange} is out of range${zCol ? " (3D needs at least 3)" : ""}`,
        },
        { status: 400 },
      );
    }
    // Fetch dims in parallel: they share the loader's dedup map, so repeat
    // calls with the same colIndex don't double-read.
    const columns = await Promise.all(dims.map((dim) => loader.loadColumn(dim, signal)));

    if (signal.aborted) {
      return new Response("aborted", { status: 499 });
    }

    const n = columns[0].length;
    if (columns.some((column) => column.length !== n)) {
      throw new Error(`dim length mismatch: ${columns.map((column) => column.length).join(" / ")}`);
    }
    // Point i is `__row_index__ = i`: the loader aligns columns to obs_base row
    // order, and clients index row bitmasks and sets by point index.
    if (n !== state.store.nObs) throw new Error(`embedding has ${n} rows, dataset has ${state.store.nObs}`);

    // Normalize every axis by one max-abs (keeps the aspect). NaN values are
    // coerced to 0 for rendering.
    let maxAbs = 0;
    for (const column of columns) {
      for (const v of column) if (Number.isFinite(v) && Math.abs(v) > maxAbs) maxAbs = Math.abs(v);
    }

    const positions = new Float32Array(n * columns.length);
    if (maxAbs > 0) {
      columns.forEach((column, axis) => {
        for (let i = 0; i < n; i++) {
          const v = column[i];
          positions[axis * n + i] = Number.isFinite(v) ? v / maxAbs : 0;
        }
      });
    }

    const header = {
      numCells: n,
      embeddingKey: embedding,
      ndim: columns.length,
      positionScale: maxAbs > 0 ? maxAbs : 1.0,
    };

    return binaryResponse(packBinary(header, new Uint8Array(positions.buffer)));
  } catch (err) {
    return routeError("scatter-positions", err, signal);
  }
}

// ─── Scatter categories ─────────────────────────────────────────────────────

/**
 * Handle GET /api/scatter-categories
 *
 * Returns uint8 category indices, one per observation.
 * Query params: cat_col, original_col (optional)
 */
export async function handleScatterCategories(url: URL, store: DatasetQuerySession): Promise<Response> {
  const catCol = url.searchParams.get("cat_col");
  const originalCol = url.searchParams.get("original_col");

  if (!catCol) {
    return Response.json({ error: "Missing required param: cat_col" }, { status: 400 });
  }
  const unknown = [catCol, originalCol].find((column) => column && !store.columns().has(column));
  if (unknown) return Response.json({ error: `Unknown column "${unknown}"` }, { status: 400 });

  try {
    // Read through the `dataset` VIEW (logical obs table), not obs_base: so
    // var + annotation columns colour identically to native obs columns.
    const cat = quoteIdent(catCol);
    const idxRows = await store.querySingleJson(`SELECT ${cat} FROM dataset ORDER BY __row_index__ ASC`);

    // Category names come from the original column when given, else the index column.
    const nameCol = originalCol || catCol;
    const name = quoteIdent(nameCol);
    const nameRows = await store.querySingleJson(`SELECT DISTINCT ${name} FROM dataset ORDER BY ${name} ASC`);
    const categoryNames = nameRows.map((r) => String(r[nameCol]));

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

// ─── Scatter continuous values (Phase 7) ────────────────────────────────────

/**
 * Handle GET /api/scatter-continuous-values
 *
 * Returns raw Float32 values per observation plus autocomputed vmin/vmax
 * (from finite values). The frontend GPU kernel normalizes via a uniform
 * and indexes a color table the GPU samples from the colormap: so colormap swaps and slider
 * drags happen without re-fetching. NaN values are preserved in the
 * payload; the kernel maps them to mid-gradient.
 *
 * Query params: color_col
 *
 * Binary frame v2: header { numPoints, vmin, vmax }, data Float32Array[N].
 */
export async function handleScatterContinuousValues(url: URL, store: DatasetQuerySession): Promise<Response> {
  const colorCol = url.searchParams.get("color_col");

  if (!colorCol) {
    return Response.json({ error: "Missing required param: color_col" }, { status: 400 });
  }

  if (!store.columns().has(colorCol)) return Response.json({ error: `Unknown column "${colorCol}"` }, { status: 400 });

  try {
    const rows = await store.querySingleJson(`SELECT ${quoteIdent(colorCol)} FROM dataset ORDER BY __row_index__ ASC`);

    const n = rows.length;
    const values = new Float32Array(n);
    let vmin = Infinity;
    let vmax = -Infinity;
    for (let i = 0; i < n; i++) {
      const raw = rows[i][colorCol];
      const v = raw != null ? Number(raw) : Number.NaN;
      values[i] = v;
      if (Number.isFinite(v)) {
        if (v < vmin) vmin = v;
        if (v > vmax) vmax = v;
      }
    }
    if (!Number.isFinite(vmin)) vmin = 0;
    if (!Number.isFinite(vmax)) vmax = 1;

    const header = { numPoints: n, vmin, vmax };
    // Values are already Float32Array; packBinary writes bytes verbatim.
    return binaryResponse(packBinary(header, new Uint8Array(values.buffer), 2));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 400 });
  }
}
