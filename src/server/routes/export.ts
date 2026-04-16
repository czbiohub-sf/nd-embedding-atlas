/**
 * Export endpoints — subset and write data.
 *
 * POST /api/export                — Start async export
 * GET  /api/export/{task_id}/status — Poll export status
 *
 * TODO: Wire up actual export logic (zarr write via axial I/O).
 * Currently returns stub responses.
 */

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
 * Handle POST /api/export
 *
 * Starts an async export of the current selection.
 */
export async function handleExport(req: Request, store: EmbeddingStore): Promise<Response> {
    try {
        // Check for concurrent export
        if (currentExport && currentExport.status === "running") {
            return Response.json(
                { error: "An export is already in progress" },
                { status: 409 },
            );
        }

        const body = (await req.json()) as {
            predicate?: string;
            filename?: string;
            selection_type?: string;
            embedding_key?: string | null;
        };

        if (!body.predicate) {
            return Response.json({ error: "Missing required field: predicate" }, { status: 400 });
        }

        // Validate predicate by querying for matching row count
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

        const taskId = crypto.randomUUID().slice(0, 12);

        // TODO: Start actual async export via axial I/O
        // For now, immediately mark as error since export is not yet implemented
        currentExport = {
            taskId,
            status: "error",
            error: "Export not yet implemented in Bun backend",
        };

        return Response.json({ task_id: taskId, status: "running" }, { status: 202 });
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return Response.json({ error: message }, { status: 500 });
    }
}

/**
 * Handle GET /api/export/{task_id}/status
 */
export function handleExportStatus(taskId: string): Response {
    if (!currentExport || currentExport.taskId !== taskId) {
        return Response.json({ error: "Export task not found" }, { status: 404 });
    }

    const { status, outputPath, nObs, error } = currentExport;

    if (status === "running") {
        return Response.json({ status: "running" });
    }
    if (status === "error") {
        return Response.json({ status: "error", error: error ?? "Unknown error" });
    }
    // done
    return Response.json({
        status: "done",
        output_path: outputPath,
        n_obs: nObs,
    });
}
