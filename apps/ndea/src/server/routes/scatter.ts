/**
 * Binary scatter data endpoints for the WebGPU scatter renderer.
 *
 * GET /api/scatter-positions          — v1, Float32 interleaved x/y positions
 * GET /api/scatter-categories         — v1, Uint8 category indices
 * GET /api/scatter-continuous-values  — v2, Float32 raw values + vmin/vmax header
 *                                        (frontend applies colormap via ochre LUT on GPU)
 * POST /api/scatter-selection         — Upload selection to temp table
 * DELETE /api/scatter-selection       — Clear selection temp table
 */

import { parseJsonBody, ScatterSelectionBodySchema } from "../protocol.ts";
import { ObsmSliceLoader } from "../slice-loader.ts";
import type { ServerSession } from "../state.ts";
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
export function parseDimIndex(col: string): number | null {
  const m = /_(\d+)$/.exec(col);
  return m ? Number(m[1]) : null;
}

/**
 * Lazily construct the `ObsmSliceLoader` for an embedding key and cache it
 * on `state.obsmLoaders`. Width is discovered via a metadata-only shape
 * read against the first accessor that carries the key — no data load.
 */
export async function getOrCreateObsmLoader(state: ServerSession, embedding: string): Promise<ObsmSliceLoader> {
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
 * Returns float32 interleaved x/y positions normalized to [-1, 1].
 * Query params: embedding, x_col, y_col
 *
 * Phase 0: bypasses DuckDB entirely. Reads two columns directly from the
 * ObsmSliceLoader (zarr slice reads, ~one column per dim) and builds the
 * interleaved Float32 buffer in JS. Aborts propagate through `req.signal`
 * into the zarr read so abandoned fetches don't waste bandwidth.
 */
export async function handleScatterPositions(url: URL, state: ServerSession, signal: AbortSignal): Promise<Response> {
  const embedding = url.searchParams.get("embedding");
  const xCol = url.searchParams.get("x_col");
  const yCol = url.searchParams.get("y_col");

  if (!embedding || !xCol || !yCol) {
    return Response.json({ error: "Missing required params: embedding, x_col, y_col" }, { status: 400 });
  }

  if (!state.availableObsmKeys.includes(embedding)) {
    return Response.json(
      { error: `Unknown embedding "${embedding}". Available: [${state.availableObsmKeys.join(", ") || "none"}]` },
      { status: 404 },
    );
  }

  const xDim = parseDimIndex(xCol);
  const yDim = parseDimIndex(yCol);
  if (xDim === null || yDim === null) {
    return Response.json(
      { error: `x_col / y_col must end in "_<dim>" (got x_col="${xCol}", y_col="${yCol}")` },
      { status: 400 },
    );
  }

  try {
    const loader = await getOrCreateObsmLoader(state, embedding);
    // Fetch both dims in parallel — they share the loader's dedup map, so
    // repeat calls with the same colIndex don't double-read.
    const [xs, ys] = await Promise.all([loader.loadColumn(xDim, signal), loader.loadColumn(yDim, signal)]);

    if (signal.aborted) {
      return new Response("aborted", { status: 499 });
    }

    if (xs.length !== ys.length) {
      throw new Error(`dim length mismatch: x=${xs.length}, y=${ys.length}`);
    }
    const n = xs.length;

    // Normalize to [-1, 1]. NaN values are coerced to 0 for rendering;
    // downstream consumers already treat non-finite positions as hidden.
    let maxAbs = 0;
    for (let i = 0; i < n; i++) {
      const xv = xs[i];
      const yv = ys[i];
      const ax = Number.isFinite(xv) ? Math.abs(xv) : 0;
      const ay = Number.isFinite(yv) ? Math.abs(yv) : 0;
      if (ax > maxAbs) maxAbs = ax;
      if (ay > maxAbs) maxAbs = ay;
    }

    const interleaved = new Float32Array(n * 2);
    if (maxAbs > 0) {
      for (let i = 0; i < n; i++) {
        const xv = xs[i];
        const yv = ys[i];
        interleaved[i * 2] = Number.isFinite(xv) ? xv / maxAbs : 0;
        interleaved[i * 2 + 1] = Number.isFinite(yv) ? yv / maxAbs : 0;
      }
    }

    // rowIndices are the trivial 0..n-1 ordering; the loader already
    // aligns columns to obs_base row order.
    const rowIndices = Array.from<number>({ length: n });
    for (let i = 0; i < n; i++) rowIndices[i] = i;

    const header = {
      numCells: n,
      embeddingKey: embedding,
      ndim: 2,
      rowIndices,
      positionScale: maxAbs > 0 ? maxAbs : 1.0,
    };

    return binaryResponse(packBinary(header, new Uint8Array(interleaved.buffer)));
  } catch (err) {
    if (signal.aborted) return new Response("aborted", { status: 499 });
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[scatter-positions] ${message}`);
    return Response.json({ error: message }, { status: 500 });
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

  try {
    // Read through the `dataset` VIEW (logical obs table), not obs_base — so
    // var + annotation columns colour identically to native obs columns.
    const idxRows = await store.queryJson(`SELECT "${catCol}" FROM dataset ORDER BY __row_index__ ASC`);

    // Build category name list
    let categoryNames: string[];
    if (originalCol) {
      const nameRows = await store.queryJson(
        `SELECT DISTINCT "${originalCol}" FROM dataset ORDER BY "${originalCol}" ASC`,
      );
      categoryNames = nameRows.map((r) => String(r[originalCol]));
    } else {
      const distinctRows = await store.queryJson(`SELECT DISTINCT "${catCol}" FROM dataset ORDER BY "${catCol}" ASC`);
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

// ─── Scatter continuous values (Phase 7) ────────────────────────────────────

/**
 * Handle GET /api/scatter-continuous-values
 *
 * Returns raw Float32 values per observation plus autocomputed vmin/vmax
 * (from finite values). The frontend GPU kernel normalizes via a uniform
 * and looks up an ochre-generated LUT — so colormap swaps and slider
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

  try {
    const rows = await store.queryJson(`SELECT "${colorCol}" FROM dataset ORDER BY __row_index__ ASC`);

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

// ─── Scatter selection ──────────────────────────────────────────────────────

/**
 * Handle POST /api/scatter-selection
 *
 * Writes selected row indices into a DuckDB temp table for efficient
 * hash-join filtering in Mosaic table queries.
 */
export async function handleScatterSelectionPost(req: Request, store: DatasetQuerySession): Promise<Response> {
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
export async function handleScatterSelectionDelete(store: DatasetQuerySession): Promise<Response> {
  try {
    await store.execute("DROP TABLE IF EXISTS __scatter_selection");
    return Response.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}

// ─── Per-instance scatter selection (PLUGIN-ARCHITECTURE §6.5) ─────────────────
// Each plugin instance gets its own `sel_<instanceId>` temp table so two
// selection-out plugins on the one shared DuckDB connection cannot clobber each
// other. The legacy fixed `__scatter_selection` (above) stays for the host-less
// floating scatter and the collections "save from selection" two-step.

/**
 * Validate a per-instance selection id and map it to a safe SQL table identifier.
 *
 * SECURITY: the id is interpolated into a TABLE NAME, which DuckDB cannot
 * parameter-bind, so it MUST be validated here (server-side, on the decoded path
 * segment) BEFORE any SQL is built. Returns null for an invalid id — the caller
 * responds 400 and builds no SQL. Never coerce an arbitrary string.
 */
function toSelectionTable(instanceId: string): string | null {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(instanceId)) return null;
  // The regex is the security gate; collapsing `-` to `_` makes the final name a
  // legal bare SQL identifier (belt-and-suspenders).
  return `sel_${instanceId.replace(/[^A-Za-z0-9_]/g, "_")}`;
}

/** Handle POST /api/selection/:instanceId — populate this instance's `sel_<id>` table. */
export async function handleSelectionPost(
  req: Request,
  store: DatasetQuerySession,
  instanceId: string,
): Promise<Response> {
  const table = toSelectionTable(instanceId);
  if (!table) return Response.json({ error: "invalid selection id" }, { status: 400 });

  const parsed = await parseJsonBody(req, ScatterSelectionBodySchema);
  if (!parsed.ok) return parsed.response;
  // Zod guarantees every element is a finite non-negative integer, so `${i}` is
  // safe; `table` is the regex-gated identifier from toSelectionTable above.
  const rowIndices = parsed.data.row_indices;

  try {
    await store.execute(`DROP TABLE IF EXISTS ${table}`);
    if (rowIndices.length > 0) {
      const batchSize = 1000;
      await store.execute(`CREATE TEMP TABLE ${table} (row_index UINTEGER)`);
      for (let start = 0; start < rowIndices.length; start += batchSize) {
        const end = Math.min(start + batchSize, rowIndices.length);
        const values = rowIndices
          .slice(start, end)
          .map((i) => `(${i})`)
          .join(", ");
        await store.execute(`INSERT INTO ${table} VALUES ${values}`);
      }
    }
    return Response.json({ ok: true, table, count: rowIndices.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}

/** Handle DELETE /api/selection/:instanceId — drop this instance's `sel_<id>` table. */
export async function handleSelectionDelete(store: DatasetQuerySession, instanceId: string): Promise<Response> {
  const table = toSelectionTable(instanceId);
  if (!table) return Response.json({ error: "invalid selection id" }, { status: 400 });
  try {
    await store.execute(`DROP TABLE IF EXISTS ${table}`);
    return Response.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}
