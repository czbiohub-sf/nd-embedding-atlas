import * as zarr from "zarrita";
import type { Readable } from "zarrita";
import FileSystemStore from "@zarrita/storage/fs";
import type { AxialConfig, Convention, DataTree } from "../core/types.ts";
import { detectOmeZarr } from "../conventions/ome-zarr.ts";
import { detectAnnData } from "../conventions/anndata.ts";
import { detectMuData } from "../conventions/mudata.ts";
import { detectXarray } from "../conventions/xarray.ts";

export interface OpenOptions {
    /** Override convention detection. */
    convention?: "ome-zarr" | "anndata" | "mudata" | "xarray";
    /** Configuration overrides. */
    config?: Partial<AxialConfig>;
}

const CONVENTIONS: Convention[] = [detectOmeZarr, detectMuData, detectAnnData, detectXarray];

/**
 * Open a Zarr store and auto-detect its convention.
 *
 * Local filesystem paths use parallel worker reads (42x faster for large datasets).
 * HTTP/HTTPS URLs use FetchStore with sequential reads.
 *
 * @param location - Path to local Zarr store, or URL for remote.
 * @param options - Optional overrides.
 * @returns A DataTree representing the store hierarchy.
 *
 * @example
 * ```ts
 * import { open } from "axial";
 *
 * const tree = await open("./experiment.zarr");        // local, parallel
 * const remote = await open("https://s3.../data.zarr"); // remote, sequential
 * ```
 */
export async function open(location: string | Readable, options?: OpenOptions): Promise<DataTree> {
    void options?.config;

    // Resolve store + detect if local filesystem
    let store: Readable;
    let storePath: string | undefined;

    if (typeof location === "string") {
        const isRemote = location.startsWith("http://") || location.startsWith("https://");
        if (isRemote) {
            store = new zarr.FetchStore(location);
        } else {
            store = new FileSystemStore(location);
            storePath = location; // enables parallel worker reads
        }
    } else {
        store = location;
    }

    // Open root group
    const root = await zarr.open(store as any, { kind: "group" });
    const rootAttrs = (root.attrs ?? {}) as Record<string, unknown>;

    // Convention detection
    if (options?.convention) {
        const conv = CONVENTIONS.find((c) => c.name === options.convention);
        if (!conv) throw new Error(`Unknown convention: ${options.convention}`);
        return conv.parse(root, storePath);
    }

    for (const conv of CONVENTIONS) {
        if (conv.detect(rootAttrs)) {
            return conv.parse(root, storePath);
        }
    }

    throw new Error(
        "Could not detect Zarr store convention. " +
            "Expected OME-Zarr (multiscales), AnnData (encoding-type: anndata), " +
            "MuData (encoding-type: MuData), or xarray (_ARRAY_DIMENSIONS). " +
            `Root attrs: ${JSON.stringify(Object.keys(rootAttrs))}`,
    );
}
