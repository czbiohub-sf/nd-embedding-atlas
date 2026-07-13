/**
 * Startup orchestration — open stores, prepare data, launch server.
 *
 * Coordinates the full startup sequence:
 *   1. Open zarr stores via axial
 *   2. Convert obs DataFrames to Arrow IPC, inject _dataset column
 *   3. Init DatasetQuerySession from Arrow IPC via DuckDB
 *   4. Build ServerSession
 *   5. Create and start server
 *   6. Auto-open browser
 *   7. Handle graceful shutdown
 */

import {
  open,
  AnnData,
  MuData,
  ingestDataFrames,
  ingestDataFramesStreaming,
  ingestDataFrameChunked,
  openBunStore,
} from "@ndea/zarr";
import type { DatasetHandle } from "@ndea/zarr";
import { DatasetQuerySession, DEFAULT_OBSM_PRIORITY } from "../server/store.ts";
import { buildPlateMounts, readPlateMeta } from "../server/plate.ts";
import type { PlateChannel, PlateMount } from "../server/plate.ts";
import { detectSpatialColumns, spatialHiddenColumns } from "../server/state.ts";
import type { DatasetMountConfig, DatasetSessionMetadata, ServerSession } from "../server/state.ts";
import type { LaunchConfig, ProjectDatasetMount } from "./config.ts";
import { getNetworkAddress } from "./resolve.ts";
import { resolveFrontendDir } from "../server/static.ts";
import { flushAnnotationSaves } from "../server/routes/annotate.ts";
import type { DuckDBConnection } from "@duckdb/node-api";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import {
  resolveIngestMode,
  isLocalPath,
  ingestCacheKey,
  resolveIngestCachePath,
  ingestPragmas,
} from "../server/ingest-cache.ts";
import { VERSION } from "./version.ts";

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
  entry: ProjectDatasetMount;
  adata: DatasetHandle;
  obsmKeys: string[];
}

// ─── Main startup ───────────────────────────────────────────────────────────

export async function startup(config: LaunchConfig): Promise<void> {
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
  const datasetConfigs = new Map<string, DatasetMountConfig>();

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

  const hidden = spatialHiddenColumns(spatial);
  // Hidden columns (e.g. the string `bbox`) are excluded from the Mosaic
  // `dataset` VIEW — they're served per-row via /api/obs, not aggregated.
  // Drop them from the obs column list too, or the frontend table/charts
  // would SELECT them from the VIEW and hit a Binder error.
  const detectedObsColumns = firstColumns.filter((c) => !c.startsWith("__") && !hidden.has(c));

  // Both axes ingest through the same helper — columns are unioned across
  // datasets, per-column type wins on first sighting, `_dataset` column is
  // added only when there's > 1 DF. obs identity (`__row_index__` / `obs_name`)
  // is added by `DatasetQuerySession._ensureIdentityColumns`; var identity
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

  // I/O-scalability cutover (loop `perf/io-scalability`): route obs/var ingest
  // through the proven streaming/chunked paths and page base tables to a
  // file-backed, content-keyed DuckDB cache that skips re-ingest on reopen.
  // `NDEA_INGEST` selects the mode (default `chunked`); `eager` restores the
  // original in-memory Arrow path verbatim. MuData stays on the in-memory merge
  // path for now — its cross-modality obs merge has no chunked/streaming
  // equivalent, and its cache key can't yet fingerprint per-modality var.
  const ingestMode = resolveIngestMode();
  const allLocal = loaded.every((ds) => isLocalPath(ds.entry.path));
  const cacheEnabled = ingestMode !== "eager" && allLocal && !hasMuData && process.env.NDEA_NO_INGEST_CACHE !== "1";

  let initStore: (conn: DuckDBConnection) => Promise<void>;
  let initVar: ((conn: DuckDBConnection) => Promise<void>) | undefined;

  if (hasMuData) {
    // MuData owns both obs (collision-merged across modalities) and var
    // (unioned with `_modality` discriminator). Route both through
    // MuData.toDuckDB so the merge logic stays in one place. Unchanged by the
    // cutover — chunked/streaming cannot reproduce the merge.
    const muHandle = loaded[0].adata as MuData;
    initStore = (conn) => muHandle.toDuckDB(conn, { skipVar: true });
    initVar = (conn) => muHandle.toDuckDB(conn, { skipObs: true });
  } else if (ingestMode === "chunked" && !isMultiDataset) {
    // Single AnnData → chunked SOURCE streaming: peak JS allocation is one
    // row-window, not the whole obs (scale-invariant toward 5-10M obs). Needs
    // the raw zarr store, not the AnnData handle — open it directly, like the
    // `stream-chunked` bench driver. The eager `AnnData.from` above still ran
    // (obsm discovery + accessors need the handle); chunked only replaces the
    // obs/var DuckDB ingest.
    let rawStore: Awaited<ReturnType<typeof openBunStore>>["store"];
    try {
      ({ store: rawStore } = await openBunStore(loaded[0].entry.path));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`    ${RED}✗${RESET} ${loaded[0].entry.name}: ${msg}`);
      process.exit(1);
    }
    initStore = async (conn) => {
      await ingestDataFrameChunked(conn, "obs_base", rawStore, "obs", { axis: "obs", includeNameColumn: true });
    };
    initVar = async (conn) => {
      await ingestDataFrameChunked(conn, "var_base", rawStore, "var", { axis: "var", includeNameColumn: true });
    };
  } else {
    // Multi-dataset union (always — chunked can't emit `_dataset`) or
    // `stream`/`eager` single. `ingestDataFramesStreaming` is a drop-in for
    // `ingestDataFrames` (same union semantics, verified result-identical);
    // `eager` keeps the original Arrow path for an instant revert.
    //
    // axis + includeNameColumn make `obs_name VARCHAR` come from each DF's
    // index (AnnData.obs.index in Pandas → obs/_index in Zarr). Without this,
    // `_ensureIdentityColumns` in store.ts synthesizes obs_name from the row
    // index and stamps `provenance.synthetic_identity` on every collection —
    // which breaks durability across re-ingest.
    const ingest = ingestMode === "eager" ? ingestDataFrames : ingestDataFramesStreaming;
    initStore = async (conn) => {
      await ingest(
        conn,
        "obs_base",
        loaded.map((ds) => ds.adata.obs),
        {
          datasetNames,
          axis: "obs",
          includeNameColumn: true,
        },
      );
    };
    initVar = async (conn) => {
      await ingest(
        conn,
        "var_base",
        loaded.map((ds) => ds.adata.var),
        {
          datasetNames,
          axis: "var",
          includeNameColumn: true,
        },
      );
    };
  }

  // Open the store. Non-eager local ingests page base tables to a file-backed,
  // content-keyed `.duckdb` under ~/.cache/ndea/ingest/ and skip re-ingest on
  // reopen (the `_ndea_meta` key marker, written last, makes a crashed
  // mid-ingest file fail the hit check → rebuild). `eager` keeps `:memory:`.
  let store: DatasetQuerySession;
  if (cacheEnabled) {
    const key = ingestCacheKey(
      VERSION,
      loaded.map((ds) => ({ name: ds.entry.name, path: ds.entry.path })),
      ingestMode,
      hidden,
    );
    const { cacheDir, dbPath } = resolveIngestCachePath(key);
    const pragmas = ingestPragmas();
    let cached: DatasetQuerySession | null = null;
    if (existsSync(dbPath)) {
      try {
        cached = await DatasetQuerySession.fromCachedDb(dbPath, { hidden, pragmas, expectKey: key });
        console.log(`    ${DIM}↻ reusing cached ingest ${key}${RESET}`);
      } catch {
        cached = null; // stale / partial / unreadable — rebuild below
      }
    }
    if (cached) {
      store = cached;
    } else {
      if (existsSync(dbPath)) rmSync(dbPath, { force: true });
      if (existsSync(`${dbPath}.wal`)) rmSync(`${dbPath}.wal`, { force: true });
      mkdirSync(cacheDir, { recursive: true });
      store = await DatasetQuerySession.fromInit(initStore, { hidden, initVar, dbPath, pragmas });
      await store.writeIngestMeta(key);
    }
  } else {
    store = await DatasetQuerySession.fromInit(initStore, { hidden, initVar });
  }

  // Apply obs column filter if configured
  const obsColumns = config.obsColumns ?? detectedObsColumns;

  console.log(`    ${GREEN}✓${RESET} ${formatNumber(store.nObs)} observations loaded into DuckDB`);
  if (store.hasVarTable) {
    console.log(`    ${GREEN}✓${RESET} ${formatNumber(store.nVars)} variables loaded into DuckDB (var_base)`);
  }

  // ── 3. Build ServerSession ──────────────────────────────────────────────
  // Will be passed to createApp once server routes are wired up.

  // Build accessor map for on-demand obsm loading
  const accessors = new Map(loaded.map((ds) => [ds.entry.name, ds.adata]));

  // Build plate mounts + read minimal HCS metadata (omero channels, scale).
  const plateMounts: PlateMount[] = buildPlateMounts(datasetConfigs, isMultiDataset);
  const platesByDataset = await readPlateMetaForDatasets(plateMounts);

  // File-backed DuckDB: ann_* tables persist in the .duckdb cache file and are
  // re-registered by fromCachedDb — no sidecar needed. In-memory sessions
  // (MuData / remote zarr) lose ann_* on exit, so the sidecar is their only
  // persistence layer. Reload it now (before serving) so annotations from a
  // prior in-memory session are restored.
  const annotationsSidecarPath = cacheEnabled ? null : resolveAnnotationsSidecarPath(config.datasets[0].path);
  if (annotationsSidecarPath) {
    try {
      await store.loadAnnotationsSidecar(annotationsSidecarPath);
      const restored = store.annotationColumns.size;
      if (restored > 0) {
        // Surface restored columns in obs_columns so they appear in the table
        // + color picker (same array handleMetadata serves).
        for (const name of store.annotationColumns.keys()) {
          if (!obsColumns.includes(name)) obsColumns.push(name);
        }
        console.log(`    ${GREEN}✓${RESET} restored ${restored} annotation column(s) from sidecar`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`    ${YELLOW}⚠${RESET}  annotations sidecar load failed: ${msg}`);
    }
  }

  const state: ServerSession = {
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
    annotationsSidecarPath,
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
  const { buildPluginBootstrap } = await import("../server/plugins/bootstrap.ts");
  const pluginSnapshot = await buildPluginBootstrap({
    projectPluginPaths: config.pluginPaths,
    projectPluginContainmentRoot: config.pluginPathRoot,
  });
  for (const diagnostic of pluginSnapshot.catalog.diagnostics) {
    console.warn(`    ${YELLOW}⚠${RESET}  plugin ${diagnostic.sourceId}: ${diagnostic.message}`);
  }
  const { plateMeta, datasetChannels } = buildPlateMetadata(plateMounts, platesByDataset, isMultiDataset);

  const datasetMeta: DatasetSessionMetadata = {
    obsColumnNames: obsColumns,
    embeddingProps: {},
    hasPlate: plateMounts.length > 0,
    plateMeta,
    defaultX: "x",
    defaultY: "y",
    idColumn: "_index",
    datasetKeys: isMultiDataset ? [...datasetConfigs.keys()] : null,
    datasetChannels,
    preset: config.preset,
  };

  let server;
  try {
    server = createApp({
      port: config.port,
      host: config.host,
      store,
      state,
      config: datasetMeta,
      frontendDir: staticDir,
      noStatic: config.noStatic,
      pluginSnapshot,
    });
  } catch (err) {
    // Likely cause: another ndea process already holds this port. With
    // `host = "127.0.0.1"` (the default since this PR) the bind is
    // single-family, so a port collision throws here rather than
    // silently succeeding next to a sibling IPv6 zombie.
    //
    // Bun.serve's error message varies ("Failed to start server. Is
    // port X in use?" vs the raw Node-style "EADDRINUSE: address
    // already in use") so we match on multiple substrings.
    const msg = err instanceof Error ? err.message : String(err);
    const isPortInUse =
      msg.includes("address already in use") ||
      msg.includes("EADDRINUSE") ||
      (msg.includes("Is port") && msg.includes("in use"));
    if (isPortInUse) {
      console.error(`\n  ${RED}✗${RESET} Port ${config.port} is already in use on ${config.host}.`);
      console.error(`    Find the existing process:  ${DIM}lsof -nP -iTCP:${config.port} -sTCP:LISTEN${RESET}`);
      console.error(`    Kill it:                    ${DIM}pkill -f "ndea view"${RESET}`);
      console.error(`    Or pick a different port:   ${DIM}ndea view ... --port 5056${RESET}\n`);
      process.exit(1);
    }
    throw err;
  }

  // ── 5b. Pre-warm obsm loaders ───────────────────────────────────────────
  //
  // Resolve every available embedding's width via zarr metadata before
  // printing "Ready". Without this, the frontend wins the race: it
  // POSTs `/api/embeddings/X_phate`, issues its initial scatter
  // materialization query against an unregistered loader, gets an empty
  // result, and `@uwdata/mosaic-core`'s SQL-text-keyed query cache
  // poisons every subsequent re-render with the same empty answer.
  //
  // `detectWidth` is metadata-only (one zarr `.zarray` / `zarr.json`
  // shape read per embedding) so the wall-clock cost is typically
  // <50ms total even for ~10 embeddings. Failures are stashed in
  // `state.loadErrors` and surfaced via the existing status endpoint —
  // the server still boots even if one obsm key is broken.
  if (availableObsmKeys.length > 0) {
    const { loadEmbeddingAsync } = await import("../server/routes/embeddings.ts");
    await Promise.all(availableObsmKeys.map((key) => loadEmbeddingAsync(key, state)));
  }

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

  // Display "localhost" in user-facing URLs when binding to the loopback
  // address. `Bun.serve` resolves "localhost" via DNS at bind time, which
  // can land on IPv4 or IPv6 nondeterministically — two ndea processes
  // can then bind the same port on different families and both report
  // success, with `localhost` from the client side hitting whichever
  // one resolves first. So we bind literal `127.0.0.1` (single-family,
  // collisions throw EADDRINUSE loudly) but show "localhost" in the
  // printed URL because that's what users type.
  const displayHost = config.host === "127.0.0.1" ? "localhost" : config.host;

  // In dev mode (NDEA_NO_STATIC=1, set by `vp run dev`) the backend serves
  // the API only — Vite serves the app on :5173 with HMR. Label both URLs
  // so contributors know which one to open.
  const isDevMode = process.env.NDEA_NO_STATIC === "1";
  if (isDevMode) {
    console.log(
      `\n  ${BOLD}App:${RESET}  ${GREEN}http://${displayHost}:5173${RESET}  ${DIM}← open this (Vite + HMR)${RESET}`,
    );
    console.log(
      `  ${BOLD}API:${RESET}  ${DIM}http://${displayHost}:${config.port}  (backend — for /api/* and debugging)${RESET}`,
    );
  } else {
    console.log(`\n  ${BOLD}Server:${RESET}`);
    console.log(`    ${CYAN}Local:${RESET}   http://${displayHost}:${config.port}`);
    if (networkAddr && config.host !== "127.0.0.1") {
      console.log(`    ${CYAN}Network:${RESET} http://${networkAddr}:${config.port}`);
    }
  }
  console.log(`\n  ${DIM}Ready in ${elapsed}s${RESET}  ${DIM}(pid ${process.pid})${RESET}`);

  // ── 7. Auto-open browser ────────────────────────────────────────────────

  // `NDEA_NO_OPEN=1` is an unambiguous escape hatch for callers that spawn
  // the backend programmatically (e.g. `scripts/dev.ts`), since citty's
  // parse of `--no-open` depends on how the flag is declared.
  const suppressOpen = config.noOpen || process.env.NDEA_NO_OPEN === "1";
  if (!suppressOpen) {
    const url = `http://${displayHost}:${config.port}`;
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

  const shutdown = async () => {
    console.log(`\n  ${DIM}Shutting down...${RESET}`);
    // Flush a pending debounced annotation save before exit — for in-memory
    // (MuData / remote zarr) sessions the sidecar is the only persistence.
    await flushAnnotationSaves(state);
    void server.stop();
    store.close();
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
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

/**
 * Derive the annotations sidecar path for in-memory DuckDB sessions.
 *
 * Always writes to `~/.cache/ndea/annotations/{hex}.parquet` — never next
 * to the zarr store. The djb2 hash of the primary dataset path gives a
 * stable discriminator across restarts.
 */
function resolveAnnotationsSidecarPath(zarr_path: string): string {
  const cacheRoot = process.env.XDG_CACHE_HOME ?? resolve(homedir(), ".cache");
  const dir = resolve(cacheRoot, "ndea", "annotations");
  mkdirSync(dir, { recursive: true });
  // ponytail: djb2 hash — stable path discriminator, not a security primitive
  let h = 5381;
  for (let i = 0; i < zarr_path.length; i++) h = ((h << 5) + h + zarr_path.charCodeAt(i)) >>> 0;
  return resolve(dir, `${h.toString(16)}.parquet`);
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
