/**
 * Bun.serve HTTP + WebSocket server factory.
 *
 * Replaces Python FastAPI create_app(). Supports:
 * - HTTP routes for immediate frontend compatibility (fetch-based)
 * - WebSocket data protocol for future migration (axial typed WS)
 * - Static file serving for the React SPA frontend
 * - CORS headers for dev mode (Vite on :5173, backend on :5055)
 */

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
import { handleMosaicWsMessage } from "./mosaic-ws.ts";
import { emptyPluginRuntimeSnapshot, servePluginAsset, type PluginRuntimeSnapshot } from "./plugins/assets.ts";

// Re-exports for public API
export { DatasetQuerySession, obsmColumnPrefix, DEFAULT_OBSM_PRIORITY } from "./store.ts";
export { handleMosaicQuery, parseMosaicQuery, isAllowedSql, ARROW_IPC_CONTENT_TYPE } from "./mosaic.ts";
export { detectSpatialColumns, parseBbox } from "./state.ts";
export type {
  SpatialColumns,
  DatasetChannelConfig,
  DatasetMountConfig,
  DatasetSessionMetadata,
  ServerSession,
  BboxRect,
} from "./state.ts";
export type { MosaicQuery } from "./mosaic.ts";
export type { RegisteredEmbedding } from "./store.ts";
export type { NdeaProtocol } from "./protocol.ts";

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
  /** Immutable plugin catalog and approved asset map built once during startup. */
  pluginSnapshot?: PluginRuntimeSnapshot;
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
  const frontendDir = options.noStatic ? null : resolveFrontendDir(options.frontendDir);
  const pluginSnapshot = options.pluginSnapshot ?? emptyPluginRuntimeSnapshot();

  // Spin up the Bun Worker pool for crop rendering when a plate is
  // available. Pool persists for the lifetime of the server; workers keep
  // their zarr Array LRU + WebP WASM init warm across requests.
  if (state.plateMounts.length > 0 && !state.cropPool) {
    state.cropPool = new CropPool(state.plateMounts);
  }

  return Bun.serve<ServerSocketContext>({
    port: options.port,
    hostname: options.host,

    async fetch(req, server) {
      const url = new URL(req.url);
      const { pathname } = url;

      // ── WebSocket upgrade ───────────────────────────────────────
      // /mosaic → Mosaic socketConnector framing (raw {type, sql}, binary arrow)
      // any other path → ndea framed protocol (_id/_type JSON)
      if (req.headers.get("upgrade") === "websocket") {
        const kind: ServerSocketContext["kind"] = pathname === "/mosaic" ? "mosaic" : "ndea";
        const upgraded = server.upgrade(req, { data: { kind, state, store } });
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
        const response = await routeRequest(
          req,
          url,
          pathname,
          store,
          state,
          config,
          frontendDir,
          pluginSnapshot,
          options,
        );
        return withCors(response);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[ndea] Unhandled error: ${message}`);
        return withCors(Response.json({ error: message }, { status: 500 }));
      }
    },

    websocket: {
      message(ws, raw) {
        if (ws.data.kind === "mosaic") {
          void handleMosaicWsMessage(ws, raw);
          return;
        }
        handleWsMessage(ws, raw);
      },
      open(ws) {
        if (ws.data.kind === "mosaic") return;
        handleWsOpen(ws);
      },
      close(ws) {
        if (ws.data.kind === "mosaic") return;
        handleWsClose(ws);
      },
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
  pluginSnapshot: PluginRuntimeSnapshot,
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
    return routeApi(req, url, pathname, store, state, pluginSnapshot);
  }

  // ── Trusted plugin assets (startup-approved exact URLs only) ───
  if (pathname === "/plugins" || pathname.startsWith("/plugins/")) {
    return servePluginAsset(pathname, pluginSnapshot) ?? new Response("Not Found", { status: 404 });
  }

  // ── Plate static (/plate/**) for OME-Zarr HCS stores ────────────
  if (pathname === "/plate" || pathname.startsWith("/plate/")) {
    const plateResp = await servePlateFile(pathname, state.plateMounts);
    if (plateResp) return plateResp;
  }

  // ── Static frontend files ───────────────────────────────────────
  if (!options.noStatic) {
    return serveStatic(pathname, frontendDir);
  }

  // `--no-static` mode: backend is API-only and the Vite dev server owns
  // the HTML bundle on :5173. Anyone landing here in a browser probably
  // guessed the backend port: point them at the dev URL.
  if (req.headers.get("accept")?.includes("text/html")) {
    return new Response(
      `<!doctype html><html><body style="font-family:system-ui;padding:2rem;line-height:1.5"><h2>Backend (no static)</h2><p>The API backend is running on this port (${options.port}). The dev frontend is served by Vite: open <a href="http://${options.host}:5173">http://${options.host}:5173</a>.</p></body></html>`,
      { status: 404, headers: { "Content-Type": "text/html; charset=utf-8" } },
    );
  }
  return new Response("Not Found", { status: 404 });
}
