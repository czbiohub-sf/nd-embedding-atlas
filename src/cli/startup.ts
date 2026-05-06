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

  console.log(`  ${DIM}Opening ${config.datasets.length} dataset(s)...${RESET}`);
  const loaded: LoadedDataset[] = [];

  for (const ds of config.datasets) {
    try {
      const parsed = await open(ds.path);
      let adata: DatasetHandle;
      let nVars: number;
      if (parsed.kind === "anndata") {
        const a = AnnData.from(parsed);
        adata = a;
        nVars = a.nVars;
      } else if (parsed.kind === "mudata") {
        const m = MuData.from(parsed);
        adata = m;
        // MuData nVars is the sum across modalities (shared root var is
        // usually empty on axis=0; each modality owns its own var).
        let vars = m.var.length;
        for (const modAdata of m.mod.values()) vars += modAdata.nVars;
        nVars = vars;
      } else {
        throw new Error(`${ds.name}: store is ${parsed.kind}, not AnnData/MuData`);
      }

      // Discover available obsm keys
      const obsmKeys = await discoverObsmKeys(adata);

      loaded.push({ entry: ds, adata, obsmKeys });
      console.log(
        `    ${GREEN}✓${RESET} ${ds.name}  ${DIM}${formatNumber(adata.nObs)} obs × ${formatNumber(nVars)} var${RESET}`,
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

  // Determine obs columns from the first dataset (for spatial detection + UI).
  const firstColumns = [...loaded[0].adata.obs.columns];

  // Detect spatial columns and filter internals for the obs column list
  const colSet = new Set(firstColumns);
  const detected = detectSpatialColumns(colSet);
  const hasSpatial = detected.fov != null || detected.bbox != null || detected.x != null;
  const spatial = hasSpatial ? detected : null;
  const detectedObsColumns = firstColumns.filter((c) => !c.startsWith("__"));

  const hidden = spatialHiddenColumns(spatial);

  // Both axes ingest through the same helper — columns are unioned across
  // datasets, per-column type wins on first sighting, `_dataset` column is
  // added only when there's > 1 DF. obs identity (`__row_index__` / `obs_name`)
  // is added by `EmbeddingStore._ensureIdentityColumns`; var identity
  // (`__var_index__` / `var_name`) is emitted inline via `axis: "var"`.
  //
  // MuData: currently supported only as a single dataset. Multi-dataset
  // unions mixing AnnData + MuData (or multiple MuData stores) are not
  // supported yet — the per-modality var structure differs and merging
  // requires a separate design. Reject loudly.
  const hasMuData = loaded.some((ds) => ds.adata.kind === "mudata");
  if (hasMuData && loaded.length > 1) {
    console.error(`    ${RED}✗${RESET} Multi-dataset unions with MuData are not supported yet.`);
    process.exit(1);
  }

  const datasetNames = loaded.map((ds) => ds.entry.name);

  let initStore: (conn: DuckDBConnection) => Promise<void>;
  let initVar: ((conn: DuckDBConnection) => Promise<void>) | undefined;

  if (hasMuData) {
    // MuData owns both obs (collision-merged across modalities) and var
    // (unioned with `_modality` discriminator). Route both through
    // MuData.toDuckDB so the merge logic stays in one place.
    const muHandle = loaded[0].adata as MuData;
    initStore = (conn) => muHandle.toDuckDB(conn, { skipVar: true });
    initVar = (conn) => muHandle.toDuckDB(conn, { skipObs: true });
  } else {
    initStore = async (conn) => {
      // axis + includeNameColumn make `obs_name VARCHAR` come from each DF's
      // index (AnnData.obs.index in Pandas → obs/_index in Zarr). Without
      // this, `_ensureIdentityColumns` in store.ts synthesizes obs_name from
      // the row index and stamps `provenance.synthetic_identity` on every
      // collection — which breaks durability across re-ingest.
      await ingestDataFrames(
        conn,
        "obs_base",
        loaded.map((ds) => ds.adata.obs),
        { datasetNames, axis: "obs", includeNameColumn: true },
      );
    };
    initVar = async (conn) => {
      await ingestDataFrames(
        conn,
        "var_base",
        loaded.map((ds) => ds.adata.var),
        { datasetNames, axis: "var", includeNameColumn: true },
      );
    };
  }

  const store = await EmbeddingStore.fromInit(initStore, { hidden, initVar });

  // Apply obs column filter if configured
  const obsColumns = config.obsColumns ?? detectedObsColumns;

  console.log(`    ${GREEN}✓${RESET} ${formatNumber(store.nObs)} observations loaded into DuckDB`);
  if (store.hasVarTable) {
    console.log(`    ${GREEN}✓${RESET} ${formatNumber(store.nVars)} variables loaded into DuckDB (var_base)`);
  }

  // ── 3. Build ViewerState ────────────────────────────────────────────────
  // Will be passed to createApp once server routes are wired up.

  // Build accessor map for on-demand obsm loading
  const accessors = new Map(loaded.map((ds) => [ds.entry.name, ds.adata]));

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
    obsmLoaders: new Map(),
    // Crop pool is attached lazily by createApp() so tests / non-server
    // consumers don't pay the worker spawn cost.
    cropPool: null,
  };
  // ── 4. Resolve frontend ─────────────────────────────────────────────────

  let staticDir: string | undefined;
  if (!config.noStatic) {
    staticDir = resolveFrontendDir() ?? undefined;
    if (!staticDir) {
      console.log(
        `\n  ${YELLOW}⚠${RESET}  No frontend dist found. Run ${DIM}vp build${RESET} (or ${DIM}vp run dev${RESET} for dev mode with Vite HMR).`,
      );
    }
  }

  // ── 5. Start server ─────────────────────────────────────────────────────

  const { createApp } = await import("../server/app.ts");
  const { plateMeta, datasetChannels } = buildPlateMetadata(plateMounts, platesByDataset, isMultiDataset);

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
    const nVars =
      ds.adata.kind === "mudata"
        ? (() => {
            const m = ds.adata as MuData;
            let total = m.var.length;
            for (const mod of m.mod.values()) total += mod.nVars;
            return total;
          })()
        : (ds.adata as AnnData).nVars;
    console.log(
      `    ${ds.entry.name}  ${DIM}${formatNumber(ds.adata.nObs)} obs × ${formatNumber(nVars)} var${RESET}${plateTag}`,
    );
  }

  if (availableObsmKeys.length > 0) {
    console.log(`\n  ${BOLD}Embeddings:${RESET} ${DIM}${availableObsmKeys.join(", ")}${RESET}`);
  }

  // In dev mode (NDEA_NO_STATIC=1, set by `vp run dev`) the backend serves
  // the API only — Vite serves the app on :5173 with HMR. Label both URLs
  // so contributors know which one to open.
  const isDevMode = process.env.NDEA_NO_STATIC === "1";
  if (isDevMode) {
    console.log(
      `\n  ${BOLD}App:${RESET}  ${GREEN}http://${config.host}:5173${RESET}  ${DIM}← open this (Vite + HMR)${RESET}`,
    );
    console.log(
      `  ${BOLD}API:${RESET}  ${DIM}http://${config.host}:${config.port}  (backend — for /api/* and debugging)${RESET}`,
    );
  } else {
    console.log(`\n  ${BOLD}Server:${RESET}`);
    console.log(`    ${CYAN}Local:${RESET}   http://${config.host}:${config.port}`);
    if (networkAddr && config.host !== "127.0.0.1") {
      console.log(`    ${CYAN}Network:${RESET} http://${networkAddr}:${config.port}`);
    }
  }
  console.log(`\n  ${DIM}Ready in ${elapsed}s${RESET}`);

  // ── 7. Auto-open browser ────────────────────────────────────────────────

  // `NDEA_NO_OPEN=1` is an unambiguous escape hatch for callers that spawn
  // the backend programmatically (e.g. `scripts/dev.ts`), since citty's
  // parse of `--no-open` depends on how the flag is declared.
  const suppressOpen = config.noOpen || process.env.NDEA_NO_OPEN === "1";
  if (!suppressOpen) {
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
