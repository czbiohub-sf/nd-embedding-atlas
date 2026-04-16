/**
 * Export endpoints — subset and write data.
 *
 * POST /api/export                — Start async export
 * GET  /api/export/{task_id}/status — Poll export status
 *
 * Writes the selection to a Parquet file via DuckDB's COPY TO.
 * Default output directory is $NDEA_EXPORT_DIR, else ~/ndea-exports/.
 */

import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import type { EmbeddingStore } from "../store.ts";

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

/**
 * Returns the directory that new exports should be written to. Creates it
 * on-demand so the frontend can surface the path eagerly in `/data/metadata`.
 */
export function exportDir(): string {
    const env = Bun.env["NDEA_EXPORT_DIR"];
    if (env && env.trim().length > 0) return resolve(env);
    return resolve(join(homedir(), "ndea-exports"));
}

/** Sanitise a user-supplied filename into a safe Parquet basename. */
function sanitiseFilename(name: string): string {
    const trimmed = name.trim().replace(/\.parquet$/i, "");
    const safe = trimmed.replace(/[^\w.\-]+/g, "_").slice(0, 128);
    return (safe.length > 0 ? safe : "export") + ".parquet";
}

/** POST /api/export */
export async function handleExport(req: Request, store: EmbeddingStore): Promise<Response> {
    try {
        if (currentExport && currentExport.status === "running") {
            return Response.json({ error: "An export is already in progress" }, { status: 409 });
        }

        const body = (await req.json()) as {
            predicate?: string;
            filename?: string;
            output_path?: string;
            selection_type?: string;
            embedding_key?: string | null;
        };

        if (!body.predicate) {
            return Response.json({ error: "Missing required field: predicate" }, { status: 400 });
        }

        // Validate the predicate up-front by counting matches.
        let matchCount: number;
        try {
            const rows = await store.queryJson(
                `SELECT COUNT(*) AS cnt FROM dataset WHERE ${body.predicate}`,
            );
            matchCount = Number(rows[0].cnt);
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return Response.json({ error: `Invalid predicate: ${message}` }, { status: 400 });
        }

        if (matchCount === 0) {
            return Response.json(
                { error: "No observations match the predicate" },
                { status: 400 },
            );
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
    store: EmbeddingStore,
    predicate: string,
    outputPath: string,
    matchCount: number,
): Promise<void> {
    try {
        // DuckDB writes Parquet natively via COPY TO.
        // Escape single quotes in the path for safety.
        const escaped = outputPath.replaceAll("'", "''");
        await store.execute(
            `COPY (SELECT * FROM dataset WHERE ${predicate}) TO '${escaped}' (FORMAT PARQUET)`,
        );
        task.status = "done";
        task.outputPath = outputPath;
        task.nObs = matchCount;
    } catch (err) {
        task.status = "error";
        task.error = err instanceof Error ? err.message : String(err);
    }
}
