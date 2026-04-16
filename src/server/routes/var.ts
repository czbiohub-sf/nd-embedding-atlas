/**
 * Var (gene) name search, layer listing, and gene-expression column endpoints.
 *
 * GET  /api/var/names                 — Search gene names
 * GET  /api/var/layers                — List expression layers
 * POST /api/gene-column               — Start gene column materialization
 * GET  /api/gene-column/{task_id}/status — Poll materialization status
 */

import type { EmbeddingStore } from "../store.ts";

/** In-flight gene column materialization tasks. */
export interface GeneTask {
    taskId: string;
    status: "loading" | "ready" | "error";
    column: string;
    error?: string;
}

/** Module-level state for gene tasks. Keyed by task_id. */
const geneTasks = new Map<string, GeneTask>();

/**
 * Handle GET /api/var/names?q={query}&limit={n}
 *
 * Returns matching gene/variable names. For now returns empty since
 * the axial I/O integration for reading var_names is not yet wired up.
 *
 * TODO: Wire up axial I/O to read var_names from the zarr store.
 */
export async function handleVarNames(url: URL, _store: EmbeddingStore): Promise<Response> {
    const _q = url.searchParams.get("q") ?? "";
    const _limit = Number(url.searchParams.get("limit") ?? "50");

    // TODO: Read var_names from the AnnData accessor via axial I/O
    // For now, return empty — the frontend handles this gracefully.
    return Response.json({ names: [] });
}

/**
 * Handle GET /api/var/layers
 *
 * Returns available expression layer names.
 * TODO: Read layers from the AnnData accessor.
 */
export async function handleVarLayers(_store: EmbeddingStore): Promise<Response> {
    // TODO: Read layer keys from the AnnData accessor via axial I/O
    return Response.json({ layers: ["X"] });
}

/**
 * Handle POST /api/gene-column
 *
 * Starts async materialization of a gene expression column in DuckDB.
 * TODO: Wire up axial I/O for reading gene expression data.
 */
export async function handleGeneColumn(req: Request, _store: EmbeddingStore): Promise<Response> {
    try {
        const body = (await req.json()) as { gene?: string; layer?: string };

        if (!body.gene) {
            return Response.json({ error: "Missing required field: gene" }, { status: 400 });
        }

        const gene = body.gene;
        const layer = body.layer ?? "X";

        // Sanitize column name
        const safeVar = gene.replace(/[^a-zA-Z0-9]/g, "_");
        const safeLayer = layer.replace(/[^a-zA-Z0-9]/g, "_");
        const colName = `__var_${safeVar}_${safeLayer}__`;

        // TODO: Check if column already exists in obs_base
        // TODO: Start async materialization task via axial I/O

        const taskId = crypto.randomUUID();
        const task: GeneTask = {
            taskId,
            status: "error",
            column: colName,
            error: "Gene column materialization not yet implemented in Bun backend",
        };
        geneTasks.set(taskId, task);

        return Response.json(
            { task_id: taskId, status: "loading", column: colName },
            { status: 202 },
        );
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return Response.json({ error: message }, { status: 500 });
    }
}

/**
 * Handle GET /api/gene-column/{task_id}/status
 *
 * Returns the current status of a gene column materialization task.
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
    // error
    return Response.json(
        { status: "error", column: task.column, error: task.error },
        { status: 500 },
    );
}
