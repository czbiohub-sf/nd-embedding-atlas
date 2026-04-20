/**
 * MuData — convention detector, parser, and public class.
 *
 * MuData is a root object above AnnData that holds a map of per-modality
 * AnnData objects (`mdata.mod["rna"]`, etc.) plus shared annotations at
 * the root level.
 *
 * Detects: root `.zattrs` has `"encoding-type": "MuData"`.
 * Structure:
 *   mod/<name>/   — each is a full AnnData
 *   obs/, var/    — root-level annotations (axis=0: obs shared)
 *   obsm/<name>/  — NOT an embedding — obs→modality binary mapping
 *   obsmap/<name> — integer map from shared obs-axis to per-modality rows
 *
 * This PR supports axis=0 stores with 1-to-1 obs_names across modalities.
 * Other axes and sparse modality coverage come later.
 */

import type { DuckDBConnection } from "@duckdb/node-api";
import * as zarr from "zarrita";
import type { Readable } from "zarrita";
import type { AnnDataFrame, ColumnData, ParsedAnnData, ParsedMuData, Scalar } from "./types.ts";
import { AnnData, parseAnnData, type DatasetHandle, type DenseResult, type ToDuckDBOptions } from "./anndata.ts";
import { LazyDataFrame } from "./data-frame.ts";
import { ingestDataFrames } from "./duckdb-ingest.ts";
import { open as openStore } from "./open.ts";
import { readDataFrame } from "./readers.ts";

type ZarrGroup = zarr.Group<Readable>;

export function detectMuData(rootAttrs: Record<string, unknown>): boolean {
  return rootAttrs["encoding-type"] === "MuData";
}

export async function parseMuData(group: ZarrGroup, storePath?: string): Promise<ParsedMuData> {
  const attrs = (group.attrs ?? {}) as Record<string, unknown>;

  const sharedObs = await readSharedAxis(group, "obs");
  const sharedVar = await readSharedAxis(group, "var");

  const modalities = new Map<string, ParsedAnnData>();
  const modNames = await discoverModalities(group, storePath);
  const modGroup = await tryOpenGroup(group, "mod");
  if (modGroup) {
    for (const modName of modNames) {
      try {
        const modZarrGroup = await zarr.open(modGroup.resolve(modName), { kind: "group" });
        const modAttrs = (modZarrGroup.attrs ?? {}) as Record<string, unknown>;
        if (modAttrs["encoding-type"] !== "anndata") continue;
        const modStorePath = storePath ? `${storePath}/mod/${modName}` : undefined;
        modalities.set(modName, await parseAnnData(modZarrGroup, modStorePath));
      } catch (e) {
        console.warn(`MuData: failed to parse modality "${modName}":`, e);
      }
    }
  }

  const obsmap = new Map<string, Int32Array | Uint32Array>();
  const obsmapGroup = await tryOpenGroup(group, "obsmap");
  if (obsmapGroup) {
    for (const modName of modalities.keys()) {
      try {
        const arr = await zarr.open(obsmapGroup.resolve(modName), { kind: "array" });
        const result = await zarr.get(arr);
        const data = result.data;
        if (data instanceof Int32Array || data instanceof Uint32Array) {
          obsmap.set(modName, data);
        }
      } catch {
        // obsmap entry may not exist for all modalities.
      }
    }
  }

  return {
    kind: "mudata",
    obs: sharedObs,
    var: sharedVar,
    attrs,
    group,
    storePath,
    modalities,
    obsmap,
  };
}

async function readSharedAxis(group: ZarrGroup, axis: "obs" | "var"): Promise<AnnDataFrame | undefined> {
  try {
    const g = await zarr.open(group.resolve(axis), { kind: "group" });
    return await readDataFrame(g as unknown as Parameters<typeof readDataFrame>[0]);
  } catch {
    return undefined;
  }
}

async function tryOpenGroup(parent: ZarrGroup, name: string): Promise<ZarrGroup | undefined> {
  try {
    return await zarr.open(parent.resolve(name), { kind: "group" });
  } catch {
    return undefined;
  }
}

/**
 * zarrita has no list-children API. Probe in order:
 *   1. consolidated metadata in root or mod/ group
 *   2. filesystem readdir on mod/ (local stores only)
 *   3. hardcoded common modality names (rna, atac, protein, …)
 */
async function discoverModalities(rootGroup: ZarrGroup, storePath: string | undefined): Promise<string[]> {
  const rootAttrs = (rootGroup.attrs ?? {}) as Record<string, unknown>;
  type ConsolidatedShape = { metadata?: Record<string, unknown> };

  const rootConsolidated = rootAttrs.consolidated_metadata as
    | { metadata?: { mod?: { consolidated_metadata?: ConsolidatedShape } } }
    | undefined;
  const consolidated = rootConsolidated?.metadata?.mod?.consolidated_metadata?.metadata;
  if (consolidated && typeof consolidated === "object") {
    return Object.keys(consolidated);
  }

  const modGroup = await tryOpenGroup(rootGroup, "mod");
  if (modGroup) {
    const modAttrs = (modGroup.attrs ?? {}) as Record<string, unknown>;
    if (modAttrs.consolidated_metadata) {
      const meta = (modAttrs.consolidated_metadata as ConsolidatedShape).metadata;
      if (meta && typeof meta === "object") return Object.keys(meta);
    }
  }

  if (storePath) {
    try {
      const fs = await import("node:fs");
      const path = await import("node:path");
      const modDir = path.join(storePath, "mod");
      if (fs.existsSync(modDir)) {
        return fs.readdirSync(modDir).filter((entry) => {
          const full = path.join(modDir, entry);
          return fs.statSync(full).isDirectory() && !entry.startsWith(".");
        });
      }
    } catch {
      /* not a filesystem store or no mod/ dir */
    }
  }

  const common = ["rna", "atac", "protein", "cite", "spatial", "adt", "hto"];
  const found: string[] = [];
  for (const name of common) {
    try {
      await zarr.open(rootGroup.resolve(`mod/${name}`), { kind: "group" });
      found.push(name);
    } catch {
      /* not present */
    }
  }
  return found;
}

// ─── MuData public class ───────────────────────────────────────────────────

export class MuData implements DatasetHandle {
  readonly kind = "mudata" as const;
  /**
   * MuData axis attribute from the store's root `.zattrs`:
   *   0  — observations shared across modalities (default)
   *   1  — variables shared, observations concatenated
   *   -1 — both shared
   * Only axis=0 is supported in this release.
   */
  readonly axis: 0 | 1 | -1;
  /** Root-level obs annotation. For axis=0, 1-to-1 with each modality's obs. */
  readonly obs: LazyDataFrame;
  /** Root-level var annotation (when present). */
  readonly var: LazyDataFrame;
  /** Per-modality AnnData handles, keyed by modality name. */
  readonly mod: ReadonlyMap<string, AnnData>;

  constructor(axis: 0 | 1 | -1, obs: LazyDataFrame, varDf: LazyDataFrame, mod: ReadonlyMap<string, AnnData>) {
    this.axis = axis;
    this.obs = obs;
    this.var = varDf;
    this.mod = mod;
  }

  /** Build from a parsed MuData result. */
  static from(parsed: ParsedMuData): MuData {
    const axisAttr = parsed.attrs.axis;
    const axis: 0 | 1 | -1 = axisAttr === 1 ? 1 : axisAttr === -1 ? -1 : 0; // default 0 per spec

    if (axis !== 0) {
      throw new Error(`MuData axis=${axis} is not yet supported (only axis=0).`);
    }

    const emptyFrame: AnnDataFrame = {
      index: [],
      columns: new Map(),
      columnOrder: [],
      column: () => {},
      *[Symbol.iterator]() {},
    };
    const obs = new LazyDataFrame(parsed.obs ?? emptyFrame, "obs_name");
    const varDf = new LazyDataFrame(parsed.var ?? emptyFrame, "var_name");
    const mod = new Map<string, AnnData>();
    for (const [name, modParsed] of parsed.modalities) {
      mod.set(name, AnnData.from(modParsed));
    }
    return new MuData(axis, obs, varDf, mod);
  }

  /** One-call opener: resolve store + detect convention + wrap. */
  static async open(location: string | Readable): Promise<MuData> {
    const parsed = await openStore(location);
    if (parsed.kind !== "mudata") {
      throw new Error(`MuData.open: store is ${parsed.kind}, not MuData. Use AnnData.open for AnnData stores.`);
    }
    return MuData.from(parsed);
  }

  get nObs(): number {
    return this.obs.length;
  }

  /** Modality names in insertion order. */
  get modNames(): string[] {
    return [...this.mod.keys()];
  }

  // ── DatasetHandle contract ──────────────────────────────────────────────

  /**
   * List obsm embeddings across every modality, namespaced by modality:
   *   ["dinov2:X_pca", "dinov2:X_umap", "rna:X_umap", ...]
   *
   * Separator is `:` per the MuData Python convention (mdata.mod["rna"]
   * obsm exposed as "rna:X_umap"). Root-level obsm is intentionally not
   * enumerated — those keys are the MuData obs-to-modality binary mapping,
   * not embeddings.
   */
  async listObsmKeys(): Promise<string[] | null> {
    const out: string[] = [];
    for (const [modName, modAdata] of this.mod) {
      const keys = await modAdata.listObsmKeys();
      if (!keys) continue;
      for (const key of keys) out.push(`${modName}:${key}`);
    }
    return out.toSorted();
  }

  /**
   * Load a namespaced embedding. The key must be `"<modality>:<obsmKey>"`.
   */
  getObsm(name: string): Promise<DenseResult> {
    const colon = name.indexOf(":");
    if (colon < 0) {
      return Promise.reject(new Error(`MuData.getObsm: key "${name}" must be namespaced as "<modality>:<obsmKey>".`));
    }
    const modName = name.slice(0, colon);
    const obsmKey = name.slice(colon + 1);
    const modAdata = this.mod.get(modName);
    if (!modAdata) {
      return Promise.reject(
        new Error(`MuData.getObsm: unknown modality "${modName}". Available: [${this.modNames.join(", ")}]`),
      );
    }
    return modAdata.getObsm(obsmKey);
  }

  /**
   * Register obs + var tables on DuckDB.
   *
   * - obs_base: merged columns across root obs + every modality's obs.
   *   Root columns keep their names (shared). Per-modality columns are
   *   renamed `<mod>:<col>` when they would collide with an already-seen
   *   name; non-colliding names are kept as-is. Matches the scverse
   *   convention `get_obs_mudata` uses.
   * - var_base: union of each modality's var, with a `_modality` VARCHAR
   *   column identifying the source modality. Shared root var (if present)
   *   is emitted under `_modality = "__shared__"`.
   *
   * The `_modality` discriminator lets the frontend scope var-level picks
   * to a modality (e.g. a gene from rna.var) while keeping a single
   * `var_base` table the server queries uniformly.
   */
  async toDuckDB(conn: DuckDBConnection, options: ToDuckDBOptions = {}): Promise<void> {
    const obsTable = options.obsTable ?? "obs_base";
    const varTable = options.varTable ?? "var_base";

    if (!options.skipObs) {
      const mergedObs = this._buildMergedObs();
      await ingestDataFrames(conn, obsTable, [new LazyDataFrame(mergedObs, "obs_name")], {
        axis: "obs",
        includeNameColumn: true,
      });
    }

    if (!options.skipVar) {
      // Build var_base as a union of shared root var (if any) + each
      // modality's var, tagged with `_modality`. ingestDataFrames's
      // datasetNames option + column-order union handle the schema merge.
      const varFrames: LazyDataFrame[] = [];
      const tags: string[] = [];
      if (this.var.length > 0) {
        varFrames.push(this.var);
        tags.push("__shared__");
      }
      for (const [modName, modAdata] of this.mod) {
        if (modAdata.var.length > 0) {
          varFrames.push(modAdata.var);
          tags.push(modName);
        }
      }
      if (varFrames.length > 0) {
        await ingestDataFrames(conn, varTable, varFrames, {
          axis: "var",
          includeNameColumn: true,
          datasetNames: tags,
        });
        // `ingestDataFrames` emits `_dataset` when datasetNames is set.
        // Rename to `_modality` for domain clarity.
        await conn.run(`ALTER TABLE ${varTable} RENAME COLUMN _dataset TO _modality`);
      }
    }
  }

  /**
   * Merge per-modality obs columns into the root obs frame. Collision-only
   * prefix: if a column name already exists in the merged frame, the
   * modality's column is added as `<mod>:<col>`. Otherwise the bare name
   * is kept.
   *
   * Assumes axis=0 and 1-to-1 obs_names across modalities (the supported
   * subset — see module docstring).
   */
  private _buildMergedObs(): AnnDataFrame {
    const rootSource = this.obs.source;
    const merged = new Map<string, ColumnData>();
    const columnOrder: string[] = [];
    const seen = new Set<string>();

    // 1. Root columns first, name-preserving.
    for (const name of rootSource.columnOrder) {
      const col = rootSource.column(name);
      if (!col) continue;
      merged.set(name, col);
      columnOrder.push(name);
      seen.add(name);
    }

    // 2. Each modality's columns. Prefix on collision.
    for (const [modName, modAdata] of this.mod) {
      const modSource = modAdata.obs.source;
      for (const name of modSource.columnOrder) {
        const col = modSource.column(name);
        if (!col) continue;
        const key = seen.has(name) ? `${modName}:${name}` : name;
        merged.set(key, col);
        columnOrder.push(key);
        seen.add(key);
      }
    }

    return {
      index: rootSource.index,
      columns: merged,
      columnOrder,
      column(name: string) {
        return merged.get(name);
      },
      *[Symbol.iterator]() {
        const idx = rootSource.index;
        const len = Array.isArray(idx) ? idx.length : idx.length;
        for (let i = 0; i < len; i++) {
          const row: Record<string, Scalar | null> = {};
          for (const [colName, col] of merged) {
            row[colName] = getColumnValue(col, i);
          }
          yield row;
        }
      },
    };
  }
}

/** Fetch a scalar from any ColumnData representation. */
function getColumnValue(col: ColumnData, i: number): Scalar | null {
  const withAt = col as { at?: (i: number) => Scalar | null };
  if (typeof withAt.at === "function") return withAt.at(i);
  if (Array.isArray(col)) return col[i];
  return (col as ArrayLike<number>)[i];
}
