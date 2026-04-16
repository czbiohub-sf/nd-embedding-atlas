/**
 * Static file serving for the React SPA frontend.
 *
 * Resolution order:
 * 1. Explicit `frontendDir` option
 * 2. `frontend/dist/` relative to project root (dev mode)
 * 3. Embedded `$bunfs/frontend/dist` (compiled binary mode)
 * 4. Return 404
 *
 * Uses Bun.file() for efficient zero-copy serving.
 * SPA fallback: non-file requests (no extension) serve index.html.
 */

import { resolve, extname, join } from "node:path";
import { existsSync } from "node:fs";
import { isCompiled, BUNFS_FRONTEND_DIST } from "./embedded-assets.ts";

// ─── MIME type mapping ──────────────────────────────────────────────────────

const MIME: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript",
    ".mjs": "application/javascript",
    ".css": "text/css",
    ".json": "application/json",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".ttf": "font/ttf",
    ".wasm": "application/wasm",
    ".map": "application/json",
    ".webp": "image/webp",
    ".avif": "image/avif",
};

// ─── Frontend directory resolution ──────────────────────────────────────────

/**
 * Resolve the frontend static directory.
 *
 * @param frontendDir  Explicit directory path (highest priority).
 * @returns Absolute path to the frontend dist directory, or null if not found.
 */
export function resolveFrontendDir(frontendDir?: string): string | null {
    // 1. Explicit override
    if (frontendDir) {
        const resolved = resolve(frontendDir);
        if (existsSync(join(resolved, "index.html"))) return resolved;
    }

    // 2. Dev mode: look for frontend/dist relative to CWD
    const devDist = resolve("frontend/dist");
    if (existsSync(join(devDist, "index.html"))) return devDist;

    // 3. Compiled binary: embedded assets under $bunfs
    if (isCompiled) {
        return BUNFS_FRONTEND_DIST;
    }

    return null;
}

// ─── Static file handler ────────────────────────────────────────────────────

/**
 * Serve a static file from the frontend directory.
 *
 * Works with both disk-based paths and `$bunfs/` virtual paths in compiled binaries.
 * Bun.file() handles both transparently.
 *
 * @param pathname     URL pathname (e.g. "/" or "/assets/index-abc.js")
 * @param frontendDir  Resolved frontend directory path (from resolveFrontendDir).
 * @returns Response with correct Content-Type, or null if the directory is unavailable.
 */
export function serveStatic(pathname: string, frontendDir: string | null): Response {
    if (!frontendDir) {
        return new Response("Frontend not found. Run `cd frontend && vp build` first.", {
            status: 404,
            headers: { "Content-Type": "text/plain" },
        });
    }

    // Map "/" to "index.html"
    const filePath =
        pathname === "/" ? join(frontendDir, "index.html") : join(frontendDir, pathname);

    // Bun.file() works for both disk paths and $bunfs/ paths in compiled binaries.
    // For disk paths we can use existsSync; for $bunfs we try Bun.file().size > 0.
    const file = Bun.file(filePath);

    if (isCompiled ? file.size > 0 : existsSync(filePath)) {
        const ext = extname(filePath);
        const contentType = MIME[ext] ?? "application/octet-stream";

        // Cache immutable hashed assets aggressively
        const isHashed = pathname.includes("/assets/") && /\.[a-f0-9]{8,}\./.test(pathname);
        const cacheControl = isHashed
            ? "public, max-age=31536000, immutable"
            : "public, max-age=0, must-revalidate";

        return new Response(file, {
            headers: {
                "Content-Type": contentType,
                "Cache-Control": cacheControl,
            },
        });
    }

    // SPA fallback: if the path has no extension, serve index.html
    // This supports client-side routing (e.g. /scatter, /table)
    const ext = extname(pathname);
    if (!ext) {
        const indexPath = join(frontendDir, "index.html");
        const indexFile = Bun.file(indexPath);

        if (isCompiled ? indexFile.size > 0 : existsSync(indexPath)) {
            return new Response(indexFile, {
                headers: {
                    "Content-Type": "text/html; charset=utf-8",
                    "Cache-Control": "public, max-age=0, must-revalidate",
                },
            });
        }
    }

    return new Response("Not Found", { status: 404 });
}
