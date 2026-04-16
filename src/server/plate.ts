/**
 * Plate static serving + OME-Zarr HCS metadata extraction.
 *
 * Mounts:
 *   - Single-dataset: "/plate"              → platePath
 *   - Multi-dataset:  "/plate/{datasetKey}" → platePath (per dataset)
 *
 * The frontend zarr client fetches plate chunks directly against these
 * mount prefixes (see frontend SingleCropViewer: `${mount}/${fov_name}`).
 *
 * This module also reads HCS plate metadata (omero.channels,
 * coordinateTransformations, version) from the first discoverable image
 * so the dashboard can render channel controls without a second round-trip.
 */

import { readdir } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface PlateMount {
    /** URL mount prefix, e.g. "/plate" or "/plate/datasetKey". No trailing slash. */
    mount: string;
    /** Absolute path to the OME-Zarr HCS store on disk. */
    diskPath: string;
    /** Dataset key (same as mount basename for multi-dataset, or null for single). */
    datasetKey: string | null;
}

export interface PlateChannel {
    label: string;
    /** Hex without '#', e.g. "FF0000". */
    color: string;
    window: { start: number; end: number; min: number; max: number };
}

export interface PlateMetaInfo {
    omeVersion: "0.4" | "0.5";
    channels: PlateChannel[];
    /** [x, y] in physical units. */
    pixelScale: { x: number; y: number };
}

// ─── MIME & zarr extensions ─────────────────────────────────────────────────

const ZARR_MIME: Record<string, string> = {
    ".zattrs": "application/json",
    ".zgroup": "application/json",
    ".zarray": "application/json",
    ".json": "application/json",
};

// ─── Static serving ─────────────────────────────────────────────────────────

/**
 * Serve a file under a plate mount. Returns null if no mount matches — the
 * caller should then fall through to 404.
 *
 * Path traversal (e.g. "../../etc/passwd") is rejected by resolving against
 * the disk root and ensuring the resolved path stays inside.
 */
export async function servePlateFile(
    pathname: string,
    mounts: readonly PlateMount[],
): Promise<Response | null> {
    // Mounts are expected longest-first (see `buildPlateMounts`).
    const match = mounts.find((m) => pathname === m.mount || pathname.startsWith(m.mount + "/"));
    if (!match) return null;

    const rel = pathname.slice(match.mount.length).replace(/^\/+/, "");
    const requested = resolve(match.diskPath, rel);
    const root = resolve(match.diskPath);
    // Reject traversal
    if (requested !== root && !requested.startsWith(root + sep)) {
        return new Response("Forbidden", { status: 403 });
    }

    const file = Bun.file(requested);
    if (!(await file.exists())) {
        return new Response("Not Found", { status: 404 });
    }

    const ext = extname(requested);
    const contentType = ZARR_MIME[ext] ?? "application/octet-stream";
    return new Response(file, {
        headers: {
            "Content-Type": contentType,
            // Zarr chunks are content-addressed; plate metadata changes rarely.
            "Cache-Control": "public, max-age=3600",
        },
    });
}

// ─── Mount construction ─────────────────────────────────────────────────────

/**
 * Build mount descriptors from dataset configs. Returns a list sorted
 * longest-mount-first so `/plate/dataset` beats a bare `/plate` catch-all.
 */
export function buildPlateMounts(
    datasets: Iterable<[string, { platePath?: string }]>,
    isMultiDataset: boolean,
): PlateMount[] {
    const mounts: PlateMount[] = [];
    for (const [name, cfg] of datasets) {
        if (!cfg.platePath) continue;
        const mount = isMultiDataset ? `/plate/${name}` : "/plate";
        mounts.push({
            mount,
            diskPath: resolve(cfg.platePath),
            datasetKey: isMultiDataset ? name : null,
        });
    }
    // Longest mount first — important for the dispatch order.
    mounts.sort((a, b) => b.mount.length - a.mount.length);
    return mounts;
}

// ─── HCS metadata extraction ────────────────────────────────────────────────

/**
 * Read OME-Zarr HCS plate metadata by probing the first discoverable image.
 *
 * Layout (v0.4): plate/.zattrs → plate.wells[0].path → well/ → image dir →
 *                image/.zattrs → omero.channels + multiscales.
 *
 * Returns null on any I/O failure — plate rendering still works via the
 * frontend's per-image fallback, just without pre-populated channel controls.
 */
export async function readPlateMeta(platePath: string): Promise<PlateMetaInfo | null> {
    try {
        const plateRoot = resolve(platePath);
        const plateAttrs = await readJson(join(plateRoot, ".zattrs"));
        const plate = (plateAttrs["plate"] ?? {}) as {
            version?: string;
            wells?: Array<{ path?: string }>;
        };
        const wellRel = plate.wells?.[0]?.path;
        if (!wellRel) return null;

        const wellDir = join(plateRoot, wellRel);
        const images = await listImageDirs(wellDir);
        if (images.length === 0) return null;

        const imageAttrs = await readJson(join(wellDir, images[0], ".zattrs"));
        const multiscales = (imageAttrs["multiscales"] as unknown[]) ?? [];
        const first = (multiscales[0] ?? {}) as {
            version?: string;
            axes?: Array<{ name?: string }>;
            datasets?: Array<{
                coordinateTransformations?: Array<{ type?: string; scale?: number[] }>;
            }>;
        };

        const msVersion = first.version ?? plate.version ?? "0.4";
        const omeVersion: "0.4" | "0.5" = msVersion.startsWith("0.5") ? "0.5" : "0.4";

        const pixelScale = extractPixelScale(first);

        const channels = extractChannels(imageAttrs);

        return { omeVersion, channels, pixelScale };
    } catch {
        return null;
    }
}

async function readJson(path: string): Promise<Record<string, unknown>> {
    return (await Bun.file(path).json()) as Record<string, unknown>;
}

/**
 * List subdirectories of `wellDir` that look like OME-Zarr images
 * (i.e. contain a `.zattrs`). Some stores include non-image entries
 * (e.g. `.zgroup` file) which we filter out via the directory check.
 */
async function listImageDirs(wellDir: string): Promise<string[]> {
    const names = await readdir(wellDir);
    const imageDirs: string[] = [];
    await Promise.all(
        names.map(async (name) => {
            if (name.startsWith(".")) return;
            const attrsPath = join(wellDir, name, ".zattrs");
            if (await Bun.file(attrsPath).exists()) {
                imageDirs.push(name);
            }
        }),
    );
    imageDirs.sort();
    return imageDirs;
}

/**
 * Extract [x, y] pixel-to-physical scale from the first dataset's
 * coordinateTransformations. Axes order is T,C,Z,Y,X (OME-Zarr), so X/Y are
 * the last two scale entries.
 */
function extractPixelScale(multiscale: {
    axes?: Array<{ name?: string }>;
    datasets?: Array<{
        coordinateTransformations?: Array<{ type?: string; scale?: number[] }>;
    }>;
}): { x: number; y: number } {
    const transforms = multiscale.datasets?.[0]?.coordinateTransformations ?? [];
    const scale = transforms.find((t) => t.type === "scale")?.scale;
    if (!scale) return { x: 1, y: 1 };

    const axes = multiscale.axes ?? [];
    // Map axis name → scale position
    const nameToScale = new Map<string, number>();
    for (let i = 0; i < axes.length && i < scale.length; i++) {
        const n = axes[i]?.name?.toUpperCase();
        if (n) nameToScale.set(n, scale[i]);
    }

    return {
        x: nameToScale.get("X") ?? scale[scale.length - 1] ?? 1,
        y: nameToScale.get("Y") ?? scale[scale.length - 2] ?? 1,
    };
}

function extractChannels(imageAttrs: Record<string, unknown>): PlateChannel[] {
    const omero = imageAttrs["omero"] as { channels?: unknown[] } | undefined;
    const raw = omero?.channels ?? [];
    const out: PlateChannel[] = [];
    for (const ch of raw) {
        const c = ch as {
            label?: string;
            color?: string;
            window?: { start?: number; end?: number; min?: number; max?: number };
        };
        out.push({
            label: c.label ?? "",
            color: (c.color ?? "FFFFFF").replace(/^#/, "").toUpperCase(),
            window: {
                start: Number(c.window?.start ?? 0),
                end: Number(c.window?.end ?? 1),
                min: Number(c.window?.min ?? 0),
                max: Number(c.window?.max ?? 1),
            },
        });
    }
    return out;
}
