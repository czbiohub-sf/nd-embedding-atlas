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
import { open, AnnDataAccessor, toArrowTable } from "../zarr/index.ts";
import { tableToIPC, tableFromArrays } from "@uwdata/flechette";
import { EmbeddingStore, DEFAULT_OBSM_PRIORITY } from "../server/store.ts";
import { buildPlateMounts, readPlateMeta } from "../server/plate.ts";
import type { PlateChannel, PlateMount } from "../server/plate.ts";
import { detectSpatialColumns, spatialHiddenColumns } from "../server/state.ts";
import type { DatasetConfig, DatasetMeta, ViewerState } from "../server/state.ts";
import type { ResolvedConfig, DatasetEntry } from "./config.ts";
import { getNetworkAddress } from "./resolve.ts";
import { resolveFrontendDir } from "../server/static.ts";
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

    // Convert each dataset's obs to Arrow table + CSV for DuckDB ingestion
    const datasetObs: Array<{ name: string; arrowTable: any; columnNames: string[] }> = [];

    for (const ds of loaded) {
        const arrowTable = toArrowTable(ds.accessor.obs);
        const columnNames = arrowTable.names as string[];
        datasetObs.push({ name: ds.entry.name, arrowTable, columnNames });
    }

    // Determine obs columns from the first dataset (or config override)
    const firstColumns = datasetObs[0].columnNames;

    // Compute union of all columns across datasets (for multi-dataset alignment)
    const allColumnNames = new Set<string>();
    for (const ds of datasetObs) {
        for (const col of ds.columnNames) allColumnNames.add(col);
    }
    const unionColumns = [...allColumnNames];

    // Build EmbeddingStore via init callback
    const initStore = async (conn: DuckDBConnection): Promise<void> => {
        for (let i = 0; i < datasetObs.length; i++) {
            const { name, arrowTable, columnNames } = datasetObs[i];

            // Write obs as CSV temp file — DuckDB reads CSV natively (no extensions needed)
            const tmpCsvPath = join(tmpdir(), `ndea_obs_${name}_${Date.now()}.csv`);
            await Bun.write(tmpCsvPath, arrowTableToCSV(arrowTable));

            // Build SELECT with NULL padding for missing columns (multi-dataset alignment)
            const selectCols = unionColumns
                .map((col) => (columnNames.includes(col) ? `"${col}"` : `NULL AS "${col}"`))
                .join(", ");

            if (i === 0) {
                if (isMultiDataset) {
                    await conn.run(
                        `CREATE TABLE obs_base AS SELECT '${name}' AS _dataset, ${selectCols} FROM read_csv_auto('${tmpCsvPath}')`,
                    );
                } else {
                    await conn.run(
                        `CREATE TABLE obs_base AS SELECT ${selectCols} FROM read_csv_auto('${tmpCsvPath}')`,
                    );
                }
            } else {
                const insertCols = isMultiDataset
                    ? `'${name}' AS _dataset, ${selectCols}`
                    : selectCols;
                await conn.run(
                    `INSERT INTO obs_base SELECT ${insertCols} FROM read_csv_auto('${tmpCsvPath}')`,
                );
            }

            try {
                await unlink(tmpCsvPath);
            } catch {
                // best-effort cleanup
            }
        }
    };

    // Detect spatial columns and filter internals for the obs column list
    const colSet = new Set(firstColumns);
    const detected = detectSpatialColumns(colSet);
    const hasSpatial =
        detected.fov != null || detected.bbox != null || detected.x != null;
    const spatial = hasSpatial ? detected : null;
    const detectedObsColumns = firstColumns.filter((c) => !c.startsWith("__"));

    const hidden = spatialHiddenColumns(spatial);

    const store = await EmbeddingStore.fromInit(initStore, { hidden });

    // Apply obs column filter if configured
    const obsColumns = config.obsColumns ?? detectedObsColumns;

    console.log(
        `    ${GREEN}✓${RESET} ${formatNumber(store.nObs)} observations loaded into DuckDB`,
    );

    // ── 3. Build ViewerState ────────────────────────────────────────────────
    // Will be passed to createApp once server routes are wired up.

    // Build accessor map for on-demand obsm loading
    const accessors = new Map(loaded.map((ds) => [ds.entry.name, ds.accessor]));

    // Build plate mounts + read minimal HCS metadata (omero channels, scale).
    const plateMounts: PlateMount[] = buildPlateMounts(datasetConfigs, isMultiDataset);
    const platesByDataset = await readPlateMetaForDatasets(plateMounts);

    const state: ViewerState = {
        store,
        datasets: datasetConfigs,
        spatial,
        obsColumns,
        port: config.port,
        availableObsmKeys,
        loadingTasks: new Map(),
        loadErrors: new Map(),
        accessors,
        plateMounts,
    };
    // ── 4. Resolve frontend ─────────────────────────────────────────────────

    let staticDir: string | undefined;
    if (!config.noStatic) {
        staticDir = resolveFrontendDir() ?? undefined;
        if (!staticDir) {
            console.log(
                `\n  ${YELLOW}⚠${RESET}  No frontend dist found. Run ${DIM}cd frontend && vp build${RESET} or use ${DIM}--no-static${RESET}`,
            );
        }
    }

    // ── 5. Start server ─────────────────────────────────────────────────────

    const { createApp } = await import("../server/app.ts");
    const { plateMeta, datasetChannels } = buildPlateMetadata(
        plateMounts,
        platesByDataset,
        isMultiDataset,
    );

    const datasetMeta: DatasetMeta = {
        obsColumnNames: obsColumns,
        embeddingProps: {},
        hasPlate: plateMounts.length > 0,
        plateMeta,
        defaultX: "x",
        defaultY: "y",
        idColumn: "_index",
        datasetKeys: isMultiDataset ? [...datasetConfigs.keys()] : null,
        datasetChannels,
    };

    const server = createApp({
        port: config.port,
        host: config.host,
        store,
        state,
        config: datasetMeta,
        frontendDir: staticDir,
        noStatic: config.noStatic,
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

/**
 * Convert a flechette Arrow Table to CSV string for DuckDB ingestion.
 * DuckDB reads CSV natively — no extensions needed.
 */
function arrowTableToCSV(table: any): string {
    const names: string[] = table.names;
    const numRows: number = table.numRows;
    const columns: any[] = names.map((_: string, i: number) => table.getChildAt(i));

    const lines: string[] = [names.map(csvEscape).join(",")];

    for (let r = 0; r < numRows; r++) {
        const row: string[] = [];
        for (let c = 0; c < columns.length; c++) {
            const val = columns[c].at(r);
            if (val == null) {
                row.push("");
            } else {
                row.push(csvEscape(String(val)));
            }
        }
        lines.push(row.join(","));
    }

    return lines.join("\n") + "\n";
}

function csvEscape(val: string): string {
    if (val.includes(",") || val.includes('"') || val.includes("\n")) {
        return `"${val.replace(/"/g, '""')}"`;
    }
    return val;
}

/** Read plate metadata for each mount in parallel. */
async function readPlateMetaForDatasets(
    mounts: readonly PlateMount[],
): Promise<Map<string /* mount */, Awaited<ReturnType<typeof readPlateMeta>>>> {
    const entries = await Promise.all(
        mounts.map(async (m) => [m.mount, await readPlateMeta(m.diskPath)] as const),
    );
    return new Map(entries);
}

/**
 * Derive the plate sub-object embedded in /data/metadata.json
 * (plate_stores, plate_channels, plate_pixel_scale, plate_ome_version)
 * plus the per-dataset channel mapping.
 */
function buildPlateMetadata(
    mounts: readonly PlateMount[],
    metaByMount: Map<string, Awaited<ReturnType<typeof readPlateMeta>>>,
    isMultiDataset: boolean,
): {
    plateMeta: Record<string, unknown> | null;
    datasetChannels: Record<string, PlateChannel[]> | null;
} {
    if (mounts.length === 0) return { plateMeta: null, datasetChannels: null };

    const plateStores: Array<{ mount: string; name: string; ome_version: "0.4" | "0.5" }> = [];
    const datasetChannels: Record<string, PlateChannel[]> = {};

    // Prefer 0.5 if any dataset declares it, so the frontend picks the newer reader.
    let globalOmeVersion: "0.4" | "0.5" = "0.4";
    let firstChannels: PlateChannel[] | null = null;
    let firstPixelScale: { x: number; y: number } | null = null;

    for (const m of mounts) {
        const info = metaByMount.get(m.mount);
        const ome = info?.omeVersion ?? "0.4";
        if (ome === "0.5") globalOmeVersion = "0.5";

        const name = m.datasetKey ?? "";
        plateStores.push({ mount: m.mount, name, ome_version: ome });

        if (info && name) datasetChannels[name] = info.channels;
        if (!firstChannels && info) firstChannels = info.channels;
        if (!firstPixelScale && info) firstPixelScale = info.pixelScale;
    }

    const plateMeta: Record<string, unknown> = {
        plate_stores: plateStores,
        plate_ome_version: globalOmeVersion,
    };
    if (firstChannels) plateMeta.plate_channels = firstChannels;
    if (firstPixelScale) plateMeta.plate_pixel_scale = firstPixelScale;

    return {
        plateMeta,
        datasetChannels:
            isMultiDataset && Object.keys(datasetChannels).length > 0 ? datasetChannels : null,
    };
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
