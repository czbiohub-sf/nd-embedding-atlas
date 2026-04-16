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
import { isCompiled } from "./embedded-assets.ts";
import { EMBEDDED_ASSETS } from "./__generated-embedded-assets.ts";

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

    // 3. Compiled binary: resolution happens via EMBEDDED_ASSETS map in
    //    serveStatic — return a sentinel so the caller knows we're good.
    if (isCompiled && "index.html" in EMBEDDED_ASSETS) {
        return "__embedded__";
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
/** Resolve a URL pathname to the file path that actually backs it. */
function resolveAssetPath(pathname: string, frontendDir: string): string | null {
    const rel = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");

    if (frontendDir === "__embedded__") {
        // Compiled binary: consult the generated manifest for a $bunfs path.
        return EMBEDDED_ASSETS[rel] ?? null;
    }

    const abs = join(frontendDir, rel);
    return existsSync(abs) ? abs : null;
}

export function serveStatic(pathname: string, frontendDir: string | null): Response {
    if (!frontendDir) {
        return new Response("Frontend not found. Run `cd frontend && vp build` first.", {
            status: 404,
            headers: { "Content-Type": "text/plain" },
        });
    }

    const filePath = resolveAssetPath(pathname, frontendDir);
    if (filePath) {
        const ext = extname(filePath);
        const contentType = MIME[ext] ?? "application/octet-stream";

        // Cache immutable hashed assets aggressively
        const isHashed = pathname.includes("/assets/") && /\.[a-f0-9]{8,}\./.test(pathname);
        const cacheControl = isHashed
            ? "public, max-age=31536000, immutable"
            : "public, max-age=0, must-revalidate";

        return new Response(Bun.file(filePath), {
            headers: {
                "Content-Type": contentType,
                "Cache-Control": cacheControl,
            },
        });
    }

    // SPA fallback: if the path has no extension, serve index.html.
    if (!extname(pathname)) {
        const indexPath = resolveAssetPath("/", frontendDir);
        if (indexPath) {
            return new Response(Bun.file(indexPath), {
                headers: {
                    "Content-Type": "text/html; charset=utf-8",
                    "Cache-Control": "public, max-age=0, must-revalidate",
                },
            });
        }
    }

    return new Response("Not Found", { status: 404 });
}
