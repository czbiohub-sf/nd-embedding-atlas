/**
 * Bun.serve HTTP + WebSocket server factory.
 *
 * - HTTP API routes (fetch-based) and the /data/query Mosaic endpoint
 * - WebSocket: framed `workspace/watch` sync
 * - Static file serving for the React SPA frontend, or Bun's dev server
 *   (HTML import + HMR) when `devHtml` is set
 * - CORS headers for cross-origin API clients
 */

import type { HTMLBundle } from "bun";
import type { DatasetQuerySession } from "./store.ts";
import type { ServerSession, DatasetSessionMetadata } from "./state.ts";

// Route handlers
import { handleMosaicRoute } from "./routes/mosaic.ts";
import { handleMetadata } from "./routes/meta.ts";
import { routeApi } from "./api-router.ts";
import { CropPool } from "./crop-pool.ts";
import { servePlateFile } from "./plate.ts";
import { serveStatic, resolveFrontendDir } from "./static.ts";
import { handleWsMessage, handleWsOpen, handleWsClose, type ServerSocketContext } from "./ws.ts";
import { createMcpEndpoint } from "./mcp.ts";

// ─── CORS ───────────────────────────────────────────────────────────────────

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

/** Create a 204 preflight response with CORS headers. */
function corsResponse(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

/** Add CORS headers to an existing Response. */
function withCors(response: Response): Response {
  for (const [key, value] of Object.entries(CORS_HEADERS)) {
    response.headers.set(key, value);
  }
  return response;
}

// ─── App options ────────────────────────────────────────────────────────────

export interface CreateAppOptions {
  /** Port to listen on. */
  port: number;
  /** Hostname to bind to. */
  host: string;
  /** Initialized analytical dataset query session (obs loaded into DuckDB). */
  store: DatasetQuerySession;
  /** Mutable server session state. */
  state: ServerSession;
  /** Static metadata for /data/metadata.json. */
  config: DatasetSessionMetadata;
  /** Path to frontend dist directory (optional; auto-resolved if omitted). */
  frontendDir?: string;
  /** Disable static file serving (API-only mode). */
  noStatic?: boolean;
  /** Dev mode: serve this `index.html` import through Bun's dev server (bundling + HMR) instead of the built bundle. */
  devHtml?: HTMLBundle;
  /** Bearer token that /mcp requires; without one the MCP endpoint is off. */
  mcpToken?: string;
}

// ─── Server factory ─────────────────────────────────────────────────────────

/**
 * Create a Bun.serve server with HTTP routes and WebSocket support.
 *
 * HTTP routes match the frontend API contract (see frontend/API_CONTRACT.md).
 * WebSocket support is stubbed for future axial protocol migration.
 */
export function createApp(options: CreateAppOptions) {
  const { store, state, config } = options;
  const frontendDir = options.noStatic || options.devHtml ? null : resolveFrontendDir(options.frontendDir);
  const mcp = options.mcpToken ? createMcpEndpoint(state, options.mcpToken) : null;

  // Spin up the Bun Worker pool for crop rendering when a plate is
  // available. Pool persists for the lifetime of the server; workers keep
  // their zarr Array LRU + WebP WASM init warm across requests.
  if (state.plateMounts.length > 0 && !state.cropPool) {
    state.cropPool = new CropPool(state.plateMounts);
  }

  return Bun.serve<ServerSocketContext>({
    port: options.port,
    hostname: options.host,
    routes: options.devHtml ? { "/": options.devHtml } : {},
    development: options.devHtml ? { hmr: true, console: true } : false,

    async fetch(req, server) {
      const url = new URL(req.url);
      const { pathname } = url;

      // ── MCP (Streamable HTTP): its own Host/Origin/token guard, no CORS ──
      if (pathname === "/mcp") return mcp ? mcp(req) : new Response("Not Found", { status: 404 });

      // ── WebSocket upgrade (ndea framed protocol, _id/_type JSON) ─
      if (req.headers.get("upgrade") === "websocket") {
        const upgraded = server.upgrade(req, { data: { state } });
        if (!upgraded) {
          return withCors(new Response("WebSocket upgrade failed", { status: 400 }));
        }
        // After a successful upgrade, Bun takes over: return a 101 sentinel.
        return new Response(null, { status: 101 });
      }

      // ── CORS preflight ──────────────────────────────────────────
      if (req.method === "OPTIONS") {
        return corsResponse();
      }

      // ── Route dispatch ──────────────────────────────────────────
      try {
        const response = await routeRequest(req, url, pathname, store, state, config, frontendDir, options);
        return withCors(response);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[ndea] Unhandled error: ${message}`);
        return withCors(Response.json({ error: message }, { status: 500 }));
      }
    },

    websocket: {
      message: handleWsMessage,
      open: handleWsOpen,
      close: handleWsClose,
    },
  });
}

// ─── Route dispatch ─────────────────────────────────────────────────────────

async function routeRequest(
  req: Request,
  url: URL,
  pathname: string,
  store: DatasetQuerySession,
  state: ServerSession,
  config: DatasetSessionMetadata,
  frontendDir: string | null,
  options: CreateAppOptions,
): Promise<Response> {
  // ── Mosaic query protocol (POST/GET /data/query) ────────────────
  if (pathname === "/data/query") {
    return handleMosaicRoute(req, store);
  }

  // ── Metadata (GET /data/metadata.json) ──────────────────────────
  if (pathname === "/data/metadata.json" && req.method === "GET") {
    return handleMetadata(state, config);
  }

  // Colormap surface moved to the frontend in Phase 8: see
  // src/frontend/lib/ochre-palette.ts. Backend no longer serves
  // /data/colormaps or /data/categorical-palette.

  // ── API routes (/api/*) ─────────────────────────────────────────
  if (pathname.startsWith("/api/")) {
    return routeApi(req, url, pathname, store, state);
  }

  // ── Plate static (/plate/**) for OME-Zarr HCS stores ────────────
  if (pathname === "/plate" || pathname.startsWith("/plate/")) {
    const plateResp = await servePlateFile(pathname, state.plateMounts);
    if (plateResp) return plateResp;
  }

  // ── Static frontend files ───────────────────────────────────────
  if (!options.noStatic && !options.devHtml) {
    return serveStatic(pathname, frontendDir);
  }
  return new Response("Not Found", { status: 404 });
}
