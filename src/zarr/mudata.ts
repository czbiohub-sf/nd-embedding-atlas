import * as zarr from "zarrita";
import type { AnnDataFrame, Convention, DataTree } from "./types.ts";
import { SimpleDataTree } from "./data-tree.ts";
import { SimpleCoordSet, SimpleCoordArray } from "./coord-set.ts";
import { detectAnnData } from "./anndata.ts";
import { readDataFrame } from "./encoding-readers.ts";

/**
 * MuData convention parser.
 *
 * Detects: root .zattrs has "encoding-type": "MuData".
 * Structure:
 *   mod/<name>/  — each is a full AnnData subtree
 *   obs/, var/   — shared annotations across modalities
 *   obsmap/, varmap/ — integer index mappings (shared ↔ per-modality)
 *   obsm/, varm/ — includes boolean masks linking shared to modality-specific
 */
export const detectMuData: Convention = {
    name: "mudata",

    detect(rootAttrs: Record<string, unknown>): boolean {
        return rootAttrs["encoding-type"] === "MuData";
    },

    async parse(group: any, storePath?: string): Promise<DataTree> {
        const attrs = (group.attrs ?? {}) as Record<string, unknown>;

        // Parse shared obs/var DataFrames
        let sharedObs: AnnDataFrame | undefined;
        let sharedVar: AnnDataFrame | undefined;

        try {
            const obsGroup = await zarr.open(group.resolve("obs"), { kind: "group" });
            sharedObs = await readDataFrame(obsGroup as any);
        } catch {
            // Shared obs may be minimal or missing
        }

        try {
            const varGroup = await zarr.open(group.resolve("var"), { kind: "group" });
            sharedVar = await readDataFrame(varGroup as any);
        } catch {
            // Shared var may be minimal
        }

        // Build shared coords
        const coords: SimpleCoordArray[] = [];
        if (sharedObs) {
            coords.push(
                new SimpleCoordArray(
                    "obs",
                    Array.isArray(sharedObs.index) ? sharedObs.index : Array.from(sharedObs.index),
                    "string",
                    { source: "shared_obs._index" },
                ),
            );
        }
        const coordSet = new SimpleCoordSet(coords);

        // Build root dataset with shared obs/var
        const rootDataset = {
            data_vars: new Map<string, any>(),
            coords: coordSet,
            attrs,
            obs: sharedObs,
            var: sharedVar,
            async [Symbol.asyncDispose]() {},
        };

        const root = new SimpleDataTree("", { dataset: rootDataset, attrs });

        // Parse modalities from mod/ group
        try {
            const modGroup = await zarr.open(group.resolve("mod"), { kind: "group" });

            // Try known modality names from fixture or discover by listing
            // zarrita doesn't have a list-children API, so we try to detect modalities
            // from the consolidated metadata or by probing
            const modNames = await discoverModalities(group);

            for (const modName of modNames) {
                try {
                    const modLocation = (modGroup as any).resolve(modName);
                    const modZarrGroup = await zarr.open(modLocation, { kind: "group" });
                    const modAttrs = (modZarrGroup.attrs ?? {}) as Record<string, unknown>;

                    // Each modality is a full AnnData
                    if (modAttrs["encoding-type"] === "anndata") {
                        const modStorePath = storePath ? `${storePath}/mod/${modName}` : undefined;
                        const modTree = await detectAnnData.parse(modZarrGroup, modStorePath);

                        // Wrap as child of root
                        const child = new SimpleDataTree(modName, {
                            dataset: modTree.dataset,
                            attrs: modAttrs,
                            parent: root,
                        });
                        root.addChild(child);
                    }
                } catch (e) {
                    console.warn(`Failed to parse modality "${modName}":`, e);
                }
            }
        } catch {
            console.warn("No mod/ group found in MuData store");
        }

        // Parse obsmap/varmap (integer index mappings)
        try {
            const obsmapGroup = await zarr.open(group.resolve("obsmap"), { kind: "group" });
            const modNames = [...root.children.keys()];
            for (const modName of modNames) {
                try {
                    const arr = await zarr.open((obsmapGroup as any).resolve(modName), {
                        kind: "array",
                    });
                    const data = await zarr.get(arr);
                    // Store obsmap on root dataset for access
                    (rootDataset as any)[`obsmap_${modName}`] = data.data;
                } catch {
                    // obsmap entry may not exist for all modalities
                }
            }
        } catch {
            // No obsmap
        }

        return root;
    },
};

/**
 * Discover modality names in a MuData store.
 * zarrita has no list-children API, so we check consolidated metadata
 * or probe the filesystem.
 */
async function discoverModalities(rootGroup: any): Promise<string[]> {
    // Strategy 1: Check consolidated metadata (zarr v3 has it in zarr.json)
    const rootAttrs = (rootGroup.attrs ?? {}) as Record<string, unknown>;
    const consolidated = (rootAttrs as any).consolidated_metadata?.metadata?.mod
        ?.consolidated_metadata?.metadata;
    if (consolidated && typeof consolidated === "object") {
        return Object.keys(consolidated);
    }

    // Strategy 2: Try to read the mod/ group's consolidated metadata
    try {
        const modGroup = await zarr.open(rootGroup.resolve("mod"), { kind: "group" });
        const modAttrs = (modGroup.attrs ?? {}) as Record<string, unknown>;
        // Some stores list children in attrs
        if (modAttrs.consolidated_metadata) {
            const meta = (modAttrs as any).consolidated_metadata?.metadata;
            if (meta && typeof meta === "object") {
                return Object.keys(meta);
            }
        }
    } catch {
        // No consolidated metadata
    }

    // Strategy 3: For filesystem stores, list the directory
    try {
        const store = rootGroup.store ?? rootGroup.resolve?.("")?.store;
        if (store?.root) {
            const fs = await import("node:fs");
            const path = await import("node:path");
            const modDir = path.join(store.root, "mod");
            if (fs.existsSync(modDir)) {
                return fs.readdirSync(modDir).filter((entry: string) => {
                    const full = path.join(modDir, entry);
                    return fs.statSync(full).isDirectory() && !entry.startsWith(".");
                });
            }
        }
    } catch {
        // Not a filesystem store
    }

    // Strategy 4: Probe common modality names
    const common = ["rna", "atac", "protein", "cite", "spatial", "adt", "hto"];
    const found: string[] = [];
    for (const name of common) {
        try {
            await zarr.open(rootGroup.resolve(`mod/${name}`), { kind: "group" });
            found.push(name);
        } catch {
            // Not present
        }
    }
    return found;
}
