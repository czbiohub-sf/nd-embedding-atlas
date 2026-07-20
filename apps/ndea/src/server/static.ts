/**
 * Static file serving for the React SPA frontend.
 *
 * Resolution order:
 * 1. Explicit `frontendDir` option (caller passed an absolute path)
 * 2. Compiled binary: embedded `$bunfs/frontend/dist` (wins over CWD)
 * 3. Dev mode (uncompiled): `dist/frontend/` relative to CWD
 * 4. Return 404
 *
 * The compiled-vs-CWD priority is intentional: a stale `dist/frontend/`
 * in some unrelated CWD (e.g. another worktree the user happens to be
 * in) used to silently shadow the embedded bundle, leading to "I
 * rebuilt but the browser still shows the old code" debugging dead-
 * ends. For compiled binaries, the embedded bundle is the source of
 * truth; users who want to override it pass `--frontend-dir`.
 *
 * Uses Bun.file() for efficient zero-copy serving.
 * SPA fallback: non-file requests (no extension) serve index.html.
 */

import { resolve, extname, isAbsolute, join, relative, sep } from "node:path";
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
  // 1. Explicit override always wins: this is the documented escape
  //    hatch for "I have a custom frontend at /tmp/whatever, use it".
  if (frontendDir) {
    const resolved = resolve(frontendDir);
    if (existsSync(join(resolved, "index.html"))) return resolved;
  }

  // 2. Compiled binary: embedded assets are the source of truth.
  //    Checked BEFORE the CWD-based dev path so a stale `dist/frontend/`
  //    in an unrelated worktree can't silently shadow the bundle that
  //    was actually compiled into the binary.
  if (isCompiled && "index.html" in EMBEDDED_ASSETS) {
    return "__embedded__";
  }

  // 3. Uncompiled mode: use the repository build output.
  const devDist = resolve(import.meta.dir, "../../../../dist/frontend");
  if (existsSync(join(devDist, "index.html"))) return devDist;

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
  if (rel.includes("\\")) return null;

  if (frontendDir === "__embedded__") {
    // Compiled binary: consult the generated manifest for a $bunfs path.
    return EMBEDDED_ASSETS[rel] ?? null;
  }

  const abs = resolve(frontendDir, rel);
  const contained = relative(frontendDir, abs);
  if (contained === ".." || contained.startsWith(`..${sep}`) || isAbsolute(contained)) return null;
  return existsSync(abs) ? abs : null;
}

export function serveStatic(pathname: string, frontendDir: string | null): Response {
  if (!frontendDir) {
    return new Response(
      "Frontend bundle not found. For dev use `vp run dev <dataset>` (serves the frontend on :5173). For a standalone backend, run `vp run build` first.",
      {
        status: 404,
        headers: { "Content-Type": "text/plain" },
      },
    );
  }

  const filePath = resolveAssetPath(pathname, frontendDir);
  if (filePath) {
    const ext = extname(filePath);
    const contentType = MIME[ext] ?? "application/octet-stream";

    // Cache fingerprinted assets aggressively. Bun emits hashed files flat at
    // the root as `<name>-<hash>.<ext>` (base36 hash), so match that fingerprint
    // rather than Vite's old `/assets/` + hex convention.
    const isHashed = /-[a-z0-9]{8,}\.[a-z0-9]+$/i.test(pathname);
    const cacheControl = isHashed ? "public, max-age=31536000, immutable" : "public, max-age=0, must-revalidate";

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
