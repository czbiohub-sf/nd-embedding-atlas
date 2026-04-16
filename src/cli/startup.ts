/**
 * Startup orchestration — open stores, prepare data, launch server.
 *
 * Coordinates the full startup sequence:
 *   1. Open zarr stores via axial
 *   2. Convert obs DataFrames to Arrow IPC, inject _dataset column
 *   3. Init EmbeddingStore from Arrow IPC via DuckDB
 *   4. Build ViewerState
 *   5. Create and start server
 *   6. Auto-open browser
 *   7. Handle graceful shutdown
 */

import { unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { open, AnnDataAccessor, toArrowTable } from "../axial/index.ts";
import { tableToIPC } from "@uwdata/flechette";
import { EmbeddingStore, DEFAULT_OBSM_PRIORITY } from "../server/store.ts";
import { prepareObs } from "../server/prepare.ts";
import { spatialHiddenColumns } from "../server/state.ts";
import type { DatasetConfig, ViewerState } from "../server/state.ts";
import type { ResolvedConfig, DatasetEntry } from "./config.ts";
import { resolveFrontendDir, getNetworkAddress } from "./resolve.ts";
import type { DuckDBConnection } from "@duckdb/node-api";

// ─── ANSI helpers ───────────────────────────────────────────────────────────

const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const CYAN = "\x1b[36m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const RESET = "\x1b[0m";

function formatNumber(n: number): string {
    return n.toLocaleString("en-US");
}

// ─── Loaded dataset info ────────────────────────────────────────────────────

interface LoadedDataset {
    entry: DatasetEntry;
    accessor: AnnDataAccessor;
    obsmKeys: string[];
}

// ─── Main startup ───────────────────────────────────────────────────────────

export async function startup(config: ResolvedConfig): Promise<void> {
    const startTime = performance.now();

    // Print banner
    console.log(`\n  ${BOLD}nd-embedding-atlas${RESET} ${DIM}v0.1.0${RESET}\n`);

    // ── 1. Open zarr stores ─────────────────────────────────────────────────

    console.log(`  ${DIM}Opening ${config.datasets.length} dataset(s)...${RESET}`);
    const loaded: LoadedDataset[] = [];

    for (const ds of config.datasets) {
        try {
            const tree = await open(ds.path);
            const accessor = AnnDataAccessor.from(tree);

            // Discover available obsm keys
            const obsmKeys = await discoverObsmKeys(accessor);

            loaded.push({ entry: ds, accessor, obsmKeys });
            console.log(
                `    ${GREEN}✓${RESET} ${ds.name}  ${DIM}${formatNumber(accessor.nObs)} obs × ${formatNumber(accessor.nVar)} var${RESET}`,
            );
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(`    ${RED}✗${RESET} ${ds.name}: ${msg}`);
            process.exit(1);
        }
    }

    // ── 2. Prepare obs data ─────────────────────────────────────────────────

    console.log(`\n  ${DIM}Preparing obs metadata...${RESET}`);

    const isMultiDataset = loaded.length > 1;

    // Build combined Parquet via DuckDB init callback
    // For each dataset: convert obs → Arrow IPC → register as temp table → UNION ALL into obs_base
    const allObsmKeys = new Set<string>();
    const datasetConfigs = new Map<string, DatasetConfig>();

    for (const ds of loaded) {
        for (const key of ds.obsmKeys) allObsmKeys.add(key);
        datasetConfigs.set(ds.entry.name, {
            path: ds.entry.path,
            platePath: ds.entry.platePath,
            channels: ds.entry.channels,
        });
    }

    // Determine which obsm keys are available across all datasets
    const availableObsmKeys = sortObsmKeys([...allObsmKeys]);

    // Convert each dataset's obs to Arrow IPC bytes
    const datasetArrows: Array<{ name: string; ipcBytes: Uint8Array; columnNames: string[] }> = [];

    for (const ds of loaded) {
        const arrowTable = toArrowTable(ds.accessor.obs);
        const columnNames = arrowTable.names as string[];
        const ipcBytes = tableToIPC(arrowTable);
        datasetArrows.push({ name: ds.entry.name, ipcBytes: new Uint8Array(ipcBytes), columnNames });
    }

    // Determine obs columns from the first dataset (or config override)
    const firstColumns = datasetArrows[0].columnNames;

    // Build EmbeddingStore via init callback
    const initStore = async (conn: DuckDBConnection): Promise<void> => {
        // Write each dataset's Arrow IPC to a temp file, load into DuckDB
        for (let i = 0; i < datasetArrows.length; i++) {
            const { name, ipcBytes } = datasetArrows[i];

            // Write Arrow IPC to a temp file so DuckDB can read it
            const tmpIpcPath = join(tmpdir(), `ndea_obs_${name}_${Date.now()}.arrow`);
            await Bun.write(tmpIpcPath, ipcBytes);

            // DuckDB can read Arrow IPC files directly
            if (i === 0) {
                if (isMultiDataset) {
                    await conn.run(
                        `CREATE TABLE obs_base AS SELECT '${name}' AS _dataset, * FROM '${tmpIpcPath}'`,
                    );
                } else {
                    await conn.run(`CREATE TABLE obs_base AS SELECT * FROM '${tmpIpcPath}'`);
                }
            } else {
                await conn.run(
                    `INSERT INTO obs_base SELECT '${name}' AS _dataset, * FROM '${tmpIpcPath}'`,
                );
            }

            // Clean up temp file
            try {
                await unlink(tmpIpcPath);
            } catch {
                // best-effort cleanup
            }
        }
    };

    // Prepare obs result for spatial detection and column filtering
    const prepResult = prepareObs(
        datasetArrows[0].ipcBytes,
        firstColumns,
        isMultiDataset ? loaded[0].entry.name : undefined,
    );

    const hidden = spatialHiddenColumns(prepResult.spatial);

    const store = await EmbeddingStore.fromInit(initStore, { hidden });

    // Apply obs column filter if configured
    const obsColumns = config.obsColumns ?? prepResult.obsColumns;

    console.log(
        `    ${GREEN}✓${RESET} ${formatNumber(store.nObs)} observations loaded into DuckDB`,
    );

    // ── 3. Build ViewerState ────────────────────────────────────────────────
    // Will be passed to createApp once server routes are wired up.

    const state: ViewerState = {
        store,
        datasets: datasetConfigs,
        spatial: prepResult.spatial,
        obsColumns,
        port: config.port,
        availableObsmKeys,
        loadingTasks: new Map(),
        loadErrors: new Map(),
    };
    void state;

    // ── 4. Resolve frontend ─────────────────────────────────────────────────

    let staticDir: string | undefined;
    if (!config.noStatic) {
        staticDir = resolveFrontendDir();
        if (!staticDir) {
            console.log(
                `\n  ${YELLOW}⚠${RESET}  No frontend dist found. Run ${DIM}cd frontend && vp build${RESET} or use ${DIM}--no-static${RESET}`,
            );
        }
    }

    // ── 5. Start server ─────────────────────────────────────────────────────

    // Import createApp — it may still be a stub from Phase 2
    const { createApp } = await import("../server/app.ts");
    const app = createApp();

    // If createApp returns a real server config, use Bun.serve.
    // Otherwise fall back to a minimal health-check server so the CLI is testable.
    const server = Bun.serve({
        port: config.port,
        hostname: config.host,
        fetch: app?.fetch ??
            (async (_req: Request): Promise<Response> => {
                const url = new URL(_req.url);

                if (url.pathname === "/health") {
                    return Response.json({ status: "ok", nObs: store.nObs });
                }

                // Serve static frontend files if available
                if (staticDir && _req.method === "GET") {
                    const filePath = join(staticDir, url.pathname === "/" ? "index.html" : url.pathname);
                    const file = Bun.file(filePath);
                    if (await file.exists()) {
                        return new Response(file);
                    }
                    // SPA fallback — serve index.html for unmatched routes
                    const indexFile = Bun.file(join(staticDir, "index.html"));
                    if (await indexFile.exists()) {
                        return new Response(indexFile);
                    }
                }

                return Response.json({ error: "Not found" }, { status: 404 });
            }),
    });

    // ── 6. Print startup info ───────────────────────────────────────────────

    const elapsed = ((performance.now() - startTime) / 1000).toFixed(1);
    const networkAddr = getNetworkAddress();

    console.log(`\n  ${BOLD}Datasets:${RESET}`);
    for (const ds of loaded) {
        const plateTag = ds.entry.platePath ? ` ${DIM}+ plate${RESET}` : "";
        console.log(
            `    ${ds.entry.name}  ${DIM}${formatNumber(ds.accessor.nObs)} obs × ${formatNumber(ds.accessor.nVar)} var${RESET}${plateTag}`,
        );
    }

    if (availableObsmKeys.length > 0) {
        console.log(`\n  ${BOLD}Embeddings:${RESET} ${DIM}${availableObsmKeys.join(", ")}${RESET}`);
    }

    console.log(`\n  ${BOLD}Server:${RESET}`);
    console.log(`    ${CYAN}Local:${RESET}   http://${config.host}:${config.port}`);
    if (networkAddr && config.host !== "127.0.0.1") {
        console.log(`    ${CYAN}Network:${RESET} http://${networkAddr}:${config.port}`);
    }
    console.log(`\n  ${DIM}Ready in ${elapsed}s${RESET}`);

    // ── 7. Auto-open browser ────────────────────────────────────────────────

    if (!config.noOpen) {
        const url = `http://${config.host}:${config.port}`;
        try {
            if (process.platform === "darwin") {
                Bun.spawn(["open", url]);
            } else if (process.platform === "linux") {
                Bun.spawn(["xdg-open", url]);
            }
        } catch {
            // Non-critical — user can open manually
        }
    }

    // ── 8. Graceful shutdown ────────────────────────────────────────────────

    console.log(`\n  ${DIM}Press Ctrl+C to stop${RESET}\n`);

    const shutdown = () => {
        console.log(`\n  ${DIM}Shutting down...${RESET}`);
        server.stop();
        store.close();
        process.exit(0);
    };

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Discover obsm keys by probing the zarr group for known embedding paths.
 *
 * Since AnnDataAccessor doesn't expose the obsm keys directly,
 * we try loading known embedding names and catch failures.
 */
async function discoverObsmKeys(accessor: AnnDataAccessor): Promise<string[]> {
    const keys: string[] = [];

    // Try common embedding keys
    const candidates = [
        "X_umap",
        "X_tsne",
        "X_phate",
        "X_pca",
        "X_scvi",
        "X_draw_graph_fr",
        "X_diffmap",
        "X_harmony",
        "X_scanorama",
    ];

    for (const key of candidates) {
        try {
            // Just try to access — if it throws, the key doesn't exist
            await accessor.getObsm(key);
            keys.push(key);
        } catch {
            // Key doesn't exist — skip
        }
    }

    return keys;
}

/** Sort obsm keys by priority (UMAP > tSNE > PHATE > PCA > rest). */
function sortObsmKeys(keys: string[]): string[] {
    const priorityMap = new Map(DEFAULT_OBSM_PRIORITY.map((k, i) => [k, i]));
    return keys.sort((a, b) => {
        const pa = priorityMap.get(a) ?? 999;
        const pb = priorityMap.get(b) ?? 999;
        if (pa !== pb) return pa - pb;
        return a.localeCompare(b);
    });
}
