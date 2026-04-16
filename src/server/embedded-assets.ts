/**
 * Compiled binary detection for Bun --compile mode.
 *
 * When `bun build --compile` produces a single binary, all embedded files
 * live under the virtual `$bunfs/` filesystem. This module provides a
 * reliable way to detect that environment so static.ts and resolve.ts
 * can switch between disk-based and embedded asset serving.
 *
 * In dev mode (running via `bun run`), `isCompiled` is always false.
 */

// ─── Compiled binary detection ─────────────────────────────────────────────

/**
 * True when running inside a `bun build --compile` binary.
 *
 * Detection strategy: in a compiled binary, the main module path starts
 * with the `/$bunfs/` prefix (Bun's virtual embedded filesystem).
 * Falls back to checking `Bun.embeddedFiles` length for robustness.
 */
function detectCompiled(): boolean {
    try {
        // Primary: check if the main entry lives in $bunfs
        if (import.meta.path.startsWith("/$bunfs/")) return true;

        // Secondary: check if Bun has any embedded files
        const files = Bun.embeddedFiles;
        if (Array.isArray(files) && files.length > 0) return true;
    } catch {
        // Not in a Bun environment at all
    }
    return false;
}

export const isCompiled: boolean = detectCompiled();

// ─── Path constants ────────────────────────────────────────────────────────

/** Root path prefix for embedded assets in a compiled binary. */
export const BUNFS_PREFIX = "/$bunfs";

/** Embedded frontend dist path in a compiled binary. */
export const BUNFS_FRONTEND_DIST = `${BUNFS_PREFIX}/frontend/dist`;
