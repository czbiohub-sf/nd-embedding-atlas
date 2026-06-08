/**
 * EmbeddingStore — in-process DuckDB for serving Mosaic queries.
 *
 * Ports the Python `server/_store.py` EmbeddingStore to TypeScript
 * using the @duckdb/node-api bindings (same as @uwdata/mosaic-duckdb).
 *
 * Data ingestion uses Parquet temp files (DuckDB reads these natively).
 * Arrow IPC output uses the nanoarrow extension's `to_arrow_ipc()`.
 */

import { DuckDBInstance } from "@duckdb/node-api";
import type { DuckDBConnection } from "@duckdb/node-api";

// ─── Types ───────────────────────────────────────────────────────────────────

/** Metadata about a registered embedding. */
export interface EmbeddingMeta {
  prefix: string;
  nDims: number;
  table: string;
}

type RowData = Record<string, unknown>;

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
    for (const k of Object.keys(value as Record<string, unknown>)) {
      nested[k] = coerceValue((value as Record<string, unknown>)[k]);
    }
    return nested;
  }
  return value;
}

// ─── EmbeddingStore ──────────────────────────────────────────────────────────

/**
 * DuckDB open options (I/O scalability loop, Cycle 1). Defaults preserve the
 * historical `:memory:` behavior; passing `dbPath` makes the store file-backed
 * (out-of-core — base tables page to disk under `memoryLimit`).
 */
export interface StoreOpenOptions {
  hidden?: Set<string>;
  /** DuckDB database path. Default `:memory:`. A file path = out-of-core. */
  dbPath?: string;
  /** DuckDB PRAGMAs applied right after connect. */
  pragmas?: { memoryLimit?: string; tempDirectory?: string; threads?: number };
}

export class EmbeddingStore {
  /** The underlying DuckDB instance. */
  readonly db: DuckDBInstance;
  /** Shared connection — Mosaic temp tables persist on the same connection. */
  readonly conn: DuckDBConnection;
  /** Number of observations in obs_base. */
  nObs: number = 0;
  /** Number of variables in var_base. 0 if var wasn't ingested. */
  nVars: number = 0;
  /** True once var_base exists. Mosaic queries can target `var_base` or the `var` VIEW. */
  hasVarTable: boolean = false;
  /**
   * Origin of `obs_name` values:
   *   "explicit"  — provided by the dataset (durable identity)
   *   "synthetic" — generated from `__row_index__` as a fallback
   *
   * Collections endpoints refuse to save against synthetic-name datasets
   * (409) because saved obs_names would re-resolve to whatever row 42 happens
   * to be on the next load — meaningless drift behavior.
   */
  obsNameOrigin: "explicit" | "synthetic" = "explicit";
  /** Registered embeddings and their metadata. */
  private _loaded: Map<string, EmbeddingMeta> = new Map();
  /** Registered var columns: colName → { table, colName }. */
  private _varCols: Map<string, { table: string; colName: string }> = new Map();
  /** Columns to exclude from the dataset VIEW. */
  private _hidden: Set<string>;
  /** Whether nanoarrow extension is loaded (for Arrow IPC output). */
  private _nanoarrowLoaded: boolean = false;
  /** Cached: does obs_base carry the multi-dataset `_dataset` column? */
  private _hasDatasetColumn: boolean | null = null;

  private constructor(db: DuckDBInstance, conn: DuckDBConnection, hidden?: Set<string>) {
    this.db = db;
    this.conn = conn;
    this._hidden = hidden ?? new Set();
  }

  /** Create the DuckDB instance + connection and apply open PRAGMAs. */
  private static async _open(options?: StoreOpenOptions): Promise<{ db: DuckDBInstance; conn: DuckDBConnection }> {
    const db = await DuckDBInstance.create(options?.dbPath ?? ":memory:");
    const conn = await db.connect();
    const p = options?.pragmas;
    if (p?.memoryLimit) await conn.run(`SET memory_limit='${p.memoryLimit}'`);
    if (p?.tempDirectory) await conn.run(`SET temp_directory='${p.tempDirectory}'`);
    if (p?.threads != null) await conn.run(`SET threads=${p.threads}`);
    return { db, conn };
  }

  /**
   * Create an EmbeddingStore from a Parquet file.
   *
   * The Parquet file should contain the obs DataFrame. A `__row_index__`
   * column is added if not present, along with `obs_name` for identity.
   */
  static async fromParquet(parquetPath: string, options?: StoreOpenOptions): Promise<EmbeddingStore> {
    const { db, conn } = await EmbeddingStore._open(options);
    const store = new EmbeddingStore(db, conn, options?.hidden);

    await conn.run(`CREATE TABLE obs_base AS SELECT * FROM '${parquetPath}'`);
    await store._ensureIdentityColumns();
    await store._finishInit();

    return store;
  }

  /**
   * Create an EmbeddingStore from an initialization callback.
   *
   * The callback receives the DuckDB connection and must create the
   * `obs_base` table. Useful for tests and programmatic data loading.
   */
  static async fromInit(
    init: (conn: DuckDBConnection) => Promise<void>,
    options?: StoreOpenOptions & {
      /** Optional var-axis initializer. Creates `var_base` table. */
      initVar?: (conn: DuckDBConnection) => Promise<void>;
    },
  ): Promise<EmbeddingStore> {
    const { db, conn } = await EmbeddingStore._open(options);
    const store = new EmbeddingStore(db, conn, options?.hidden);

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
   * `var_base`) from a prior ingest — the skip-re-ingest cache-hit path.
   *
   * Recovers in-memory state WITHOUT re-creating base tables or their indexes
   * (`fromInit`/`fromParquet` unconditionally CREATE and would collide). Throws
   * if the file lacks `obs_base` or its `_ndea_meta` key doesn't match
   * `expectKey` (a crashed mid-ingest file has no matching marker → the caller
   * rebuilds), closing the connection first so the caller can safely delete it.
   */
  static async fromCachedDb(
    dbPath: string,
    options?: StoreOpenOptions & { expectKey?: string },
  ): Promise<EmbeddingStore> {
    const { db, conn } = await EmbeddingStore._open({ ...options, dbPath });

    const tables = await EmbeddingStore._tableNames(conn);
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

    const store = new EmbeddingStore(db, conn, options?.hidden);

    const obsReader = await conn.runAndReadAll("SELECT COUNT(*) AS cnt FROM obs_base");
    store.nObs = Number(obsReader.getRowObjectsJson()[0].cnt);

    if (tables.has("_ndea_meta")) {
      const origin = (await conn.runAndReadAll("SELECT obs_name_origin FROM _ndea_meta LIMIT 1")).getRowObjectsJson()[0]
        ?.obs_name_origin;
      if (origin === "synthetic" || origin === "explicit") store.obsNameOrigin = origin;
    }

    // var axis — `_finishVarInit` rebuilds indexes (IF NOT EXISTS) + the `var`
    // VIEW (CREATE OR REPLACE) and sets nVars/hasVarTable. Idempotent on reopen.
    if (tables.has("var_base")) await store._finishVarInit();

    // Re-register persisted var columns (var_* tables, NOT var_base) so
    // hasVarColumn()/registerVarColumn() see them and the dataset VIEW joins
    // them. Embeddings (emb_*) are intentionally NOT re-registered here —
    // startup's obsm pre-warm re-creates each via registerEmbedding (DROP+CREATE).
    for (const t of tables) {
      if (!t.startsWith("var_") || t === "var_base") continue;
      const cols = (
        await conn.runAndReadAll(`SELECT column_name FROM (DESCRIBE "${t}")`)
      ).getColumnsJS()[0] as string[];
      const colName = cols.find((c) => c !== "__row_index__");
      if (colName) store._varCols.set(colName, { table: t, colName });
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
   *   `__row_index__` — legacy name referenced by scatter/table/frontend code
   *   `__obs_index__` — symmetric counterpart to `__var_index__` on var_base
   *   `obs_name`      — string identity (axis name)
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
      // Synthetic — values are stringified row indices. Collections endpoints
      // refuse this case so users don't save sets that drift on every reload.
      this.obsNameOrigin = "synthetic";
    }
  }

  /** Shared init: indexes, collection tables, VIEW, row count, nanoarrow. */
  private async _finishInit(): Promise<void> {
    await this.conn.run("CREATE INDEX IF NOT EXISTS obs_base_row_index ON obs_base(__row_index__)");
    await this.conn.run("CREATE INDEX IF NOT EXISTS obs_base_obs_index ON obs_base(__obs_index__)");
    await this.conn.run("CREATE INDEX IF NOT EXISTS obs_base_obs_name ON obs_base(obs_name)");
    await this._initCollectionTables();
    await this._rebuildView();

    const reader = await this.conn.runAndReadAll("SELECT COUNT(*) AS cnt FROM obs_base");
    const rows = reader.getRowObjectsJson();
    this.nObs = Number(rows[0].cnt);

    // Load nanoarrow for Arrow IPC output
    try {
      await this.conn.run("INSTALL nanoarrow FROM community; LOAD nanoarrow;");
      this._nanoarrowLoaded = true;
    } catch {
      // nanoarrow may already be loaded or unavailable — Arrow queries will fall back to JSON
      this._nanoarrowLoaded = false;
    }
  }

  /** Read-only snapshot of loaded embeddings. */
  get loadedEmbeddings(): ReadonlyMap<string, EmbeddingMeta> {
    return this._loaded;
  }

  /**
   * Register a materialized embedding in DuckDB and rebuild the VIEW.
   *
   * @param obsmKey Key in .obsm (e.g. "X_umap").
   * @param coords  Flat Float32Array of shape [nObs, nDims], row-major.
   * @param nDims   Number of dimensions (columns) per observation.
   */
  async registerEmbedding(obsmKey: string, coords: Float32Array, nDims: number): Promise<void> {
    const prefix = obsmColumnPrefix(obsmKey);
    const tableName = `emb_${prefix}`;
    const nRows = coords.length / nDims;

    // Build column definitions
    const colDefs: string[] = ["__row_index__ INTEGER"];
    const colNames: string[] = ["__row_index__"];
    for (let d = 0; d < nDims; d++) {
      colDefs.push(`"${prefix}_${d}" FLOAT`);
      colNames.push(`"${prefix}_${d}"`);
    }

    // DROP first so a failed prior load (e.g. partial insert) doesn't
    // leave a phantom table blocking the retry.
    await this.conn.run(`DROP TABLE IF EXISTS ${tableName}`);
    await this.conn.run(`CREATE TABLE ${tableName} (${colDefs.join(", ")})`);

    // Insert in batches to avoid overly long SQL. Non-finite floats
    // (NaN / ±Infinity) are emitted as NULL — DuckDB parses the bare
    // token `NaN` as an identifier, not a float literal.
    const batchSize = 1000;
    for (let start = 0; start < nRows; start += batchSize) {
      const end = Math.min(start + batchSize, nRows);
      const valueRows: string[] = [];
      for (let i = start; i < end; i++) {
        const vals = [String(i)];
        for (let d = 0; d < nDims; d++) {
          const v = coords[i * nDims + d];
          vals.push(Number.isFinite(v) ? String(v) : "NULL");
        }
        valueRows.push(`(${vals.join(", ")})`);
      }
      await this.conn.run(`INSERT INTO ${tableName} (${colNames.join(", ")}) VALUES ${valueRows.join(", ")}`);
    }

    this._loaded.set(obsmKey, { prefix, nDims, table: tableName });
    await this._rebuildView();
  }

  /** True if a var column with this name has already been materialised. */
  hasVarColumn(colName: string): boolean {
    return this._varCols.has(colName);
  }

  /**
   * Register a materialised var column in DuckDB and rebuild the VIEW.
   *
   * Values are aligned to obs_base by `__row_index__`, so `values.length`
   * must equal `nObs`.
   */
  async registerVarColumn(colName: string, values: Float64Array): Promise<void> {
    if (values.length !== this.nObs) {
      throw new Error(`registerVarColumn: values.length=${values.length} != nObs=${this.nObs}`);
    }
    if (this._varCols.has(colName)) return;

    const safe = colName.replace(/[^a-zA-Z0-9_]/g, "_");
    const tableName = `var_${safe}`;

    await this.conn.run(`CREATE TABLE ${tableName} (__row_index__ INTEGER, "${colName}" DOUBLE)`);

    const batchSize = 1000;
    for (let start = 0; start < values.length; start += batchSize) {
      const end = Math.min(start + batchSize, values.length);
      const rows: string[] = [];
      for (let i = start; i < end; i++) {
        const v = values[i];
        rows.push(`(${i}, ${Number.isFinite(v) ? v : "NULL"})`);
      }
      await this.conn.run(`INSERT INTO ${tableName} (__row_index__, "${colName}") VALUES ${rows.join(", ")}`);
    }

    this._varCols.set(colName, { table: tableName, colName });
    await this._rebuildView();
    console.log(
      `[store] registerVarColumn ${colName} → table ${tableName}; VIEW vars now: ${[...this._varCols.keys()].join(", ")}`,
    );
  }

  /**
   * Recreate the `dataset` VIEW to include all registered embeddings.
   *
   * Hidden columns are excluded from the VIEW but remain in obs_base
   * for direct queries (e.g. /api/obs).
   */
  async _rebuildView(): Promise<void> {
    let select: string;
    if (this._hidden.size > 0) {
      const reader = await this.conn.runAndReadAll("SELECT column_name FROM (DESCRIBE obs_base)");
      const allCols = reader.getColumnsJS()[0] as string[];
      const visibleCols = allCols.filter((c) => !this._hidden.has(c));
      select = visibleCols.map((c) => `obs_base."${c}"`).join(", ");
    } else {
      select = "obs_base.*";
    }

    const joins: string[] = [];
    const extraCols: string[] = [];

    for (const meta of this._loaded.values()) {
      joins.push(`LEFT JOIN ${meta.table} USING (__row_index__)`);
      for (let i = 0; i < meta.nDims; i++) {
        extraCols.push(`${meta.table}."${meta.prefix}_${i}"`);
      }
    }

    for (const varCol of this._varCols.values()) {
      joins.push(`LEFT JOIN ${varCol.table} USING (__row_index__)`);
      extraCols.push(`${varCol.table}."${varCol.colName}"`);
    }

    const extraSelect = extraCols.join(", ");
    const joinClause = joins.join(" ");

    if (extraSelect) {
      await this.conn.run(
        `CREATE OR REPLACE VIEW dataset AS SELECT ${select}, ${extraSelect} FROM obs_base ${joinClause}`,
      );
    } else {
      await this.conn.run(`CREATE OR REPLACE VIEW dataset AS SELECT ${select} FROM obs_base`);
    }
  }

  /**
   * Finalize var_base after the initVar callback has created it.
   *
   * `ingestDataFrames(..., { axis: "var", includeNameColumn: true })` already
   * emits `__var_index__` + `var_name`. This method indexes them and creates
   * a standalone `var` VIEW. var_base is NOT joined to the dataset VIEW —
   * cardinality is n_vars, not n_obs.
   *
   * Collision semantics (multi-dataset):
   *   When the `_dataset` column is present, `var_name` is only unique
   *   WITHIN a dataset — different AnnCollection members can legitimately
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

    // `var_uid` lives on the `var` VIEW — DuckDB doesn't support ALTER TABLE
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
   * Initialize collection tables.
   *
   * `obs_name` is the canonical identity column. `obs_index` is a per-load
   * cache that gets recomputed from `obs_name JOIN obs_base USING (_dataset, obs_name)`
   * after every attach (PR 3). Drift is computed at read time by joining
   * stored `obs_name` against current `obs_base` — the stored row count
   * (`created_count`) is immutable post-creation; the resolved count is the
   * live one and may shrink if obs disappear.
   */
  private async _initCollectionTables(): Promise<void> {
    await this.conn.run(`
            CREATE TABLE IF NOT EXISTS collections (
                collection_id   TEXT PRIMARY KEY,
                name            TEXT NOT NULL,
                color           TEXT,
                notes           TEXT,
                provenance      JSON,
                created_at      TIMESTAMP NOT NULL,
                updated_at      TIMESTAMP NOT NULL,
                created_count   INTEGER NOT NULL,
                deleted_at      TIMESTAMP,
                version         INTEGER NOT NULL DEFAULT 1
            )
        `);
    await this.conn.run(`
            CREATE TABLE IF NOT EXISTS collection_tags (
                collection_id   TEXT NOT NULL,
                tag             TEXT NOT NULL,
                PRIMARY KEY (collection_id, tag)
            )
        `);
    await this.conn.run(`
            CREATE TABLE IF NOT EXISTS collection_members (
                collection_id   TEXT NOT NULL,
                dataset_key     TEXT NOT NULL,
                obs_index       INTEGER NOT NULL,
                obs_name        TEXT NOT NULL,
                PRIMARY KEY (collection_id, dataset_key, obs_index)
            )
        `);
    await this.conn.run("CREATE INDEX IF NOT EXISTS idx_collection_members_id ON collection_members(collection_id)");
    await this.conn.run(
      "CREATE INDEX IF NOT EXISTS idx_collection_members_dataset ON collection_members(dataset_key, obs_index)",
    );
    await this.conn.run("CREATE INDEX IF NOT EXISTS idx_collection_tags_id ON collection_tags(collection_id)");
    await this.conn.run("CREATE INDEX IF NOT EXISTS idx_collection_tags_tag ON collection_tags(tag)");
  }

  /**
   * Execute SQL and return Arrow IPC bytes.
   *
   * Uses the nanoarrow extension's `to_arrow_ipc()` to produce IPC stream
   * chunks, then concatenates them into a single Uint8Array.
   */
  async queryArrow(sql: string): Promise<Uint8Array> {
    if (!this._nanoarrowLoaded) {
      throw new Error("nanoarrow extension not loaded — cannot produce Arrow IPC output");
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

  /** Execute SQL with no return value (DDL / DML). */
  async execute(sql: string): Promise<void> {
    await this.conn.run(sql);
  }

  /**
   * True iff `obs_base` carries the `_dataset` column (multi-dataset stores).
   * Cached because it never changes after init — `_rebuildView()` operates on
   * `dataset` (the VIEW), not `obs_base`. Tests that mutate `obs_base` schema
   * should call `invalidateSchemaCache()`.
   */
  async hasDatasetColumn(): Promise<boolean> {
    if (this._hasDatasetColumn != null) return this._hasDatasetColumn;
    const reader = await this.conn.runAndReadAll("SELECT column_name FROM (DESCRIBE obs_base)");
    const cols = reader.getColumnsJS()[0] as string[];
    this._hasDatasetColumn = cols.includes("_dataset");
    return this._hasDatasetColumn;
  }

  /** Reset cached schema introspection (for tests / DDL paths that alter obs_base). */
  invalidateSchemaCache(): void {
    this._hasDatasetColumn = null;
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
   * Written last, after a successful ingest — a crashed mid-ingest file has no
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
