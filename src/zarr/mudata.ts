/**
 * MuData convention detector + parser.
 *
 * Detects: root `.zattrs` has `"encoding-type": "MuData"`.
 * Structure:
 *   mod/<name>/   — each is a full AnnData
 *   obs/, var/    — shared annotations across modalities
 *   obsmap/       — integer maps from shared obs-axis to per-modality rows
 *
 * Returns a `ParsedMuData`. Phase E (obsmap-driven slicing) will wire the
 * `modalities` map into the `AnnData` class; today it's read + exposed only.
 */

import * as zarr from "zarrita";
import type { Readable } from "zarrita";
import type { AnnDataFrame, ParsedAnnData, ParsedMuData } from "./types.ts";
import { parseAnnData } from "./anndata.ts";
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
