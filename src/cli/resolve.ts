/**
 * Path resolution utilities for the CLI.
 *
 * Handles frontend dist directory resolution (dev vs compiled binary)
 * and zarr store path validation.
 */

import { existsSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { resolve } from "node:path";

// ─── Frontend directory resolution ──────────────────────────────────────────

/**
 * Resolve the frontend dist directory.
 *
 * Search order:
 *   1. `frontend/dist/` relative to the project root (dev mode)
 *   2. Embedded files in compiled Bun binary ($bunfs)
 *
 * @returns Absolute path to the frontend dist, or undefined if not found.
 */
export function resolveFrontendDir(): string | undefined {
    // Dev mode: frontend/dist/ relative to project root (3 levels up from src/cli/)
    const devPath = new URL("../../../frontend/dist", import.meta.url).pathname;
    if (existsSync(devPath)) return devPath;

    // Compiled binary: check if we're running inside $bunfs
    // Bun compiles with --compile and embeds assets via bun build --asset-naming
    // The embedded files are accessible via Bun.embeddedFiles or direct import
    try {
        const bunfsPath = "/$bunfs/frontend/dist";
        if (existsSync(bunfsPath)) return bunfsPath;
    } catch {
        // Not in a compiled binary — fine
    }

    return undefined;
}

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
