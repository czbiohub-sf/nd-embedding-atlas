/**
 * Zarr-backed image crop for the gallery viewer.
 *
 * Reads a 2D slab per visible channel out of the OME-Zarr HCS store,
 * composites them into an RGBA image, and returns PNG or WebP bytes.
 *
 * The input FOV path is relative to the plate mount
 * (e.g. "A/1/000000"). We read resolution level "0" for now — adaptive
 * pyramid selection is a future enhancement.
 */

import * as zarr from "zarrita";
import { compositeChannels, encodePng, type ChannelRequest } from "./image.ts";
import type { PlateMount } from "./plate.ts";
import { encodeWebpImage } from "./webp.ts";

export type CropFormat = "png" | "webp";

export interface CropRequest {
    fovPath: string;
    datasetKey?: string;
    t: number;
    z: number;
    x: number;
    y: number;
    /** Half-size of the crop in source pixels. */
    half: number;
    /** Output image size (pixels, square). Defaults to 2*half. */
    size?: number;
    /** Output encoding. Defaults to "png". */
    format?: CropFormat;
    /** WebP quality 0-100. Ignored for PNG. Defaults to 90. */
    quality?: number;
    channels: Array<{
        visible: boolean;
        lo: number;
        hi: number;
        /** Hex without '#'. */
        color: string;
    }>;
}

export interface CropResult {
    bytes: Uint8Array;
    mime: string;
}

/** Resolve which plate mount hosts this crop, given (optional) dataset_key. */
function resolveMount(mounts: readonly PlateMount[], datasetKey?: string): PlateMount | null {
    if (mounts.length === 0) return null;
    if (!datasetKey) {
        // Single-dataset (or fall back to first)
        return mounts[0];
    }
    return mounts.find((m) => m.datasetKey === datasetKey) ?? null;
}

/**
 * Produce a crop from the OME-Zarr plate in PNG or WebP.
 *
 * Coordinates are interpreted in source-image pixel space (level 0).
 * Channels in the request are mapped 1:1 onto the C axis by array order.
 */
export async function renderCrop(
    req: CropRequest,
    mounts: readonly PlateMount[],
): Promise<CropResult> {
    const mount = resolveMount(mounts, req.datasetKey);
    if (!mount) throw new Error("No plate mount available for crop");

    // Open resolution level 0 for this FOV.
    const fs = await import("@zarrita/storage");
    const store = new fs.FileSystemStore(mount.diskPath);
    const imagePath = `/${req.fovPath.replace(/^\/+/, "")}/0`;
    const arr = await zarr.open(zarr.root(store).resolve(imagePath), { kind: "array" });

    // Shape is [T, C, Z, Y, X] per OME-Zarr convention.
    const [_t, nC, _z, nY, nX] = arr.shape;
    void _t;
    void _z;

    const y0 = Math.max(0, req.y - req.half);
    const y1 = Math.min(nY, req.y + req.half);
    const x0 = Math.max(0, req.x - req.half);
    const x1 = Math.min(nX, req.x + req.half);
    const srcH = y1 - y0;
    const srcW = x1 - x0;
    if (srcH <= 0 || srcW <= 0) {
        throw new Error(`Crop out of bounds: y=[${y0},${y1}] x=[${x0},${x1}]`);
    }

    // Build channel requests + slabs, mapped to actual C-axis indices.
    const channelReqs: ChannelRequest[] = [];
    const slabPromises: Array<Promise<Float32Array>> = [];
    for (let c = 0; c < req.channels.length && c < nC; c++) {
        const chCfg = req.channels[c];
        channelReqs.push({
            cIndex: c,
            visible: chCfg.visible,
            lo: chCfg.lo,
            hi: chCfg.hi,
            color: chCfg.color,
        });
        if (chCfg.visible) {
            slabPromises.push(readSlab2D(arr, req.t, c, req.z, y0, y1, x0, x1));
        } else {
            // Skip the read; use an empty slab placeholder so indices align.
            slabPromises.push(Promise.resolve(new Float32Array(srcH * srcW)));
        }
    }

    const slabs = await Promise.all(slabPromises);

    const size = req.size ?? 2 * req.half;
    const rgba = compositeChannels(slabs, channelReqs, srcW, srcH, size, size);

    if (req.format === "webp") {
        const bytes = await encodeWebpImage(rgba, size, size, req.quality ?? 90);
        return { bytes, mime: "image/webp" };
    }
    return { bytes: encodePng(rgba, size, size), mime: "image/png" };
}

/**
 * Read a 2D Y×X slice from a 5D OME-Zarr array at (t, c, z, y0:y1, x0:x1).
 * Always returns a Float32Array for downstream windowing.
 */
async function readSlab2D(
    arr: zarr.Array<zarr.DataType, zarr.Readable>,
    t: number,
    c: number,
    z: number,
    y0: number,
    y1: number,
    x0: number,
    x1: number,
): Promise<Float32Array> {
    const result = await zarr.get(arr, [t, c, z, zarr.slice(y0, y1), zarr.slice(x0, x1)]);
    const data = (result as { data: ArrayLike<number> }).data;

    // Coerce to Float32Array regardless of the array's native dtype.
    if (data instanceof Float32Array) return data;
    const n = data.length;
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) out[i] = Number(data[i]);
    return out;
}
