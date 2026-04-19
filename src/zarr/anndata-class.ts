/**
 * AnnData — Phase B of the zarr rework.
 *
 * A thin, symmetric wrapper over `AnnDataAccessor` that exposes obs and var
 * as first-class `DataFrame`s. This is the public API going forward;
 * `AnnDataAccessor` stays alive under the hood for back-compat with server
 * routes that call `getObsm`/`getX` directly.
 *
 * Adds `toDuckDB(conn)` — registers both `obs_base` and `var_base` so Mosaic
 * queries can filter either axis of the AnnData.
 */

import type { DuckDBConnection } from "@duckdb/node-api";
import type { Readable } from "zarrita";
import type { ParsedAnnData, ParsedMuData } from "./types.ts";
import { AnnDataAccessor } from "./anndata-accessor.ts";
import type { DenseResult, MatrixResult } from "./anndata-accessor.ts";
import type { DataFrame } from "./data-frame.ts";
import { LazyDataFrame } from "./data-frame.ts";
import { open as openStore } from "./open.ts";
import { ingestDataFrame } from "./to-duckdb.ts";

export interface ToDuckDBOptions {
  /** Table name for the obs axis. Default: "obs_base". */
  obsTable?: string;
  /** Table name for the var axis. Default: "var_base". */
  varTable?: string;
  /** Skip one axis (defaults false). */
  skipObs?: boolean;
  skipVar?: boolean;
}

export class AnnData {
  readonly obs: DataFrame;
  readonly var: DataFrame;
  private readonly _accessor: AnnDataAccessor;

  constructor(accessor: AnnDataAccessor) {
    this._accessor = accessor;
    this.obs = new LazyDataFrame(accessor.obs, "obs_name");
    this.var = new LazyDataFrame(accessor.var, "var_name");
  }

  /** Build from a parsed AnnData / MuData result. */
  static from(parsed: ParsedAnnData | ParsedMuData): AnnData {
    return new AnnData(AnnDataAccessor.from(parsed));
  }

  /** One-call opener: resolve store + detect convention + wrap. */
  static async open(location: string | Readable): Promise<AnnData> {
    const parsed = await openStore(location);
    if (parsed.kind === "ome-zarr") {
      throw new Error("AnnData.open: store is OME-Zarr, not AnnData/MuData");
    }
    return AnnData.from(parsed);
  }

  get shape(): readonly [number, number] {
    return [this._accessor.nObs, this._accessor.nVar];
  }

  get nObs(): number {
    return this._accessor.nObs;
  }

  get nVars(): number {
    return this._accessor.nVar;
  }

  // ── Lazy matrix / embedding reads — delegate to accessor ────────────────

  getX(): Promise<MatrixResult> {
    return this._accessor.getX();
  }

  getLayer(name: string): Promise<MatrixResult> {
    return this._accessor.getLayer(name);
  }

  getObsm(name: string): Promise<DenseResult> {
    return this._accessor.getObsm(name);
  }

  listObsmKeys(): Promise<string[] | null> {
    return this._accessor.listObsmKeys();
  }

  // ── Selection (still delegate to accessor; Phase C replaces with real view) ─

  isel(indices: { obs?: number[]; var?: number[] }): AnnData {
    return new AnnData(this._accessor.isel(indices));
  }

  sel(query: Record<string, unknown>): AnnData {
    return new AnnData(this._accessor.sel(query));
  }

  /**
   * Register obs and var DataFrames as queryable tables on `conn`.
   *
   * Both tables carry a `__{axis}_index__ INTEGER` identity column and a
   * `{axis}_name VARCHAR` from the DataFrame's index. Cross-axis join is
   * left to the caller — the tables are independent by construction
   * (obs_base has nObs rows; var_base has nVars rows).
   */
  async toDuckDB(conn: DuckDBConnection, options: ToDuckDBOptions = {}): Promise<void> {
    const obsTable = options.obsTable ?? "obs_base";
    const varTable = options.varTable ?? "var_base";
    if (!options.skipObs) {
      await ingestDataFrame(conn, obsTable, this.obs, {
        axis: "obs",
        includeNameColumn: true,
      });
    }
    if (!options.skipVar) {
      await ingestDataFrame(conn, varTable, this.var, {
        axis: "var",
        includeNameColumn: true,
      });
    }
  }

  /** Escape hatch — underlying accessor. Prefer AnnData's own methods. */
  get accessor(): AnnDataAccessor {
    return this._accessor;
  }
}
