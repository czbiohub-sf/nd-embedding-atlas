/**
 * MuData: convention detector, parser, and public class.
 *
 * MuData is a root object above AnnData that holds a map of per-modality
 * AnnData objects (`mdata.mod["rna"]`, etc.) plus shared annotations at
 * the root level.
 *
 * Detects: root `.zattrs` has `"encoding-type": "MuData"`.
 * Structure:
 *   mod/<name>/  : each is a full AnnData
 *   obs/, var/   : root-level annotations (axis=0: obs shared)
 *   obsm/<name>/ : NOT an embedding: obs→modality binary mapping
 *   obsmap/<name>: integer map from shared obs-axis to per-modality rows
 *
 * This reader supports axis=0 stores with 1-to-1 obs_names across modalities.
 * Other axes and sparse modality coverage come later. Like `AnnData`, opening
 * reads metadata only; DuckDB reads the values.
 */

import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import * as zarr from "zarrita";
import type { Readable } from "zarrita";
import type { FrameMeta, ParsedAnnData, ParsedMuData } from "./types.ts";
import { AnnData, parseAnnData, type DatasetHandle } from "./anndata.ts";
import { readFrameMeta } from "./frame-meta.ts";

type ZarrGroup = zarr.Group<Readable>;

export function detectMuData(rootAttrs: Record<string, unknown>): boolean {
  return rootAttrs["encoding-type"] === "MuData";
}

export async function parseMuData(
  group: ZarrGroup,
  location: { storePath?: string; source?: string } = {},
): Promise<ParsedMuData> {
  const modalities = new Map<string, ParsedAnnData>();
  const modGroup = await tryOpenMuDataGroup(group, "mod");
  if (modGroup) {
    for (const modName of await discoverModalities(group, location.storePath)) {
      try {
        const modZarrGroup = await zarr.open(modGroup.resolve(modName), { kind: "group" });
        if (modZarrGroup.attrs["encoding-type"] !== "anndata") continue;
        const modStorePath = location.storePath ? `${location.storePath}/mod/${modName}` : undefined;
        modalities.set(
          modName,
          await parseAnnData(modZarrGroup, {
            storePath: modStorePath,
            source: location.source,
            groupPath: `mod/${modName}`,
          }),
        );
      } catch (e) {
        console.warn(`MuData: failed to parse modality "${modName}":`, e);
      }
    }
  }

  return {
    kind: "mudata",
    obs: await readFrameMeta(group, "obs"),
    var: await readFrameMeta(group, "var"),
    attrs: group.attrs ?? {},
    group,
    storePath: location.storePath,
    source: location.source,
    modalities,
  };
}
async function tryOpenMuDataGroup(parent: ZarrGroup, name: string): Promise<ZarrGroup | undefined> {
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

  const modGroup = await tryOpenMuDataGroup(rootGroup, "mod");
  if (modGroup) {
    const modAttrs = (modGroup.attrs ?? {}) as Record<string, unknown>;
    if (modAttrs.consolidated_metadata) {
      const meta = (modAttrs.consolidated_metadata as ConsolidatedShape).metadata;
      if (meta && typeof meta === "object") return Object.keys(meta);
    }
  }

  if (storePath) {
    try {
      const modDir = join(storePath, "mod");
      if (existsSync(modDir)) {
        return readdirSync(modDir).filter((entry) => {
          const full = join(modDir, entry);
          return statSync(full).isDirectory() && !entry.startsWith(".");
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
   *   0 : observations shared across modalities (default)
   *   1 : variables shared, observations concatenated
   *   -1: both shared
   * Only axis=0 is supported in this release.
   */
  readonly axis: 0 | 1 | -1;
  /** Root-level obs annotation. For axis=0, 1-to-1 with each modality's obs. */
  readonly obs: FrameMeta;
  /** Root-level var annotation (empty when the store has none). */
  readonly var: FrameMeta;
  /** Per-modality AnnData handles, keyed by modality name. */
  readonly mod: ReadonlyMap<string, AnnData>;
  readonly source: string | undefined;

  constructor(
    axis: 0 | 1 | -1,
    obs: FrameMeta,
    varFrame: FrameMeta,
    mod: ReadonlyMap<string, AnnData>,
    source: string | undefined,
  ) {
    this.axis = axis;
    this.obs = obs;
    this.var = varFrame;
    this.mod = mod;
    this.source = source;
  }

  /** Build from a parsed MuData result. */
  static from(parsed: ParsedMuData): MuData {
    const axisAttr = parsed.attrs.axis;
    const axis: 0 | 1 | -1 = axisAttr === 1 ? 1 : axisAttr === -1 ? -1 : 0; // default 0 per spec

    if (axis !== 0) {
      throw new Error(`MuData axis=${axis} is not yet supported (only axis=0).`);
    }

    const empty: FrameMeta = { indexName: "_index", columns: [], encodings: {}, length: 0 };
    const mod = new Map<string, AnnData>();
    for (const [name, modParsed] of parsed.modalities) mod.set(name, AnnData.from(modParsed));
    return new MuData(axis, parsed.obs ?? empty, parsed.var ?? empty, mod, parsed.source);
  }

  /** Global obs rows (axis=0: every modality has the same obs). */
  get nObs(): number {
    return this.obs.length || (this.mod.values().next().value?.nObs ?? 0);
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
   * enumerated: those keys are the MuData obs-to-modality binary mapping,
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

  getObsmShape(name: string): Promise<readonly [number, number]> {
    const { modAdata, obsmKey } = this._resolveObsmKey(name);
    return modAdata.getObsmShape(obsmKey);
  }

  getObsmColumn(name: string, colIndex: number, signal?: AbortSignal): Promise<Float32Array> {
    const { modAdata, obsmKey } = this._resolveObsmKey(name);
    return modAdata.getObsmColumn(obsmKey, colIndex, signal);
  }

  private _resolveObsmKey(name: string): { modAdata: AnnData; obsmKey: string } {
    const colon = name.indexOf(":");
    if (colon < 0) {
      throw new Error(`MuData obsm key "${name}" must be namespaced as "<modality>:<obsmKey>".`);
    }
    const modName = name.slice(0, colon);
    const obsmKey = name.slice(colon + 1);
    const modAdata = this.mod.get(modName);
    if (!modAdata) {
      throw new Error(`MuData: unknown modality "${modName}". Available: [${this.modNames.join(", ")}]`);
    }
    return { modAdata, obsmKey };
  }
}
