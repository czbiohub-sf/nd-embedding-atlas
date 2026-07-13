/**
 * Export endpoints — subset and write data.
 *
 * POST /api/export                — Start async export
 * GET  /api/export/{task_id}/status — Poll export status
 *
 * Writes the selection to a Parquet file via DuckDB's COPY TO.
 * Default output directory is $NDEA_EXPORT_DIR, else ~/ndea-exports/.
 */

import { access, mkdir } from "node:fs/promises";
import { constants } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { ExportBodySchema, parseJsonBody } from "../protocol.ts";
import type { DatasetQuerySession } from "../store.ts";

/** In-flight export task state. */
export interface ExportTask {
  taskId: string;
  status: "running" | "done" | "error";
  outputPath?: string;
  nObs?: number;
  error?: string;
}

/** Module-level state for export tasks. Single-slot (one export at a time). */
let currentExport: ExportTask | null = null;

/** Subscribers keyed by taskId; fired on status transitions. */
const exportSubscribers = new Map<string, Set<(task: ExportTask) => void>>();

function fireExportStatus(taskId: string): void {
  if (!currentExport || currentExport.taskId !== taskId) return;
  const subs = exportSubscribers.get(taskId);
  if (!subs) return;
  for (const cb of subs) cb(currentExport);
}

/**
 * Subscribe to export-task status transitions. Fires immediately with the
 * current task state, then on every change until disposed. Returns a no-op
 * disposer if the task doesn't exist or has been replaced.
 */
export function subscribeExportTask(taskId: string, cb: (task: ExportTask) => void): () => void {
  if (!currentExport || currentExport.taskId !== taskId) return () => {};
  cb(currentExport);
  let set = exportSubscribers.get(taskId);
  if (!set) {
    set = new Set();
    exportSubscribers.set(taskId, set);
  }
  set.add(cb);
  return () => {
    set.delete(cb);
    if (set.size === 0) exportSubscribers.delete(taskId);
  };
}

export function getExportTask(taskId: string): ExportTask | null {
  if (!currentExport || currentExport.taskId !== taskId) return null;
  return currentExport;
}

/**
 * Returns the directory that new exports should be written to. Creates it
 * on-demand so the frontend can surface the path eagerly in `/data/metadata`.
 */
export function exportDir(): string {
  const env = Bun.env["NDEA_EXPORT_DIR"];
  if (env && env.trim().length > 0) return resolve(env);
  return resolve(join(homedir(), "ndea-exports"));
}

/**
 * GET /api/export-dir
 *
 * Returns the server's resolved default export directory plus a writable
 * probe. Frontend uses this to prefill the export dialog before any user
 * input — avoids hardcoding a path on the client.
 */
export async function handleGetExportDir(): Promise<Response> {
  const path = exportDir();
  let writable = false;
  try {
    await mkdir(path, { recursive: true });
    await access(path, constants.W_OK);
    writable = true;
  } catch {
    writable = false;
  }
  return Response.json({ default_dir: path, writable });
}

/** Sanitise a user-supplied filename into a safe Parquet basename. */
function sanitiseFilename(name: string): string {
  const trimmed = name.trim().replace(/\.parquet$/i, "");
  const safe = trimmed.replace(/[^\w.-]+/g, "_").slice(0, 128);
  return `${safe.length > 0 ? safe : "export"}.parquet`;
}

/** POST /api/export */
export async function handleExport(req: Request, store: DatasetQuerySession): Promise<Response> {
  if (currentExport?.status === "running") {
    return Response.json({ error: "An export is already in progress" }, { status: 409 });
  }

  const parsed = await parseJsonBody(req, ExportBodySchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  try {
    // Validate the predicate up-front by counting matches.
    let matchCount: number;
    try {
      const rows = await store.queryJson(`SELECT COUNT(*) AS cnt FROM dataset WHERE ${body.predicate}`);
      matchCount = Number(rows[0].cnt);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return Response.json({ error: `Invalid predicate: ${message}` }, { status: 400 });
    }

    if (matchCount === 0) {
      return Response.json({ error: "No observations match the predicate" }, { status: 400 });
    }

    // Resolve the output path — caller can override via output_path.
    const baseDir = exportDir();
    let outputPath: string;
    if (body.output_path && body.output_path.trim().length > 0) {
      const raw = body.output_path.trim();
      outputPath = isAbsolute(raw) ? raw : resolve(join(baseDir, raw));
    } else {
      outputPath = join(baseDir, sanitiseFilename(body.filename ?? "export"));
    }

    await mkdir(baseDir, { recursive: true });

    const taskId = crypto.randomUUID().slice(0, 12);
    const task: ExportTask = { taskId, status: "running" };
    currentExport = task;

    // Kick off the COPY asynchronously.
    const predicate = body.predicate;
    void runExport(task, store, predicate, outputPath, matchCount);

    return Response.json({ task_id: taskId, status: "running" }, { status: 202 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}

/** GET /api/export/{task_id}/status */
export function handleExportStatus(taskId: string): Response {
  if (!currentExport || currentExport.taskId !== taskId) {
    return Response.json({ error: "Export task not found" }, { status: 404 });
  }

  const { status, outputPath, nObs, error } = currentExport;

  if (status === "running") return Response.json({ status: "running" });
  if (status === "error") {
    return Response.json({ status: "error", error: error ?? "Unknown error" });
  }
  return Response.json({
    status: "done",
    output_path: outputPath,
    n_obs: nObs,
  });
}

// ─── Internals ──────────────────────────────────────────────────────────────

async function runExport(
  task: ExportTask,
  store: DatasetQuerySession,
  predicate: string,
  outputPath: string,
  matchCount: number,
): Promise<void> {
  try {
    // DuckDB writes Parquet natively via COPY TO.
    // Escape single quotes in the path for safety.
    const escaped = outputPath.replaceAll("'", "''");
    await store.execute(`COPY (SELECT * FROM dataset WHERE ${predicate}) TO '${escaped}' (FORMAT PARQUET)`);
    task.status = "done";
    task.outputPath = outputPath;
    task.nObs = matchCount;
    fireExportStatus(task.taskId);
  } catch (err) {
    task.status = "error";
    task.error = err instanceof Error ? err.message : String(err);
    fireExportStatus(task.taskId);
  }
}
