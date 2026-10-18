/**
 * DatasetQuerySession: in-process DuckDB for serving Mosaic queries.
 *
 * Ports the Python `server/_store.py` analytical session to TypeScript
 * using the @duckdb/node-api bindings (same as @uwdata/mosaic-duckdb).
 *
 * Base tables come from `read_zarr` (server/zarr-ingest.ts); rows that start in
 * JS go through `appendColumns`.
 * Arrow IPC output uses the nanoarrow extension's `to_arrow_ipc()`.
 */

import { rm } from "node:fs/promises";
import type { DuckDBInstance } from "@duckdb/node-api";
import { appendColumns } from "./append-columns.ts";
import { openDuckDB } from "./zarr-extension.ts";
import type { DuckDBConnection } from "@duckdb/node-api";
import type { AnnotationDtype } from "./protocol.ts";

// ─── Types ───────────────────────────────────────────────────────────────────

type RowData = Record<string, unknown>;

/** Where a `dataset` VIEW column comes from. */
export type DatasetColumnKind = "obs" | "var" | "annotation";

/** One column of the `dataset` VIEW, as DuckDB describes it. */
export interface DatasetColumn {
  sqlType: string;
  kind: DatasetColumnKind;
}

// ─── Column prefix derivation ────────────────────────────────────────────────

/**
 * Derive a SQL-safe column prefix from an obsm key.
 *
 * Strips leading "X_" (e.g. "X_umap" → "umap"). For MuData namespaced
 * keys (`mod:key`), replaces the `:` separator with `_` so the result
 * stays a valid identifier and strips `X_` from every segment:
 *   "rna:X_umap"   → "rna_umap"
 *   "dinov2:X_pca" → "dinov2_pca"
 */
export function obsmColumnPrefix(obsmKey: string): string {
  return obsmKey
    .split(":")
    .map((seg) => (seg.startsWith("X_") ? seg.slice(2) : seg))
    .join("_");
}

// ─── Default embedding priority ──────────────────────────────────────────────

export const DEFAULT_OBSM_PRIORITY = ["X_umap", "X_tsne", "X_phate", "X_pca"];

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Quote a value as a SQL identifier: wrap in double quotes, double any embedded
 * double-quote. The ONLY safe way to interpolate a user-influenced column name
 * into SQL: a bare `"${name}"` lets a name containing `"` break out of the
 * identifier and inject arbitrary statements (conn.run executes multiple).
 */
export function quoteIdent(id: string): string {
  return `"${id.replace(/"/g, '""')}"`;
}

/** djb2 hash → short hex. Stable across runs (no Math.random / Date). */
function djb2Hex(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(16);
}

/**
 * Collision-free physical table name for an annotation column.
 *
 * The sanitized stem (`[^a-zA-Z0-9_]→_`) is lossy: `col 1` and `col.1` both
 * sanitize to `col_1`. Appending a hash of the *full* name keeps distinct
 * columns in distinct tables, so a second registration can't DROP the first's
 * data. The result is always `[a-z0-9_]` → safe as a bare SQL identifier.
 */
function annTableName(colName: string): string {
  const stem = colName.replace(/[^a-zA-Z0-9_]/g, "_").slice(0, 48);
  return `ann_${stem}__${djb2Hex(colName)}`;
}

/** DuckDB column type backing each annotation dtype. categorical/string both TEXT. */
function annSqlType(dtype: AnnotationDtype): string {
  if (dtype === "integer") return "INTEGER";
  if (dtype === "float") return "DOUBLE";
  return "TEXT";
}

/** Numbers `writeAnnotationValues` staging tables, so concurrent writes never share one. */
let annStages = 0;

/**
 * SQL literal for an annotation value, typed by the column's dtype. Integer
 * columns take a bare numeric literal (and reject non-integers at the door);
 * text columns take a single-quote-escaped string. NULL passes through.
 */
export function annValueLiteral(value: string | null, dtype: AnnotationDtype): string {
  if (value == null) return "NULL";
  if (dtype === "integer") {
    const n = Number(value);
    if (!Number.isInteger(n)) throw new Error(`Value "${value}" is not an integer`);
    return String(n);
  }
  if (dtype === "float") {
    const n = Number(value);
    if (!Number.isFinite(n)) throw new Error(`Value "${value}" is not a finite number`);
    return String(n);
  }
  return `'${value.replace(/'/g, "''")}'`;
}

/** Concatenate multiple Uint8Array/Buffer chunks into a single Uint8Array. */
function concatBuffers(buffers: (Buffer | Uint8Array)[]): Uint8Array {
  if (buffers.length === 0) return new Uint8Array(0);
  if (buffers.length === 1) return new Uint8Array(buffers[0]);
  let totalLength = 0;
  for (const buf of buffers) totalLength += buf.byteLength;
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const buf of buffers) {
    result.set(new Uint8Array(buf.buffer ?? buf, (buf as Uint8Array).byteOffset ?? 0, buf.byteLength), offset);
    offset += buf.byteLength;
  }
  return result;
}

const SAFE_MIN = BigInt(Number.MIN_SAFE_INTEGER);
const SAFE_MAX = BigInt(Number.MAX_SAFE_INTEGER);

/**
 * Normalise DuckDB-native JS values for JSON transport: bigints collapse to
 * numbers when safe (else strings), Dates → ISO strings, Buffers/typed arrays
 * → base64. Plain numbers / strings / nulls / nested objects pass through.
 */
function coerceRow(row: RowData): RowData {
  const out: RowData = {};
  for (const key of Object.keys(row)) {
    out[key] = coerceValue(row[key]);
  }
  return out;
}

function coerceValue(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "bigint") {
    return value >= SAFE_MIN && value <= SAFE_MAX ? Number(value) : value.toString();
  }
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(coerceValue);
  if (typeof value === "object") {
    const nested: RowData = {};
    for (const k of Object.keys(value)) {
      nested[k] = coerceValue((value as Record<string, unknown>)[k]);
    }
    return nested;
  }
  return value;
}

// ─── DatasetQuerySession ─────────────────────────────────────────────────────

/**
 * DuckDB open options (I/O scalability loop, Cycle 1). Defaults preserve the
 * historical `:memory:` behavior; passing `dbPath` makes the store file-backed,
 * so base tables page to disk instead of staying resident.
 */
export interface DatasetQuerySessionOptions {
  hidden?: Set<string>;
  /** DuckDB database path. Default `:memory:`. A file path = out-of-core. */
  dbPath?: string;
  /** DuckDB PRAGMAs applied right after connect. */
  pragmas?: { threads?: number };
}

export class DatasetQuerySession {
  /** The underlying DuckDB instance. */
  readonly db: DuckDBInstance;
  /** Shared connection: Mosaic temp tables persist on the same connection. */
  readonly conn: DuckDBConnection;
  /** Number of observations in obs_base. */
  nObs: number = 0;
  /** Number of variables in var_base. 0 if var wasn't ingested. */
  nVars: number = 0;
  /** True once var_base exists. Mosaic queries can target `var_base` or the `var` VIEW. */
  hasVarTable: boolean = false;
  /** Whether `obs_name` came from the dataset or the row-index fallback. */
  obsNameOrigin: "explicit" | "synthetic" = "explicit";
  /** Registered var columns: colName → { table, colName }. */
  private _varCols: Map<string, { table: string; colName: string }> = new Map();
  /** Registered user annotation columns: colName → { table, colName, dtype }. */
  private _annotationCols: Map<string, { table: string; colName: string; dtype: AnnotationDtype }> = new Map();
  /** Columns to exclude from the dataset VIEW. */
  private _hidden: Set<string>;
  /** Whether nanoarrow extension is loaded (for Arrow IPC output). */
  private _nanoarrowLoaded: boolean = false;
  /** The `dataset` VIEW's columns; replaced on every view rebuild. */
  private _columns: ReadonlyMap<string, DatasetColumn> = new Map();

  private constructor(db: DuckDBInstance, conn: DuckDBConnection, hidden?: Set<string>) {
    this.db = db;
    this.conn = conn;
    this._hidden = hidden ?? new Set();
  }

  /** Open DuckDB (with duckdb-zarr loaded) and apply open PRAGMAs. */
  private static async _open(
    options?: DatasetQuerySessionOptions,
  ): Promise<{ db: DuckDBInstance; conn: DuckDBConnection }> {
    const { db, conn } = await openDuckDB(options?.dbPath);
    const p = options?.pragmas;
    if (p?.threads != null) await conn.run(`SET threads=${p.threads}`);
    return { db, conn };
  }

  /**
   * Create a DatasetQuerySession from a Parquet file.
   *
   * The Parquet file should contain the obs DataFrame. A `__row_index__`
   * column is added if not present, along with `obs_name` for identity.
   */
  static async fromParquet(parquetPath: string, options?: DatasetQuerySessionOptions): Promise<DatasetQuerySession> {
    const { db, conn } = await DatasetQuerySession._open(options);
    const store = new DatasetQuerySession(db, conn, options?.hidden);

    await conn.run(`CREATE TABLE obs_base AS SELECT * FROM '${parquetPath}'`);
    await store._ensureIdentityColumns();
    await store._finishInit();

    return store;
  }

  /**
   * Create a DatasetQuerySession from an initialization callback.
   *
   * The callback receives the DuckDB connection and must create the
   * `obs_base` table. Useful for tests and programmatic data loading.
   */
  static async fromInit(
    init: (conn: DuckDBConnection) => Promise<void>,
    options?: DatasetQuerySessionOptions & {
      /** Optional var-axis initializer. Creates `var_base` table. */
      initVar?: (conn: DuckDBConnection) => Promise<void>;
    },
  ): Promise<DatasetQuerySession> {
    const { db, conn } = await DatasetQuerySession._open(options);
    const store = new DatasetQuerySession(db, conn, options?.hidden);

    await init(conn);
    await store._ensureIdentityColumns();
    await store._finishInit();

    if (options?.initVar) {
      await options.initVar(conn);
      await store._finishVarInit();
    }

    return store;
  }

  /**
   * Reopen a file-backed DuckDB that already holds `obs_base` (+ optional
   * `var_base`) from a prior ingest: the skip-re-ingest cache-hit path.
   *
   * Recovers in-memory state WITHOUT re-creating base tables or their indexes
   * (`fromInit`/`fromParquet` unconditionally CREATE and would collide). Throws
   * if the file lacks `obs_base` or its `_ndea_meta` key doesn't match
   * `expectKey` (a crashed mid-ingest file has no matching marker → the caller
   * rebuilds), closing the connection first so the caller can safely delete it.
   */
  static async fromCachedDb(
    dbPath: string,
    options?: DatasetQuerySessionOptions & { expectKey?: string },
  ): Promise<DatasetQuerySession> {
    const { db, conn } = await DatasetQuerySession._open({ ...options, dbPath });

    const tables = await DatasetQuerySession._tableNames(conn);
    const fail = (msg: string): never => {
      conn.closeSync();
      db.closeSync();
      throw new Error(`fromCachedDb: ${msg}`);
    };
    if (!tables.has("obs_base")) fail("no obs_base in cached db");
    if (options?.expectKey != null) {
      const cachedKey = tables.has("_ndea_meta")
        ? ((await conn.runAndReadAll("SELECT key FROM _ndea_meta LIMIT 1")).getRowObjectsJson()[0]?.key as
            | string
            | undefined)
        : undefined;
      if (cachedKey !== options.expectKey) fail("cache key mismatch / incomplete ingest");
    }

    const store = new DatasetQuerySession(db, conn, options?.hidden);

    const obsReader = await conn.runAndReadAll("SELECT COUNT(*) AS cnt FROM obs_base");
    store.nObs = Number(obsReader.getRowObjectsJson()[0].cnt);

    if (tables.has("_ndea_meta")) {
      const origin = (await conn.runAndReadAll("SELECT obs_name_origin FROM _ndea_meta LIMIT 1")).getRowObjectsJson()[0]
        ?.obs_name_origin;
      if (origin === "synthetic" || origin === "explicit") store.obsNameOrigin = origin;
    }

    // var axis: `_finishVarInit` rebuilds indexes (IF NOT EXISTS) + the `var`
    // VIEW (CREATE OR REPLACE) and sets nVars/hasVarTable. Idempotent on reopen.
    if (tables.has("var_base")) await store._finishVarInit();

    // Re-register persisted var columns (var_* tables, NOT var_base) so
    // hasVarColumn()/registerVarColumn() see them and the dataset VIEW joins
    // them.
    for (const t of tables) {
      if (!t.startsWith("var_") || t === "var_base") continue;
      const cols = (
        await conn.runAndReadAll(`SELECT column_name FROM (DESCRIBE ${quoteIdent(t)})`)
      ).getColumnsJS()[0] as string[];
      const colName = cols.find((c) => c !== "__row_index__");
      if (colName) store._varCols.set(colName, { table: t, colName });
    }

    // Re-register persisted annotation columns (ann_* tables). The dtype lives
    // in __ann_meta__ (persists in the cached .db); fall back to inferring from
    // the physical column type: INTEGER → integer, else categorical.
    const annDtypes = new Map<string, AnnotationDtype>();
    if (tables.has("__ann_meta__")) {
      const [names, dtypes] = (await conn.runAndReadAll(`SELECT col_name, dtype FROM __ann_meta__`)).getColumnsJS() as [
        string[],
        string[],
      ];
      names.forEach((n, i) => {
        const d = dtypes[i];
        annDtypes.set(n, d === "integer" || d === "string" ? d : "categorical");
      });
    }
    for (const t of tables) {
      if (!t.startsWith("ann_")) continue;
      const [cols, types] = (
        await conn.runAndReadAll(`SELECT column_name, column_type FROM (DESCRIBE ${quoteIdent(t)})`)
      ).getColumnsJS() as [string[], string[]];
      const idx = cols.findIndex((c) => c !== "__row_index__" && c !== "dataset_key" && c !== "obs_name");
      if (idx === -1) continue;
      const colName = cols[idx];
      const dtype = annDtypes.get(colName) ?? (/INT/i.test(types[idx]) ? "integer" : "categorical");
      store._annotationCols.set(colName, { table: t, colName, dtype });
    }

    try {
      await conn.run("INSTALL nanoarrow FROM community; LOAD nanoarrow;");
      store._nanoarrowLoaded = true;
    } catch {
      store._nanoarrowLoaded = false;
    }

    await store._rebuildView();
    return store;
  }

  /**
   * Ensure obs identity columns exist:
   *   `__row_index__`: legacy name referenced by scatter/table/frontend code
   *   `__obs_index__`: symmetric counterpart to `__var_index__` on var_base
   *   `obs_name`     : string identity (axis name)
   *
   * Keeping both index columns (same value) lets new code query obs/var
   * uniformly without touching 17 files of frontend SQL.
   */
  private async _ensureIdentityColumns(): Promise<void> {
    const reader = await this.conn.runAndReadAll("SELECT column_name FROM (DESCRIBE obs_base)");
    const colNames = new Set(reader.getColumnsJS()[0] as string[]);

    if (!colNames.has("__row_index__")) {
      await this.conn.run("ALTER TABLE obs_base ADD COLUMN __row_index__ INTEGER");
      await this.conn.run("UPDATE obs_base SET __row_index__ = rowid");
    }

    if (!colNames.has("__obs_index__")) {
      await this.conn.run("ALTER TABLE obs_base ADD COLUMN __obs_index__ INTEGER");
      await this.conn.run("UPDATE obs_base SET __obs_index__ = __row_index__");
    }

    if (!colNames.has("obs_name")) {
      await this.conn.run("ALTER TABLE obs_base ADD COLUMN obs_name VARCHAR");
      await this.conn.run("UPDATE obs_base SET obs_name = CAST(__row_index__ AS VARCHAR)");
      // Synthetic: values are stringified row indices.
      this.obsNameOrigin = "synthetic";
    }
  }

  /** Shared init: indexes, VIEW, row count, nanoarrow. */
  private async _finishInit(): Promise<void> {
    await this.conn.run("CREATE INDEX IF NOT EXISTS obs_base_row_index ON obs_base(__row_index__)");
    await this.conn.run("CREATE INDEX IF NOT EXISTS obs_base_obs_index ON obs_base(__obs_index__)");
    await this.conn.run("CREATE INDEX IF NOT EXISTS obs_base_obs_name ON obs_base(obs_name)");
    await this._rebuildView();

    const reader = await this.conn.runAndReadAll("SELECT COUNT(*) AS cnt FROM obs_base");
    const rows = reader.getRowObjectsJson();
    this.nObs = Number(rows[0].cnt);

    // Load nanoarrow for Arrow IPC output
    try {
      await this.conn.run("INSTALL nanoarrow FROM community; LOAD nanoarrow;");
      this._nanoarrowLoaded = true;
    } catch {
      // nanoarrow may already be loaded or unavailable: Arrow queries will fall back to JSON
      this._nanoarrowLoaded = false;
    }
  }

  /** True if a var column with this name has already been materialised. */
  hasVarColumn(colName: string): boolean {
    return this._varCols.has(colName);
  }

  /**
   * Register a var column and rebuild the VIEW. `query` yields
   * `(__row_index__, value)` for every obs_base row (zarr-ingest.ts
   * `varColumnQuery`).
   */
  async registerVarColumn(colName: string, query: string): Promise<void> {
    if (this._varCols.has(colName)) return;

    const safe = colName.replace(/[^a-zA-Z0-9_]/g, "_");
    const tableName = `var_${safe}`;
    await this.conn.run(
      `CREATE OR REPLACE TABLE ${tableName} AS SELECT __row_index__::INTEGER AS __row_index__, value::DOUBLE AS ${quoteIdent(colName)} ` +
        `FROM (${query}) ORDER BY __row_index__`,
    );

    this._varCols.set(colName, { table: tableName, colName });
    await this._rebuildView();
    console.log(
      `[store] registerVarColumn ${colName} → table ${tableName}; VIEW vars now: ${[...this._varCols.keys()].join(", ")}`,
    );
  }

  /** True if an annotation column with this name has been registered. */
  hasAnnotationColumn(colName: string): boolean {
    return this._annotationCols.has(colName);
  }

  /** Read-only snapshot of registered annotation columns. */
  get annotationColumns(): ReadonlyMap<string, { table: string; colName: string; dtype: AnnotationDtype }> {
    return this._annotationCols;
  }

  /**
   * The `dataset` VIEW's columns (obs_base minus hidden, var and
   * annotation joins), in VIEW order. The one answer to "is this a column?":
   * resolve every request- or document-supplied column name here before it
   * reaches SQL.
   */
  columns(): ReadonlyMap<string, DatasetColumn> {
    return this._columns;
  }

  /**
   * Add an `INTEGER DEFAULT 0` column to obs_base (a categorical index from
   * /api/categorize) and rebuild the VIEW so it and `columns()` include it.
   */
  async addObsIndexColumn(name: string): Promise<void> {
    await this.conn.run(`ALTER TABLE obs_base ADD COLUMN IF NOT EXISTS ${quoteIdent(name)} INTEGER DEFAULT 0`);
    await this._rebuildView();
  }

  /**
   * Ensure the annotation dtype registry exists. Persists with the cached
   * `.duckdb` file so dtypes (esp. the string-vs-categorical distinction the
   * column type alone can't recover) survive a reopen.
   */
  private async _ensureAnnMeta(): Promise<void> {
    await this.conn.run(`CREATE TABLE IF NOT EXISTS __ann_meta__ (col_name TEXT PRIMARY KEY, dtype TEXT NOT NULL)`);
  }

  /**
   * Create a new user annotation column and add it to the dataset VIEW.
   * No-op if the column already exists.
   */
  async registerAnnotationColumn(colName: string, dtype: AnnotationDtype = "categorical"): Promise<void> {
    if (this._annotationCols.has(colName)) return;
    const tableName = annTableName(colName);
    await this._ensureAnnMeta();
    await this.conn.run(`DROP TABLE IF EXISTS ${tableName}`);
    await this.conn.run(
      `CREATE TABLE ${tableName} (` +
        `__row_index__ UINTEGER PRIMARY KEY, ` +
        `dataset_key TEXT, ` +
        `obs_name TEXT, ` +
        `${quoteIdent(colName)} ${annSqlType(dtype)}` +
        `)`,
    );
    await this.conn.run(`INSERT OR REPLACE INTO __ann_meta__ VALUES ('${colName.replace(/'/g, "''")}', '${dtype}')`);
    this._annotationCols.set(colName, { table: tableName, colName, dtype });
    await this._rebuildView();
  }

  /**
   * Upsert annotation values. Rows already in the table are replaced.
   * The column must exist (call registerAnnotationColumn first).
   */
  async writeAnnotationValues(
    colName: string,
    rows: { rowIndex: number; datasetKey: string; obsName: string; value: string | null }[],
  ): Promise<void> {
    const entry = this._annotationCols.get(colName);
    if (!entry) throw new Error(`Unknown annotation column: ${colName}`);
    const numeric = entry.dtype === "integer" || entry.dtype === "float";
    // Every value is checked before anything is written; annValueLiteral throws on a bad number.
    const values = rows.map(({ value }) => {
      if (value == null || !numeric) return value;
      const n = Number(annValueLiteral(value, entry.dtype));
      if (entry.dtype === "integer" && (n | 0) !== n) throw new Error(`Value "${value}" is out of INTEGER range`);
      return n;
    });
    // Upsert: append to a per-call staging table, then INSERT OR REPLACE on the primary key.
    const stage = `__ann_stage_${++annStages}`;
    await appendColumns(
      this.conn,
      stage,
      rows.length,
      [
        { name: "__row_index__", type: "UINTEGER", get: (r) => rows[r].rowIndex },
        { name: "dataset_key", type: "TEXT", get: (r) => rows[r].datasetKey },
        { name: "obs_name", type: "TEXT", get: (r) => rows[r].obsName },
        { name: colName, type: annSqlType(entry.dtype), get: (r) => values[r] },
      ],
      { create: true },
    );
    await this.conn.run(`INSERT OR REPLACE INTO ${entry.table} SELECT * FROM ${stage}; DROP TABLE ${stage}`);
  }

  /** Drop an annotation column and remove it from the VIEW. */
  async dropAnnotationColumn(colName: string): Promise<void> {
    const entry = this._annotationCols.get(colName);
    if (!entry) return;
    // Rebuild the VIEW (which no longer references entry.table) BEFORE dropping
    // the table. Reversed, an interleaving Mosaic query on the shared
    // connection would hit the still-current VIEW referencing a dropped table.
    this._annotationCols.delete(colName);
    await this._rebuildView();
    await this.conn.run(`DROP TABLE IF EXISTS ${entry.table}`);
    await this.conn.run(`DELETE FROM __ann_meta__ WHERE col_name = '${colName.replace(/'/g, "''")}'`).catch(() => {});
  }

  /**
   * Write all annotation columns to a combined parquet sidecar.
   *
   * `USE_TMP_FILE true` makes the write atomic (DuckDB writes `path.tmp` then
   * renames), so a crash mid-write can't corrupt the prior sidecar: no manual
   * backup rotation needed. When the last column is dropped, the sidecar is
   * removed so the deletion persists (else a stale file resurrects it on load).
   *
   * ponytail: no point-in-time backups. If ever wanted, write base.N copies
   * AND make loadAnnotationsSidecar fall back to them: backups nothing reads
   * are pure debt.
   */
  async saveAnnotationsSidecar(sidecarPath: string): Promise<void> {
    if (this._annotationCols.size === 0) {
      await rm(sidecarPath, { force: true });
      return;
    }
    const parts = [...this._annotationCols.values()].map(
      ({ table, colName, dtype }) =>
        `SELECT '${colName.replace(/'/g, "''")}' AS column_name, '${dtype}' AS dtype, __row_index__, dataset_key, obs_name, CAST(${quoteIdent(colName)} AS TEXT) AS value FROM ${table}`,
    );
    const escaped = sidecarPath.replace(/'/g, "''");
    await this.conn.run(`COPY (${parts.join(" UNION ALL ")}) TO '${escaped}' (FORMAT parquet, USE_TMP_FILE true)`);
  }

  /**
   * Load annotation columns from a parquet sidecar written by saveAnnotationsSidecar.
   * Silently returns if the file does not exist.
   *
   * Re-keys the JOIN on the stored `__row_index__`. This is correct only while
   * the in-memory ingest is order-deterministic across runs (it is: the MuData
   * merge is deterministic). The durable identity (dataset_key, obs_name) is
   * preserved in the table; if ingest order ever becomes non-deterministic,
   * re-resolve __row_index__ by joining obs_name against obs_base here.
   */
  async loadAnnotationsSidecar(sidecarPath: string): Promise<void> {
    let cols: { column_name: string; dtype: string | null }[];
    const escaped = sidecarPath.replace(/'/g, "''");
    try {
      // `dtype` was added later: COALESCE a missing/legacy column to categorical.
      const hasDtype = (
        await this.conn.runAndReadAll(
          `SELECT COUNT(*) FROM (DESCRIBE SELECT * FROM read_parquet('${escaped}')) WHERE column_name = 'dtype'`,
        )
      ).getColumnsJS()[0][0];
      const dtypeExpr = Number(hasDtype) > 0 ? "ANY_VALUE(dtype)" : "'categorical'";
      const reader = await this.conn.runAndReadAll(
        `SELECT column_name, ${dtypeExpr} AS dtype FROM read_parquet('${escaped}') GROUP BY column_name`,
      );
      const [names, dtypes] = reader.getColumnsJS() as [string[], (string | null)[]];
      cols = names.map((column_name, i) => ({ column_name, dtype: dtypes[i] }));
    } catch {
      return; // file doesn't exist or is unreadable
    }
    if (cols.length > 0) await this._ensureAnnMeta();
    for (const { column_name: colName, dtype: rawDtype } of cols) {
      if (this._annotationCols.has(colName)) continue;
      const dtype: AnnotationDtype =
        rawDtype === "integer" || rawDtype === "string" || rawDtype === "float" ? rawDtype : "categorical";
      const tableName = annTableName(colName);
      const escapedCol = colName.replace(/'/g, "''");
      await this.conn.run(`DROP TABLE IF EXISTS ${tableName}`);
      await this.conn.run(
        `CREATE TABLE ${tableName} AS ` +
          `SELECT __row_index__, dataset_key, obs_name, CAST(value AS ${annSqlType(dtype)}) AS ${quoteIdent(colName)} ` +
          `FROM read_parquet('${escaped}') WHERE column_name = '${escapedCol}'`,
      );
      await this.conn.run(`INSERT OR REPLACE INTO __ann_meta__ VALUES ('${escapedCol}', '${dtype}')`);
      this._annotationCols.set(colName, { table: tableName, colName, dtype });
    }
    if (cols.length > 0) await this._rebuildView();
  }

  /**
   * Recreate the `dataset` VIEW over obs_base plus every registered var and
   * annotation join, then refresh `columns()` from `DESCRIBE dataset`.
   *
   * Hidden columns are excluded from the VIEW but remain in obs_base
   * for direct queries (e.g. /api/obs).
   */
  private async _rebuildView(): Promise<void> {
    let select: string;
    if (this._hidden.size > 0) {
      const reader = await this.conn.runAndReadAll("SELECT column_name FROM (DESCRIBE obs_base)");
      const allCols = reader.getColumnsJS()[0] as string[];
      const visibleCols = allCols.filter((c) => !this._hidden.has(c));
      select = visibleCols.map((c) => `obs_base.${quoteIdent(c)}`).join(", ");
    } else {
      select = "obs_base.*";
    }

    const joins: string[] = [];
    const extraCols: string[] = [];
    const kinds = new Map<string, DatasetColumnKind>();
    const addExtra = (table: string, column: string, kind: DatasetColumnKind) => {
      extraCols.push(`${table}.${quoteIdent(column)}`);
      kinds.set(column, kind);
    };

    for (const varCol of this._varCols.values()) {
      joins.push(`LEFT JOIN ${varCol.table} USING (__row_index__)`);
      addExtra(varCol.table, varCol.colName, "var");
    }

    for (const annCol of this._annotationCols.values()) {
      joins.push(`LEFT JOIN ${annCol.table} USING (__row_index__)`);
      addExtra(annCol.table, annCol.colName, "annotation");
    }

    const extraSelect = extraCols.length > 0 ? `, ${extraCols.join(", ")}` : "";
    await this.conn.run(
      `CREATE OR REPLACE VIEW dataset AS SELECT ${select}${extraSelect} FROM obs_base ${joins.join(" ")}`,
    );

    const [names, types] = (
      await this.conn.runAndReadAll("SELECT column_name, column_type FROM (DESCRIBE dataset)")
    ).getColumnsJS() as [string[], string[]];
    this._columns = new Map(names.map((name, i) => [name, { sqlType: types[i], kind: kinds.get(name) ?? "obs" }]));
  }

  /**
   * Finalize var_base after the initVar callback has created it.
   *
   * `ingestVar` (zarr-ingest.ts) already
   * emits `__var_index__` + `var_name`. This method indexes them and creates
   * a standalone `var` VIEW. var_base is NOT joined to the dataset VIEW :
   * cardinality is n_vars, not n_obs.
   *
   * Collision semantics (multi-dataset):
   *   When the `_dataset` column is present, `var_name` is only unique
   *   WITHIN a dataset: different AnnCollection members can legitimately
   *   share a var_name (same feature) OR collide (same string, different
   *   features). A composite index on (_dataset, var_name) + generated
   *   `var_uid` (= `_dataset || '::' || var_name`) gives callers a single
   *   column to join on safely.
   */
  private async _finishVarInit(): Promise<void> {
    await this.conn.run("CREATE INDEX IF NOT EXISTS var_base_row_index ON var_base(__var_index__)");
    await this.conn.run("CREATE INDEX IF NOT EXISTS var_base_var_name ON var_base(var_name)");

    // Detect whether the ingestion path wrote a `_dataset` column (multi-DF case).
    const schema = await this.conn.runAndReadAll("SELECT column_name FROM (DESCRIBE var_base)");
    const cols = new Set(schema.getColumnsJS()[0] as string[]);
    const isMulti = cols.has("_dataset");

    if (isMulti) {
      await this.conn.run("CREATE INDEX IF NOT EXISTS var_base_dataset_var ON var_base(_dataset, var_name)");
    }

    // `var_uid` lives on the `var` VIEW: DuckDB doesn't support ALTER TABLE
    // ADD COLUMN with GENERATED expressions. Safe single-column join key even
    // when `var_name` collides across datasets.
    const uidExpr = isMulti ? "_dataset || '::' || var_name" : "var_name";
    await this.conn.run(`CREATE OR REPLACE VIEW var AS SELECT *, (${uidExpr}) AS var_uid FROM var_base`);

    const reader = await this.conn.runAndReadAll("SELECT COUNT(*) AS cnt FROM var_base");
    const rows = reader.getRowObjectsJson();
    this.nVars = Number(rows[0].cnt);
    this.hasVarTable = true;
  }

  /**
   * Execute SQL and return Arrow IPC bytes.
   *
   * Uses the nanoarrow extension's `to_arrow_ipc()` to produce IPC stream
   * chunks, then concatenates them into a single Uint8Array.
   */
  async queryArrow(sql: string): Promise<Uint8Array> {
    if (!this._nanoarrowLoaded) {
      throw new Error("nanoarrow extension not loaded: cannot produce Arrow IPC output");
    }
    const reader = await this.conn.runAndReadAll(`SELECT * FROM to_arrow_ipc((${sql}))`);
    const chunks = reader.getColumnsJS()[0] as (Buffer | Uint8Array)[];
    return concatBuffers(chunks ?? []);
  }

  /**
   * Execute SQL and return an array of row objects.
   *
   * BIGINTs are returned as JS numbers when they fit within
   * Number.MAX_SAFE_INTEGER (so `.toFixed`, arithmetic, and JSON round-trips
   * work on the frontend). Out-of-range bigints fall back to strings to
   * preserve precision.
   */
  async queryJson(sql: string): Promise<RowData[]> {
    const reader = await this.conn.runAndReadAll(sql);
    const rows = reader.getRowObjectsJS() as RowData[];
    return rows.map(coerceRow);
  }

  /**
   * Like `queryJson`, but runs `sql` as one prepared statement. Use for SQL
   * assembled from document or agent input: DuckDB's plain run executes
   * stacked statements (`…; DROP TABLE …`), a prepared statement cannot.
   */
  async querySingleJson(sql: string): Promise<RowData[]> {
    const statement = await this.conn.prepare(sql);
    const reader = await statement.runAndReadAll();
    return (reader.getRowObjectsJS() as RowData[]).map(coerceRow);
  }

  /** Execute exactly one SQL statement, rejecting stacked statements before execution. */
  async executeSingle(sql: string): Promise<void> {
    const statement = await this.conn.prepare(sql);
    await statement.run();
  }

  /** Execute SQL with no return value (DDL / DML). */
  async execute(sql: string): Promise<void> {
    await this.conn.run(sql);
  }

  /** True iff the VIEW carries the multi-dataset `_dataset` column. */
  hasDatasetColumn(): boolean {
    return this._columns.has("_dataset");
  }

  /** Set of table names in the `main` schema (cache-reopen introspection). */
  private static async _tableNames(conn: DuckDBConnection): Promise<Set<string>> {
    const reader = await conn.runAndReadAll(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'main'",
    );
    return new Set(reader.getColumnsJS()[0] as string[]);
  }

  /**
   * Persist ingest provenance into the file-backed db so a later reopen
   * (`fromCachedDb`) can validate the cache and recover `obsNameOrigin`.
   * Written last, after a successful ingest: a crashed mid-ingest file has no
   * matching row and so fails the cache-hit key check.
   */
  async writeIngestMeta(key: string): Promise<void> {
    await this.conn.run("CREATE TABLE IF NOT EXISTS _ndea_meta (key TEXT, obs_name_origin TEXT)");
    await this.conn.run("DELETE FROM _ndea_meta");
    await this.conn.run(`INSERT INTO _ndea_meta VALUES ('${key}', '${this.obsNameOrigin}')`);
  }

  /** Shut down: close connection and database. */
  close(): void {
    this.conn.closeSync();
    this.db.closeSync();
  }
}
