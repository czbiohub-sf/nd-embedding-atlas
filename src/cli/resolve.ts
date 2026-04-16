/**
 * Path resolution utilities for the CLI.
 *
 * Handles zarr store path validation and network address lookup.
 * Frontend dist resolution lives in `server/static.ts`.
 */

import { existsSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { resolve } from "node:path";

// ─── Zarr path validation ───────────────────────────────────────────────────

/**
 * Validate that a path looks like an existing zarr store.
 *
 * Checks for directory existence and the presence of a `.zgroup`,
 * `.zarray`, or `zarr.json` marker (Zarr v2 or v3).
 *
 * @returns Resolved absolute path.
 * @throws If the path doesn't exist or doesn't look like zarr.
 */
export function validateZarrPath(path: string): string {
    const abs = resolve(path);

    if (!existsSync(abs)) {
        throw new Error(`Path does not exist: ${abs}`);
    }

    // Check for zarr markers
    const markers = [".zgroup", ".zarray", "zarr.json", ".zattrs"];
    const hasMarker = markers.some((m) => existsSync(resolve(abs, m)));

    if (!hasMarker) {
        throw new Error(
            `Path does not look like a zarr store (no .zgroup, .zarray, or zarr.json): ${abs}`,
        );
    }

    return abs;
}

// ─── Network helpers ────────────────────────────────────────────────────────

/**
 * Get the local network address for the startup banner.
 *
 * @returns The first non-internal IPv4 address, or undefined.
 */
export function getNetworkAddress(): string | undefined {
    try {
        const interfaces = networkInterfaces();
        for (const iface of Object.values(interfaces)) {
            if (!iface) continue;
            for (const info of iface) {
                if (info.family === "IPv4" && !info.internal) {
                    return info.address;
                }
            }
        }
    } catch {
        // networkInterfaces unavailable — skip
    }
    return undefined;
}
