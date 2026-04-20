/**
 * Var (feature) name search, layer listing, and var-column endpoints.
 *
 * "var" is AnnData's variable dimension — genes for transcriptomics,
 * proteins for proteomics, features for image embeddings, etc. This
 * module is data-type agnostic.
 *
 * GET  /api/var/names                   — Search var names
 * GET  /api/var/layers                  — List expression layers
 * POST /api/var-column                  — Start var column materialization
 * GET  /api/var-column/{task_id}/status — Poll materialization status
 */

import type { AnnData, DatasetHandle } from "../../zarr/anndata.ts";
import type { SparseArray } from "../../zarr/types.ts";
import { VarColumnBodySchema, parseJsonBody } from "../protocol.ts";
import type { ViewerState } from "../state.ts";

/** In-flight var column materialization tasks. */
export interface VarTask {
  taskId: string;
  status: "loading" | "ready" | "error";
  column: string;
  error?: string;
}

/** Module-level state for var-column tasks. Keyed by task_id. */
const varTasks = new Map<string, VarTask>();

/** Per-task subscribers notified on status transitions. */
const varSubscribers = new Map<string, Set<(task: VarTask) => void>>();

function fireVarStatus(taskId: string): void {
  const task = varTasks.get(taskId);
  const subs = varSubscribers.get(taskId);
  if (!task || !subs) return;
  for (const cb of subs) cb(task);
}

/**
 * Subscribe to var-task status transitions. Fires immediately with the
 * current task state, then on every status change until disposed.
 * Returns a no-op disposer if the task doesn't exist.
 */
export function subscribeVarTask(taskId: string, cb: (task: VarTask) => void): () => void {
  const task = varTasks.get(taskId);
  if (!task) return () => {};
  cb(task);
  let set = varSubscribers.get(taskId);
  if (!set) {
    set = new Set();
    varSubscribers.set(taskId, set);
  }
  set.add(cb);
  return () => {
    set.delete(cb);
    if (set.size === 0) varSubscribers.delete(taskId);
  };
}

export function getVarTask(taskId: string): VarTask | undefined {
  return varTasks.get(taskId);
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Return the first dataset handle in the state (or null if none). */
function firstAdata(state: ViewerState): DatasetHandle | null {
  const iter = state.accessors.values().next();
  return iter.done ? null : iter.value;
}

/**
 * Materialise var.index as a plain string array.
 *
 * For MuData, var.index is the shared root var — typically empty on
 * axis=0 stores where each modality owns its own var. A follow-up will
 * pull names from the union of per-modality var. For this PR we return
 * the root-level index as-is.
 */
function varNamesOf(adata: DatasetHandle): string[] {
  const idx = adata.var.index;
  if (Array.isArray(idx)) return [...idx];
  const typed = idx as Int32Array;
  const out: string[] = [];
  for (let i = 0; i < typed.length; i++) out.push(String(typed[i]));
  return out;
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
  const modality = url.searchParams.get("modality") ?? undefined;

  const handle = firstAdata(state);
  if (!handle) return Response.json({ names: [] });

  // MuData: resolve to the named modality's AnnData.
  let source: DatasetHandle = handle;
  if (handle.kind === "mudata" && modality) {
    const mu = handle as unknown as { mod: ReadonlyMap<string, DatasetHandle> };
    const modHandle = mu.mod.get(modality);
    if (!modHandle) {
      return Response.json({ error: `Unknown modality "${modality}"` }, { status: 404 });
    }
    source = modHandle;
  }

  const names = varNamesOf(source);

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
  const adata = firstAdata(state);
  if (!adata) return Response.json({ layers: ["X"] });

  // Try to discover extra layers by probing the zarr `layers` group.
  // The accessor doesn't currently expose this, so we fall back to ["X"]
  // unless we can read layer keys via a private hook in the future.
  const extra = await discoverLayers(adata);
  const all = ["X", ...extra];
  return Response.json({ layers: all });
}

/**
 * Probe the zarr store for `layers/` children. Returns [] if not accessible.
 * Uses the accessor's internal zarr group reference if available.
 *
 * AnnData only — MuData's layers are per-modality; a cross-modality layer
 * listing is a follow-up. For MuData, return [] so callers fall back to
 * the default "X".
 */
async function discoverLayers(adata: DatasetHandle): Promise<string[]> {
  if (adata.kind !== "anndata") return [];
  const anndata = adata as AnnData;
  // Reach through AnnData → internal accessor → private _group (zarrita
  // Location). Hack pending Phase C's AnnDataView API; then we'll expose
  // a proper `listLayers()` method.
  const group = (anndata.accessor as unknown as { _group?: unknown })._group;
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
 * Handle POST /api/var-column  body: { name, layer? }
 *
 * Materialises a var column (one feature's values) aligned to obs_base's
 * `__row_index__`:
 *   1. For each dataset, find name's position in var.index
 *   2. isel({ var: [idx] }).getX() → length-nObs column (NaN where missing)
 *   3. Concatenate in obs_base insertion order → Float64Array of length nObs
 *   4. store.registerVarColumn(colName, values) → table + VIEW rebuild
 *
 * Returns 202 with { task_id, status: "loading", column }. Poll
 * /api/var-column/{task_id}/status for completion.
 */
export async function handleVarColumn(req: Request, state: ViewerState): Promise<Response> {
  const parsed = await parseJsonBody(req, VarColumnBodySchema);
  if (!parsed.ok) return parsed.response;
  const name = parsed.data.name;
  const layer = parsed.data.layer ?? "X";

  try {
    const safeVar = name.replace(/[^a-zA-Z0-9]/g, "_");
    const safeLayer = layer.replace(/[^a-zA-Z0-9]/g, "_");
    const colName = `__var_${safeVar}_${safeLayer}__`;

    const taskId = crypto.randomUUID();

    // Short-circuit if the column already exists.
    if (state.store.hasVarColumn(colName)) {
      const task: VarTask = { taskId, status: "ready", column: colName };
      varTasks.set(taskId, task);
      return Response.json({ task_id: taskId, status: "ready", column: colName });
    }

    const task: VarTask = { taskId, status: "loading", column: colName };
    varTasks.set(taskId, task);

    // Kick off materialization asynchronously.
    void materialiseVarColumn(state, name, layer, colName)
      .then(() => {
        task.status = "ready";
        fireVarStatus(taskId);
      })
      .catch((err: unknown) => {
        task.status = "error";
        task.error = err instanceof Error ? err.message : String(err);
        fireVarStatus(taskId);
      });

    return Response.json({ task_id: taskId, status: "loading", column: colName }, { status: 202 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}

// ─── Var column materialization ─────────────────────────────────────────────

async function materialiseVarColumn(state: ViewerState, name: string, layer: string, colName: string): Promise<void> {
  const nObs = state.store.nObs;
  const values = new Float64Array(nObs);
  values.fill(Number.NaN);

  // Iterate datasets in insertion order (same order as obs_base was built).
  let cursor = 0;
  for (const [dsName, handle] of state.accessors) {
    const dsN = handle.nObs;
    // MuData var loading is per-modality — requires picking which modality
    // owns `name`. Deferred to the modality-aware UX work; skip MuData
    // datasets here so the non-MuData path stays functional.
    if (handle.kind !== "anndata") {
      cursor += dsN;
      continue;
    }
    const adata = handle as AnnData;
    const varIdx = findVarIndex(adata, name);

    if (varIdx >= 0) {
      const slice = await loadVarSlice(adata, varIdx, layer, dsN);
      values.set(slice, cursor);
    } // else: leave NaN for this dataset
    cursor += dsN;

    // Silence unused-var warning for dsName
    void dsName;
  }

  if (cursor !== nObs) {
    throw new Error(`Var column row alignment mismatch: obs_base.nObs=${nObs} but accessors sum to ${cursor}`);
  }

  await state.store.registerVarColumn(colName, values);
}

/** Find a var name's position in adata.var.index (or -1 if absent). */
function findVarIndex(adata: AnnData | DatasetHandle, name: string): number {
  const idx = adata.var.index;
  if (Array.isArray(idx)) {
    return idx.indexOf(name);
  }
  // Numeric var index — try parsing name as integer
  const n = Number(name);
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
async function loadVarSlice(adata: AnnData, varIdx: number, layer: string, nObs: number): Promise<Float64Array> {
  const sliced = adata.isel({ var: [varIdx] });
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
 * Handle GET /api/var-column/{task_id}/status
 */
export function handleVarColumnStatus(taskId: string): Response {
  const task = varTasks.get(taskId);
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
