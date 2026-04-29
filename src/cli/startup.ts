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

import { open, AnnData, MuData, ingestDataFrames } from "../zarr/index.ts";
import type { DatasetHandle } from "../zarr/anndata.ts";
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
  adata: DatasetHandle;
  obsmKeys: string[];
}

function countVars(adata: DatasetHandle): number {
  if (adata.kind === "anndata") return (adata as AnnData).nVars;
  const m = adata as MuData;
  // MuData nVars is the sum across modalities (shared root var is usually
  // empty on axis=0; each modality owns its own var).
  let vars = m.var.length;
  for (const modAdata of m.mod.values()) vars += modAdata.nVars;
  return vars;
}

async function openOneDataset(ds: DatasetEntry): Promise<LoadedDataset> {
  const parsed = await open(ds.path);
  let adata: DatasetHandle;
  if (parsed.kind === "anndata") {
    adata = AnnData.from(parsed);
  } else if (parsed.kind === "mudata") {
    adata = MuData.from(parsed);
  } else {
    throw new Error(`${ds.name}: store is ${parsed.kind}, not AnnData/MuData`);
  }
  const obsmKeys = await discoverObsmKeys(adata);
  return { entry: ds, adata, obsmKeys };
}

async function openDatasets(config: ResolvedConfig): Promise<LoadedDataset[]> {
  console.log(`  ${DIM}Opening ${config.datasets.length} dataset(s)...${RESET}`);
  const loaded: LoadedDataset[] = [];
  for (const ds of config.datasets) {
    try {
      const result = await openOneDataset(ds);
      loaded.push(result);
      console.log(
        `    ${GREEN}✓${RESET} ${ds.name}  ${DIM}${formatNumber(result.adata.nObs)} obs × ${formatNumber(countVars(result.adata))} var${RESET}`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`    ${RED}✗${RESET} ${ds.name}: ${msg}`);
      process.exit(1);
    }
  }
  return loaded;
}

function buildIngestCallbacks(
  loaded: readonly LoadedDataset[],
  datasetNames: string[],
): {
  initStore: (conn: DuckDBConnection) => Promise<void>;
  initVar: (conn: DuckDBConnection) => Promise<void>;
} {
  const hasMuData = loaded.some((ds) => ds.adata.kind === "mudata");
  if (hasMuData) {
    // MuData owns both obs (collision-merged across modalities) and var
    // (unioned with `_modality` discriminator). Route both through
    // MuData.toDuckDB so the merge logic stays in one place.
    const muHandle = loaded[0].adata as MuData;
    return {
      initStore: (conn) => muHandle.toDuckDB(conn, { skipVar: true }),
      initVar: (conn) => muHandle.toDuckDB(conn, { skipObs: true }),
    };
  }
  return {
    initStore: async (conn) => {
      await ingestDataFrames(
        conn,
        "obs_base",
        loaded.map((ds) => ds.adata.obs),
        { datasetNames },
      );
    },
    initVar: async (conn) => {
      await ingestDataFrames(
        conn,
        "var_base",
        loaded.map((ds) => ds.adata.var),
        { datasetNames, axis: "var", includeNameColumn: true },
      );
    },
  };
}

interface ObsPrep {
  isMultiDataset: boolean;
  spatial: ReturnType<typeof detectSpatialColumns> | null;
  hidden: ReturnType<typeof spatialHiddenColumns>;
  detectedObsColumns: string[];
  datasetConfigs: Map<string, DatasetConfig>;
  availableObsmKeys: string[];
}

function prepareObsMetadata(loaded: readonly LoadedDataset[]): ObsPrep {
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

  const firstColumns = [...loaded[0].adata.obs.columns];
  const detected = detectSpatialColumns(new Set(firstColumns));
  const hasSpatial = detected.fov != null || detected.bbox != null || detected.x != null;
  const spatial = hasSpatial ? detected : null;

  return {
    isMultiDataset: loaded.length > 1,
    spatial,
    hidden: spatialHiddenColumns(spatial),
    detectedObsColumns: firstColumns.filter((c) => !c.startsWith("__")),
    datasetConfigs,
    availableObsmKeys: sortObsmKeys([...allObsmKeys]),
  };
}

function printStartupSummary(
  loaded: readonly LoadedDataset[],
  availableObsmKeys: readonly string[],
  config: ResolvedConfig,
  startTime: number,
): void {
  const elapsed = ((performance.now() - startTime) / 1000).toFixed(1);
  const networkAddr = getNetworkAddress();

  console.log(`\n  ${BOLD}Datasets:${RESET}`);
  for (const ds of loaded) {
    const plateTag = ds.entry.platePath ? ` ${DIM}+ plate${RESET}` : "";
    console.log(
      `    ${ds.entry.name}  ${DIM}${formatNumber(ds.adata.nObs)} obs × ${formatNumber(countVars(ds.adata))} var${RESET}${plateTag}`,
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
}

function maybeOpenBrowser(host: string, port: number): void {
  const url = `http://${host}:${port}`;
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

// ─── Main startup ───────────────────────────────────────────────────────────

export async function startup(config: ResolvedConfig): Promise<void> {
  const startTime = performance.now();

  // In dev (--no-static or NDEA_NO_STATIC), bridge backend errors into Vite's
  // HMR overlay so uncaught exceptions show up as a red panel in the browser
  // instead of a silent terminal crash.
  if (config.noStatic || process.env.NDEA_NO_STATIC === "1") {
    installDevErrorBridge();
  }

  // Print banner
  console.log(`\n  ${BOLD}nd-embedding-atlas${RESET} ${DIM}v0.1.0${RESET}\n`);

  // ── 1. Open zarr stores ─────────────────────────────────────────────────
  const loaded = await openDatasets(config);

  // ── 2. Prepare obs data ─────────────────────────────────────────────────

  console.log(`\n  ${DIM}Preparing obs metadata...${RESET}`);
  const prep = prepareObsMetadata(loaded);

  // MuData: currently supported only as a single dataset. Multi-dataset
  // unions mixing AnnData + MuData (or multiple MuData stores) are not
  // supported yet — the per-modality var structure differs and merging
  // requires a separate design. Reject loudly.
  if (loaded.some((ds) => ds.adata.kind === "mudata") && loaded.length > 1) {
    console.error(`    ${RED}✗${RESET} Multi-dataset unions with MuData are not supported yet.`);
    process.exit(1);
  }

  const datasetNames = loaded.map((ds) => ds.entry.name);
  const { initStore, initVar } = buildIngestCallbacks(loaded, datasetNames);
  const store = await EmbeddingStore.fromInit(initStore, { hidden: prep.hidden, initVar });

  const obsColumns = config.obsColumns ?? prep.detectedObsColumns;

  console.log(`    ${GREEN}✓${RESET} ${formatNumber(store.nObs)} observations loaded into DuckDB`);
  if (store.hasVarTable) {
    console.log(`    ${GREEN}✓${RESET} ${formatNumber(store.nVars)} variables loaded into DuckDB (var_base)`);
  }

  // ── 3. Build ViewerState ────────────────────────────────────────────────
  const accessors = new Map(loaded.map((ds) => [ds.entry.name, ds.adata]));
  const plateMounts: PlateMount[] = buildPlateMounts(prep.datasetConfigs, prep.isMultiDataset);
  const platesByDataset = await readPlateMetaForDatasets(plateMounts);

  const state: ViewerState = {
    store,
    datasets: prep.datasetConfigs,
    spatial: prep.spatial,
    obsColumns,
    port: config.port,
    availableObsmKeys: prep.availableObsmKeys,
    loadingTasks: new Map(),
    loadErrors: new Map(),
    accessors,
    plateMounts,
    obsmLoaders: new Map(),
  };

  // ── 4. Resolve frontend ─────────────────────────────────────────────────
  const staticDir = config.noStatic ? undefined : (resolveFrontendDir() ?? undefined);
  if (!config.noStatic && !staticDir) {
    console.log(
      `\n  ${YELLOW}⚠${RESET}  No frontend dist found. Run ${DIM}vp build${RESET} (or ${DIM}vp run dev${RESET} for dev mode with Vite HMR).`,
    );
  }

  // ── 5. Start server ─────────────────────────────────────────────────────
  const { createApp } = await import("../server/app.ts");
  const { plateMeta, datasetChannels } = buildPlateMetadata(plateMounts, platesByDataset, prep.isMultiDataset);

  const datasetMeta: DatasetMeta = {
    obsColumnNames: obsColumns,
    embeddingProps: {},
    hasPlate: plateMounts.length > 0,
    plateMeta,
    defaultX: "x",
    defaultY: "y",
    idColumn: "_index",
    datasetKeys: prep.isMultiDataset ? [...prep.datasetConfigs.keys()] : null,
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
  printStartupSummary(loaded, prep.availableObsmKeys, config, startTime);

  // ── 7. Auto-open browser ────────────────────────────────────────────────
  // `NDEA_NO_OPEN=1` is an unambiguous escape hatch for callers that spawn
  // the backend programmatically (e.g. `scripts/dev.ts`), since citty's
  // parse of `--no-open` depends on how the flag is declared.
  if (!(config.noOpen || process.env.NDEA_NO_OPEN === "1")) {
    maybeOpenBrowser(config.host, config.port);
  }

  // ── 8. Graceful shutdown ────────────────────────────────────────────────

  console.log(`\n  ${DIM}Press Ctrl+C to stop${RESET}\n`);

  const shutdown = () => {
    console.log(`\n  ${DIM}Shutting down...${RESET}`);
    void server.stop();
    store.close();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Discover obsm embedding keys present under the zarr store's `obsm/` group.
 *
 * Prefers filesystem `readdir` via `accessor.listObsmKeys()` — surfaces
 * arbitrary user-defined embedding names, not just a hardcoded shortlist.
 * Falls back to probing a common candidate list for stores without a local
 * filesystem path (e.g. HTTP / in-memory).
 */
async function discoverObsmKeys(adata: DatasetHandle): Promise<string[]> {
  const listed = await adata.listObsmKeys();
  if (listed) return listed;

  // Fallback: probe known keys for non-filesystem stores.
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
  const keys: string[] = [];
  for (const key of candidates) {
    try {
      await adata.getObsm(key);
      keys.push(key);
    } catch {
      /* not present */
    }
  }
  return keys;
}

/** Read plate metadata for each mount in parallel. */
async function readPlateMetaForDatasets(
  mounts: readonly PlateMount[],
): Promise<Map<string /* mount */, Awaited<ReturnType<typeof readPlateMeta>>>> {
  const entries = await Promise.all(mounts.map(async (m) => [m.mount, await readPlateMeta(m.diskPath)] as const));
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

  const plateStores: { mount: string; name: string; ome_version: "0.4" | "0.5" }[] = [];
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
    datasetChannels: isMultiDataset && Object.keys(datasetChannels).length > 0 ? datasetChannels : null,
  };
}

/** Sort obsm keys by priority (UMAP > tSNE > PHATE > PCA > rest). */
function sortObsmKeys(keys: string[]): string[] {
  const priorityMap = new Map(DEFAULT_OBSM_PRIORITY.map((k, i) => [k, i]));
  return keys.toSorted((a, b) => {
    const pa = priorityMap.get(a) ?? 999;
    const pb = priorityMap.get(b) ?? 999;
    if (pa !== pb) return pa - pb;
    return a.localeCompare(b);
  });
}

// ─── Dev error bridge → Vite HMR overlay ────────────────────────────────────

/**
 * Hooks uncaughtException / unhandledRejection and forwards a compact error
 * payload to Vite's /__dev_error endpoint, which broadcasts to the HMR WS
 * and shows the red overlay in the browser.
 *
 * Reads the Vite URL lazily on each error from `.vite/dev-server.json` so
 * we don't care which port Vite walked up to (worktree coexistence).
 * Best-effort — any failure silently falls through to the existing terminal
 * output path.
 */
async function readViteDevUrl(): Promise<string | null> {
  try {
    const { readFileSync } = await import("node:fs");
    const raw = readFileSync(".vite/dev-server.json", "utf8");
    const { url } = JSON.parse(raw) as { url?: string };
    return typeof url === "string" ? url : null;
  } catch {
    return null;
  }
}

async function reportBackendError(err: unknown): Promise<void> {
  const url = await readViteDevUrl();
  if (!url) return;
  const payload =
    err instanceof Error ? { message: err.message, stack: err.stack ?? "" } : { message: String(err), stack: "" };
  try {
    await fetch(`${url}/__dev_error`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch {
    // Vite is down or busy — the original handler's terminal output stays
    // as the primary channel. Nothing to do here.
  }
}

function installDevErrorBridge(): void {
  process.on("uncaughtException", (err) => {
    void reportBackendError(err);
  });
  process.on("unhandledRejection", (reason) => {
    void reportBackendError(reason);
  });
}
