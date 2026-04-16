/**
 * Var (gene) name search, layer listing, and gene-expression column endpoints.
 *
 * GET  /api/var/names                 — Search gene names
 * GET  /api/var/layers                — List expression layers
 * POST /api/gene-column               — Start gene column materialization
 * GET  /api/gene-column/{task_id}/status — Poll materialization status
 */

import type { AnnDataAccessor } from "../../zarr/anndata-accessor.ts";
import type { SparseArray } from "../../zarr/types.ts";
import { GeneColumnBodySchema, parseJsonBody } from "../protocol.ts";
import type { ViewerState } from "../state.ts";

/** In-flight gene column materialization tasks. */
export interface GeneTask {
  taskId: string;
  status: "loading" | "ready" | "error";
  column: string;
  error?: string;
}

/** Module-level state for gene tasks. Keyed by task_id. */
const geneTasks = new Map<string, GeneTask>();

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Return the first accessor in the state (or null if none). */
function firstAccessor(state: ViewerState): AnnDataAccessor | null {
  const iter = state.accessors.values().next();
  return iter.done ? null : iter.value;
}

/** Materialise var.index (whatever its runtime type) as a plain string array. */
function varNamesOf(accessor: AnnDataAccessor): string[] {
  const idx = accessor.var.index;
  if (Array.isArray(idx)) return idx;
  // Int32Array index — fall back to numeric strings
  return Array.from(idx, (n) => String(n));
}

// ─── Routes ─────────────────────────────────────────────────────────────────

/**
 * Handle GET /api/var/names?q={query}&limit={n}
 *
 * Case-insensitive prefix match on var.index from the first dataset's
 * AnnData accessor. Empty q returns the first `limit` names.
 */
export function handleVarNames(url: URL, state: ViewerState): Response {
  const q = (url.searchParams.get("q") ?? "").toLowerCase();
  const limit = Math.max(1, Math.min(500, Number(url.searchParams.get("limit") ?? "50")));

  const accessor = firstAccessor(state);
  if (!accessor) return Response.json({ names: [] });

  const names = varNamesOf(accessor);

  const matches: string[] = [];
  if (q === "") {
    for (let i = 0; i < names.length && matches.length < limit; i++) {
      matches.push(names[i]);
    }
  } else {
    // Prefer prefix matches, then fall back to contains.
    const prefixHits: string[] = [];
    const containsHits: string[] = [];
    for (const name of names) {
      const lower = name.toLowerCase();
      if (lower.startsWith(q)) prefixHits.push(name);
      else if (lower.includes(q)) containsHits.push(name);
      if (prefixHits.length >= limit) break;
    }
    matches.push(...prefixHits.slice(0, limit));
    if (matches.length < limit) {
      matches.push(...containsHits.slice(0, limit - matches.length));
    }
  }

  return Response.json({ names: matches });
}

/**
 * Handle GET /api/var/layers
 *
 * Returns available expression layer names. AnnData always has "X" (the
 * primary matrix). Additional layers are discovered from the zarr store's
 * `layers/` group on first call.
 */
export async function handleVarLayers(state: ViewerState): Promise<Response> {
  const accessor = firstAccessor(state);
  if (!accessor) return Response.json({ layers: ["X"] });

  // Try to discover extra layers by probing the zarr `layers` group.
  // The accessor doesn't currently expose this, so we fall back to ["X"]
  // unless we can read layer keys via a private hook in the future.
  const extra = await discoverLayers(accessor);
  const all = ["X", ...extra];
  return Response.json({ layers: all });
}

/**
 * Probe the zarr store for `layers/` children. Returns [] if not accessible.
 * Uses the accessor's internal zarr group reference if available.
 */
async function discoverLayers(accessor: AnnDataAccessor): Promise<string[]> {
  // The accessor's private _group field holds a zarrita location. We can
  // attempt to open "layers" as a group and enumerate children by reading
  // the zarr store's hierarchy. Since the accessor API doesn't expose this
  // yet, we leave the hook here for a future wire-up.
  const group = (accessor as unknown as { _group?: unknown })._group;
  if (!group) return [];

  try {
    // Defer to zarrita dynamically to avoid a hard dep at module init.
    const zarr = await import("zarrita");
    // @ts-expect-error — accessor._group is a zarrita Location.
    const loc = group.resolve("layers");
    const grp = await zarr.open(loc, { kind: "group" });
    const attrs = (grp.attrs ?? {}) as Record<string, unknown>;
    // AnnData >= 0.8 stores `{ "encoding-type": "dict" }` with children
    // listed under the group directly; zarrita doesn't expose listing,
    // so we rely on the "layers" attr convention when present.
    const listed = (attrs["layers"] as string[] | undefined) ?? [];
    return listed.filter((l) => typeof l === "string");
  } catch {
    return [];
  }
}

/**
 * Handle POST /api/gene-column  body: { gene, layer? }
 *
 * Materialises an expression column aligned to obs_base's `__row_index__`:
 *   1. For each dataset, find gene's position in var.index
 *   2. isel({ var: [idx] }).getX() → length-nObs column (NaN where missing)
 *   3. Concatenate in obs_base insertion order → Float64Array of length nObs
 *   4. store.registerGeneColumn(colName, values) → table + VIEW rebuild
 *
 * Returns 202 with { task_id, status: "loading", column }. Poll
 * /api/gene-column/{task_id}/status for completion.
 */
export async function handleGeneColumn(req: Request, state: ViewerState): Promise<Response> {
  const parsed = await parseJsonBody(req, GeneColumnBodySchema);
  if (!parsed.ok) return parsed.response;
  const gene = parsed.data.gene;
  const layer = parsed.data.layer ?? "X";

  try {
    const safeVar = gene.replace(/[^a-zA-Z0-9]/g, "_");
    const safeLayer = layer.replace(/[^a-zA-Z0-9]/g, "_");
    const colName = `__var_${safeVar}_${safeLayer}__`;

    const taskId = crypto.randomUUID();

    // Short-circuit if the column already exists.
    if (state.store.hasGeneColumn(colName)) {
      const task: GeneTask = { taskId, status: "ready", column: colName };
      geneTasks.set(taskId, task);
      return Response.json({ task_id: taskId, status: "ready", column: colName });
    }

    const task: GeneTask = { taskId, status: "loading", column: colName };
    geneTasks.set(taskId, task);

    // Kick off materialization asynchronously.
    void materialiseGeneColumn(state, gene, layer, colName)
      .then(() => {
        task.status = "ready";
      })
      .catch((err) => {
        task.status = "error";
        task.error = err instanceof Error ? err.message : String(err);
      });

    return Response.json({ task_id: taskId, status: "loading", column: colName }, { status: 202 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}

// ─── Gene column materialization ────────────────────────────────────────────

async function materialiseGeneColumn(state: ViewerState, gene: string, layer: string, colName: string): Promise<void> {
  const nObs = state.store.nObs;
  const values = new Float64Array(nObs);
  values.fill(Number.NaN);

  // Iterate datasets in insertion order (same order as obs_base was built).
  let cursor = 0;
  for (const [dsName, accessor] of state.accessors) {
    const dsN = accessor.nObs;
    const varIdx = findVarIndex(accessor, gene);

    if (varIdx >= 0) {
      const slice = await loadGeneSlice(accessor, varIdx, layer, dsN);
      values.set(slice, cursor);
    } // else: leave NaN for this dataset
    cursor += dsN;

    // Silence unused-var warning for dsName
    void dsName;
  }

  if (cursor !== nObs) {
    throw new Error(`Gene column row alignment mismatch: obs_base.nObs=${nObs} but accessors sum to ${cursor}`);
  }

  await state.store.registerGeneColumn(colName, values);
}

/** Find a gene's position in accessor.var.index (or -1 if absent). */
function findVarIndex(accessor: AnnDataAccessor, gene: string): number {
  const idx = accessor.var.index;
  if (Array.isArray(idx)) {
    return idx.indexOf(gene);
  }
  // Numeric var index — try parsing gene as integer
  const n = Number(gene);
  if (!Number.isInteger(n)) return -1;
  for (let i = 0; i < idx.length; i++) {
    if (idx[i] === n) return i;
  }
  return -1;
}

/**
 * Load one column of X (or layer) for a dataset as a length-nObs Float64Array.
 * Works for dense or sparse (CSR/CSC) matrices.
 */
async function loadGeneSlice(
  accessor: AnnDataAccessor,
  varIdx: number,
  layer: string,
  nObs: number,
): Promise<Float64Array> {
  const sliced = accessor.isel({ var: [varIdx] });
  const mat = layer === "X" ? await sliced.getX() : await sliced.getLayer(layer);

  const out = new Float64Array(nObs);

  if ("data" in mat && "shape" in mat) {
    // Dense: shape [nObs, 1] row-major → column 0 is just every element
    const d = mat.data as ArrayLike<number>;
    for (let i = 0; i < nObs; i++) out[i] = d[i];
    return out;
  }

  // Sparse
  const sparse = mat as SparseArray;
  if (sparse.format === "csc") {
    const start = sparse.indptr[0];
    const end = sparse.indptr[1];
    for (let p = start; p < end; p++) {
      out[sparse.indices[p]] = sparse.data[p];
    }
  } else {
    // CSR: one value per row (at most), since we sliced to 1 column
    for (let i = 0; i < nObs; i++) {
      const rs = sparse.indptr[i];
      const re = sparse.indptr[i + 1];
      if (re > rs) out[i] = sparse.data[rs];
    }
  }
  return out;
}

/**
 * Handle GET /api/gene-column/{task_id}/status
 */
export function handleGeneColumnStatus(taskId: string): Response {
  const task = geneTasks.get(taskId);
  if (!task) {
    return Response.json({ error: "Unknown task_id" }, { status: 404 });
  }

  if (task.status === "loading") {
    return Response.json({ status: "loading", column: task.column });
  }
  if (task.status === "ready") {
    return Response.json({ status: "ready", column: task.column });
  }
  return Response.json({ status: "error", column: task.column, error: task.error }, { status: 500 });
}
