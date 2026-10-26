/**
 * Var (feature) name search, layer listing, and var-column endpoints.
 *
 * "var" is AnnData's variable dimension: genes for transcriptomics,
 * proteins for proteomics, features for image embeddings, etc. This
 * module is data-type agnostic.
 *
 * GET  /api/var/names                  : Search var names
 * GET  /api/var/layers                 : List expression layers
 * POST /api/var-column                 : Start var column materialization
 * GET  /api/var-column/{task_id}/status: Poll materialization status
 */

import { AnnData, MuData } from "@ndea/zarr";
import type { DatasetHandle } from "@ndea/zarr";
import { VarColumnBodySchema } from "@ndea/protocol";
import { parseBody } from "../request-body.ts";
import type { ServerSession } from "../state.ts";
import { varColumnQuery } from "../zarr-ingest.ts";

/** In-flight var column materialization tasks. */
interface VarTask {
  taskId: string;
  status: "loading" | "ready" | "error";
  column: string;
  error?: string;
}

/** Module-level state for var-column tasks. Keyed by task_id. */
const varTasks = new Map<string, VarTask>();

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Return the first dataset handle in the state (or null if none). */
function firstAdata(state: ServerSession): DatasetHandle | null {
  const iter = state.accessors.values().next();
  return iter.done ? null : iter.value;
}

// ─── Routes ─────────────────────────────────────────────────────────────────

/**
 * Handle GET /api/var/names?q={query}&limit={n}[&modality=]
 *
 * Case-insensitive search over the first dataset's var names (a MuData's
 * named modality, else its shared var): prefix matches first, then
 * contains matches, each in var order. Empty q returns the first `limit`.
 */
export async function handleVarNames(url: URL, state: ServerSession): Promise<Response> {
  const q = (url.searchParams.get("q") ?? "").toLowerCase();
  const limit = Math.max(1, Math.min(500, Number(url.searchParams.get("limit") ?? "50")));
  const modality = url.searchParams.get("modality") ?? undefined;

  const handle = firstAdata(state);
  if (!handle || !state.store.hasVarTable) return Response.json({ names: [] });

  let where = "TRUE";
  const params: Record<string, string> = { q };
  if (handle instanceof MuData) {
    if (modality && !handle.mod.has(modality)) {
      return Response.json({ error: `Unknown modality "${modality}"` }, { status: 404 });
    }
    where = "_modality = $tag";
    params.tag = modality ?? "__shared__";
  } else if (state.accessors.size > 1) {
    where = "_dataset = $tag";
    params.tag = [...state.accessors.keys()][0];
  }

  const reader = await state.store.conn.runAndReadAll(
    `SELECT var_name FROM var_base WHERE ${where} AND contains(lower(var_name), $q) ` +
      `ORDER BY starts_with(lower(var_name), $q) DESC, __var_index__ LIMIT ${limit}`,
    params,
  );
  return Response.json({ names: reader.getColumnsJS()[0] ?? [] });
}

/**
 * Handle GET /api/var/layers
 *
 * Returns available expression layer names. AnnData always has "X" (the
 * primary matrix); extra layers come from the store's `layers` group. MuData
 * layers are per-modality, so a MuData reports only "X".
 */
export async function handleVarLayers(state: ServerSession): Promise<Response> {
  const adata = firstAdata(state);
  const extra = adata instanceof AnnData ? await adata.layerNames() : [];
  return Response.json({ layers: ["X", ...extra] });
}

/**
 * Handle POST /api/var-column  body: { name, layer? }
 *
 * Materialises a var column (one feature's values) aligned to obs_base's
 * `__row_index__` (zarr-ingest.ts `varColumnQuery`): the var's position in
 * each dataset's var_base rows, then a sparse matrix's entries through
 * `read_zarr` (unstored = 0) or a dense matrix's column, NULL for NaN and
 * for datasets without the var; `store.registerVarColumn` materializes it.
 *
 * Returns 202 with { task_id, status: "loading", column }. Poll
 * /api/var-column/{task_id}/status for completion.
 */
export async function handleVarColumn(req: Request, state: ServerSession): Promise<Response> {
  const parsed = await parseBody(req, VarColumnBodySchema);
  if (parsed instanceof Response) return parsed;
  const name = parsed.name;
  const layer = parsed.layer ?? "X";
  const modality = parsed.modality;

  try {
    const safeVar = name.replace(/[^a-zA-Z0-9]/g, "_");
    const safeLayer = layer.replace(/[^a-zA-Z0-9]/g, "_");
    const safeMod = modality?.replace(/[^a-zA-Z0-9]/g, "_");
    // Include modality in the DuckDB column name so the same gene
    // symbol in different modalities doesn't collide.
    const colName = safeMod ? `__var_${safeMod}_${safeVar}_${safeLayer}__` : `__var_${safeVar}_${safeLayer}__`;

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
    void materialiseVarColumn(state, name, layer, colName, modality)
      .then(() => {
        task.status = "ready";
      })
      .catch((err: unknown) => {
        task.status = "error";
        task.error = err instanceof Error ? err.message : String(err);
      });

    return Response.json({ task_id: taskId, status: "loading", column: colName }, { status: 202 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}

// ─── Var column materialization ─────────────────────────────────────────────

async function materialiseVarColumn(
  state: ServerSession,
  name: string,
  layer: string,
  colName: string,
  modality?: string,
): Promise<void> {
  const datasets = [...state.accessors].map(([datasetName, handle]) => ({ name: datasetName, handle }));
  const { query, scratch } = await varColumnQuery(state.store.conn, datasets, { name, layer, modality });
  try {
    await state.store.registerVarColumn(colName, query);
  } finally {
    for (const table of scratch) await state.store.conn.run(`DROP TABLE IF EXISTS ${table}`);
  }
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
