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

import { open, AnnDataAccessor, toArrowTable } from "../zarr/index.ts";
import type { Table as FlechetteTable } from "@uwdata/flechette";
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
  const datasetObs: { name: string; arrowTable: FlechetteTable; columnNames: string[] }[] = [];

  for (const ds of loaded) {
    const arrowTable = toArrowTable(ds.accessor.obs);
    const columnNames = arrowTable.names;
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

  // Resolve a DuckDB column type from the Arrow column's type info. Decides
  // the CREATE TABLE schema. First dataset to carry a column wins the type;
  // downstream datasets that lack it append NULL.
  const unionColumnTypes = new Map<string, ReturnType<FlechetteTable["getChild"]>["type"]>();
  for (const ds of datasetObs) {
    for (const colName of ds.columnNames) {
      if (unionColumnTypes.has(colName)) continue;
      const col = ds.arrowTable.getChild(colName);
      if (col) unionColumnTypes.set(colName, col.type);
    }
  }

  // Build EmbeddingStore via init callback — DuckDB Appender path, no CSV.
  // Skips the CSV round-trip entirely (was a correctness bug on CxG data with
  // free-form comma-containing text, and the backlog-flagged perf bottleneck).
  const initStore = async (conn: DuckDBConnection): Promise<void> => {
    // CREATE TABLE with explicit column types.
    const colDefs: string[] = [];
    if (isMultiDataset) colDefs.push(`"_dataset" VARCHAR`);
    for (const colName of unionColumns) {
      const type = unionColumnTypes.get(colName);
      colDefs.push(`"${colName}" ${arrowTypeToDuckDB(type)}`);
    }
    await conn.run(`CREATE TABLE obs_base (${colDefs.join(", ")})`);

    // Append each dataset's rows via the Appender API — typed, no string
    // serialization, no ambiguity about escaping.
    for (const { name: datasetName, arrowTable, columnNames } of datasetObs) {
      const nameSet = new Set(columnNames);
      const columnRefs = unionColumns.map((n) => (nameSet.has(n) ? arrowTable.getChild(n) : null));
      const appender = await conn.createAppender("obs_base");
      const numRows = arrowTable.numRows;

      for (let r = 0; r < numRows; r++) {
        if (isMultiDataset) appender.appendVarchar(datasetName);
        for (let c = 0; c < unionColumns.length; c++) {
          const col = columnRefs[c];
          if (col == null) {
            appender.appendNull();
            continue;
          }
          const val = col.at(r);
          appendArrowValue(appender, val, col.type);
        }
        appender.endRow();
      }

      appender.closeSync();
    }
  };

  // Detect spatial columns and filter internals for the obs column list
  const colSet = new Set(firstColumns);
  const detected = detectSpatialColumns(colSet);
  const hasSpatial = detected.fov != null || detected.bbox != null || detected.x != null;
  const spatial = hasSpatial ? detected : null;
  const detectedObsColumns = firstColumns.filter((c) => !c.startsWith("__"));

  const hidden = spatialHiddenColumns(spatial);

  const store = await EmbeddingStore.fromInit(initStore, { hidden });

  // Apply obs column filter if configured
  const obsColumns = config.obsColumns ?? detectedObsColumns;

  console.log(`    ${GREEN}✓${RESET} ${formatNumber(store.nObs)} observations loaded into DuckDB`);

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
async function discoverObsmKeys(accessor: AnnDataAccessor): Promise<string[]> {
  const listed = await accessor.listObsmKeys();
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
      await accessor.getObsm(key);
      keys.push(key);
    } catch {
      /* not present */
    }
  }
  return keys;
}

/**
 * Map a flechette Arrow column type to a DuckDB SQL type.
 *
 * typeId values come from @uwdata/flechette's DataType union:
 *   -1 = Dictionary (AnnData categoricals — `.at()` returns the decoded string)
 *    1 = Null
 *    2 = Int (has `bitWidth` + `signed`)
 *    3 = Float (has `precision`: 0=half, 1=single, 2=double)
 *    5 = Utf8
 *    6 = Bool
 * Anything else falls back to VARCHAR — stringified via `.at()` — so temporal /
 * list / struct columns remain queryable even if we don't type them precisely.
 */
function arrowTypeToDuckDB(type: unknown): string {
  if (!type || typeof type !== "object") return "VARCHAR";
  const t = type as { typeId: number; bitWidth?: number; signed?: boolean; precision?: number };
  switch (t.typeId) {
    case 1: // Null
      return "VARCHAR";
    case 2: {
      // Integer
      const width = t.bitWidth ?? 32;
      const signed = t.signed ?? true;
      if (width === 8) return signed ? "TINYINT" : "UTINYINT";
      if (width === 16) return signed ? "SMALLINT" : "USMALLINT";
      if (width === 32) return signed ? "INTEGER" : "UINTEGER";
      return signed ? "BIGINT" : "UBIGINT";
    }
    case 3:
      // Float: precision 2 = f64, 0|1 = f32/f16 (DuckDB has no half → FLOAT)
      return t.precision === 2 ? "DOUBLE" : "FLOAT";
    case 5:
      return "VARCHAR";
    case 6:
      return "BOOLEAN";
    case -1:
      return "VARCHAR"; // Dictionary-encoded string (AnnData categorical)
    default:
      return "VARCHAR";
  }
}

/**
 * Dispatch a single Arrow value to the right DuckDB Appender method based on
 * the column's type. Null/undefined → appendNull. Unknown types fall back to
 * VARCHAR via String().
 */
interface AppenderLike {
  appendNull(): void;
  appendBoolean(v: boolean): void;
  appendTinyInt(v: number): void;
  appendSmallInt(v: number): void;
  appendInteger(v: number): void;
  appendBigInt(v: bigint): void;
  appendUTinyInt(v: number): void;
  appendUSmallInt(v: number): void;
  appendUInteger(v: number): void;
  appendUBigInt(v: bigint): void;
  appendFloat(v: number): void;
  appendDouble(v: number): void;
  appendVarchar(v: string): void;
}

function stringifyPrimitive(val: unknown): string {
  // AnnData obs values are primitives (Utf8 / Dictionary of Utf8 decode to string
  // via Column.at(); other types hit the default branch only on schema drift).
  // JSON.stringify ensures objects don't silently become "[object Object]".
  if (typeof val === "string") return val;
  if (typeof val === "number" || typeof val === "bigint" || typeof val === "boolean") return String(val);
  return JSON.stringify(val) ?? "";
}

function appendArrowValue(appender: AppenderLike, val: unknown, type: unknown): void {
  if (val == null) {
    appender.appendNull();
    return;
  }
  if (!type || typeof type !== "object") {
    appender.appendVarchar(stringifyPrimitive(val));
    return;
  }
  const t = type as { typeId: number; bitWidth?: number; signed?: boolean; precision?: number };
  switch (t.typeId) {
    case 1:
      appender.appendNull();
      return;
    case 2: {
      const width = t.bitWidth ?? 32;
      const signed = t.signed ?? true;
      if (width === 64) {
        // bigint required for BIGINT / UBIGINT
        const big = typeof val === "bigint" ? val : BigInt(Math.trunc(Number(val)));
        if (signed) appender.appendBigInt(big);
        else appender.appendUBigInt(big);
        return;
      }
      const num = typeof val === "bigint" ? Number(val) : Number(val);
      if (width === 8) (signed ? appender.appendTinyInt : appender.appendUTinyInt).call(appender, num);
      else if (width === 16) (signed ? appender.appendSmallInt : appender.appendUSmallInt).call(appender, num);
      else (signed ? appender.appendInteger : appender.appendUInteger).call(appender, num);
      return;
    }
    case 3: {
      const num = Number(val);
      if (t.precision === 2) appender.appendDouble(num);
      else appender.appendFloat(num);
      return;
    }
    case 5:
    case -1:
      appender.appendVarchar(stringifyPrimitive(val));
      return;
    case 6:
      appender.appendBoolean(Boolean(val));
      return;
    default:
      appender.appendVarchar(stringifyPrimitive(val));
  }
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
