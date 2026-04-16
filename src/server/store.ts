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

/** Derive column prefix from obsm key (strip leading "X_"). */
export function obsmColumnPrefix(obsmKey: string): string {
    return obsmKey.startsWith("X_") ? obsmKey.slice(2) : obsmKey;
}

// ─── Default embedding priority ──────────────────────────────────────────────

export const DEFAULT_OBSM_PRIORITY = ["X_umap", "X_tsne", "X_phate", "X_pca"];

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Concatenate multiple Uint8Array/Buffer chunks into a single Uint8Array. */
function concatBuffers(buffers: Array<Buffer | Uint8Array>): Uint8Array {
    if (buffers.length === 0) return new Uint8Array(0);
    if (buffers.length === 1) return new Uint8Array(buffers[0]);
    let totalLength = 0;
    for (const buf of buffers) totalLength += buf.byteLength;
    const result = new Uint8Array(totalLength);
    let offset = 0;
    for (const buf of buffers) {
        result.set(
            new Uint8Array(buf.buffer ?? buf, (buf as Uint8Array).byteOffset ?? 0, buf.byteLength),
            offset,
        );
        offset += buf.byteLength;
    }
    return result;
}

// ─── EmbeddingStore ──────────────────────────────────────────────────────────

export class EmbeddingStore {
    /** The underlying DuckDB instance. */
    readonly db: DuckDBInstance;
    /** Shared connection — Mosaic temp tables persist on the same connection. */
    readonly conn: DuckDBConnection;
    /** Number of observations in obs_base. */
    nObs: number = 0;
    /** Registered embeddings and their metadata. */
    private _loaded: Map<string, EmbeddingMeta> = new Map();
    /** Registered gene columns: colName → { table, colName }. */
    private _geneCols: Map<string, { table: string; colName: string }> = new Map();
    /** Columns to exclude from the dataset VIEW. */
    private _hidden: Set<string>;
    /** Whether nanoarrow extension is loaded (for Arrow IPC output). */
    private _nanoarrowLoaded: boolean = false;

    private constructor(db: DuckDBInstance, conn: DuckDBConnection, hidden?: Set<string>) {
        this.db = db;
        this.conn = conn;
        this._hidden = hidden ?? new Set();
    }

    /**
     * Create an EmbeddingStore from a Parquet file.
     *
     * The Parquet file should contain the obs DataFrame. A `__row_index__`
     * column is added if not present, along with `obs_name` for identity.
     */
    static async fromParquet(
        parquetPath: string,
        options?: { hidden?: Set<string> },
    ): Promise<EmbeddingStore> {
        const db = await DuckDBInstance.create(":memory:");
        const conn = await db.connect();
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
        options?: { hidden?: Set<string> },
    ): Promise<EmbeddingStore> {
        const db = await DuckDBInstance.create(":memory:");
        const conn = await db.connect();
        const store = new EmbeddingStore(db, conn, options?.hidden);

        await init(conn);
        await store._ensureIdentityColumns();
        await store._finishInit();

        return store;
    }

    /** Ensure __row_index__ and obs_name columns exist. */
    private async _ensureIdentityColumns(): Promise<void> {
        const reader = await this.conn.runAndReadAll("SELECT column_name FROM (DESCRIBE obs_base)");
        const colNames = new Set(reader.getColumnsJS()[0] as string[]);

        if (!colNames.has("__row_index__")) {
            await this.conn.run("ALTER TABLE obs_base ADD COLUMN __row_index__ INTEGER");
            await this.conn.run("UPDATE obs_base SET __row_index__ = rowid");
        }

        if (!colNames.has("obs_name")) {
            await this.conn.run("ALTER TABLE obs_base ADD COLUMN obs_name VARCHAR");
            await this.conn.run("UPDATE obs_base SET obs_name = CAST(__row_index__ AS VARCHAR)");
        }
    }

    /** Shared init: indexes, obsset tables, VIEW, row count, nanoarrow. */
    private async _finishInit(): Promise<void> {
        await this.conn.run("CREATE INDEX obs_base_row_index ON obs_base(__row_index__)");
        await this.conn.run("CREATE INDEX obs_base_obs_name ON obs_base(obs_name)");
        await this._initObssetTables();
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

        await this.conn.run(`CREATE TABLE ${tableName} (${colDefs.join(", ")})`);

        // Insert in batches to avoid overly long SQL
        const batchSize = 1000;
        for (let start = 0; start < nRows; start += batchSize) {
            const end = Math.min(start + batchSize, nRows);
            const valueRows: string[] = [];
            for (let i = start; i < end; i++) {
                const vals = [String(i)];
                for (let d = 0; d < nDims; d++) {
                    vals.push(String(coords[i * nDims + d]));
                }
                valueRows.push(`(${vals.join(", ")})`);
            }
            await this.conn.run(
                `INSERT INTO ${tableName} (${colNames.join(", ")}) VALUES ${valueRows.join(", ")}`,
            );
        }

        this._loaded.set(obsmKey, { prefix, nDims, table: tableName });
        await this._rebuildView();
    }

    /** True if a gene column with this name has already been materialised. */
    hasGeneColumn(colName: string): boolean {
        return this._geneCols.has(colName);
    }

    /**
     * Register a materialised gene/var column in DuckDB and rebuild the VIEW.
     *
     * Values are aligned to obs_base by `__row_index__`, so `values.length`
     * must equal `nObs`.
     */
    async registerGeneColumn(colName: string, values: Float64Array): Promise<void> {
        if (values.length !== this.nObs) {
            throw new Error(
                `registerGeneColumn: values.length=${values.length} != nObs=${this.nObs}`,
            );
        }
        if (this._geneCols.has(colName)) return;

        const safe = colName.replace(/[^a-zA-Z0-9_]/g, "_");
        const tableName = `gene_${safe}`;

        await this.conn.run(
            `CREATE TABLE ${tableName} (__row_index__ INTEGER, "${colName}" DOUBLE)`,
        );

        const batchSize = 1000;
        for (let start = 0; start < values.length; start += batchSize) {
            const end = Math.min(start + batchSize, values.length);
            const rows: string[] = [];
            for (let i = start; i < end; i++) {
                const v = values[i];
                rows.push(`(${i}, ${Number.isFinite(v) ? v : "NULL"})`);
            }
            await this.conn.run(
                `INSERT INTO ${tableName} (__row_index__, "${colName}") VALUES ${rows.join(", ")}`,
            );
        }

        this._geneCols.set(colName, { table: tableName, colName });
        await this._rebuildView();
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
            const reader = await this.conn.runAndReadAll(
                "SELECT column_name FROM (DESCRIBE obs_base)",
            );
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

        for (const gene of this._geneCols.values()) {
            joins.push(`LEFT JOIN ${gene.table} USING (__row_index__)`);
            extraCols.push(`${gene.table}."${gene.colName}"`);
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

    /** Initialize obsset tables (selection bookmarks). */
    private async _initObssetTables(): Promise<void> {
        await this.conn.run(`
            CREATE TABLE IF NOT EXISTS obssets (
                obsset_id     TEXT PRIMARY KEY,
                name          TEXT NOT NULL,
                color         TEXT,
                created_at    TIMESTAMP,
                created_count INTEGER
            )
        `);
        await this.conn.run(`
            CREATE TABLE IF NOT EXISTS obsset_members (
                obsset_id   TEXT NOT NULL,
                dataset_key TEXT NOT NULL,
                obs_name    TEXT NOT NULL,
                PRIMARY KEY (obsset_id, dataset_key, obs_name)
            )
        `);
        await this.conn.run(
            "CREATE INDEX IF NOT EXISTS idx_obsset_members_id ON obsset_members(obsset_id)",
        );
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
        const chunks = reader.getColumnsJS()[0] as Array<Buffer | Uint8Array>;
        return concatBuffers(chunks ?? []);
    }

    /** Execute SQL and return an array of row objects. */
    async queryJson(sql: string): Promise<RowData[]> {
        const reader = await this.conn.runAndReadAll(sql);
        return reader.getRowObjectsJson() as RowData[];
    }

    /** Execute SQL with no return value (DDL / DML). */
    async execute(sql: string): Promise<void> {
        await this.conn.run(sql);
    }

    /** Shut down: close connection and database. */
    close(): void {
        this.conn.closeSync();
        this.db.closeSync();
    }
}
