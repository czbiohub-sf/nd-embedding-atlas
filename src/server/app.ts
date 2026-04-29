/**
 * Bun.serve HTTP + WebSocket server factory.
 *
 * Replaces Python FastAPI create_app(). Supports:
 * - HTTP routes for immediate frontend compatibility (fetch-based)
 * - WebSocket data protocol for future migration (axial typed WS)
 * - Static file serving for the React SPA frontend
 * - CORS headers for dev mode (Vite on :5173, backend on :5055)
 */

import type { EmbeddingStore } from "./store.ts";
import type { ViewerState, DatasetMeta } from "./state.ts";

// Route handlers
import { handleMosaicRoute } from "./routes/mosaic.ts";
import { handleMetadata } from "./routes/meta.ts";
import { handleConfig } from "./routes/config.ts";
import { handleLoadEmbedding, handleEmbeddingStatus } from "./routes/embeddings.ts";
import {
  handleScatterPositions,
  handleScatterCategories,
  handleScatterContinuousValues,
  handleScatterSelectionPost,
  handleScatterSelectionDelete,
} from "./routes/scatter.ts";
import { handleTrajectory } from "./routes/trajectory.ts";
import { handleObsBatch, handleObsInfo, handleObsDetail, handleHealth } from "./routes/obs.ts";
import { handleListObsSets, handleCreateObsSet, handleDeleteObsSet, handleActivateObsSet } from "./routes/obssets.ts";
import { handleVarNames, handleVarLayers, handleVarColumn, handleVarColumnStatus } from "./routes/var.ts";
import { handleCategorize } from "./routes/categorize.ts";
import { handleExport, handleExportStatus } from "./routes/export.ts";
import { handleCrop } from "./routes/crops.ts";
import { servePlateFile } from "./plate.ts";
import { serveStatic, resolveFrontendDir } from "./static.ts";
import { handleWsMessage, handleWsOpen, handleWsClose, type WsContext } from "./ws.ts";
import { handleMosaicWsMessage } from "./mosaic-ws.ts";

// Re-exports for public API
export { EmbeddingStore, obsmColumnPrefix, DEFAULT_OBSM_PRIORITY } from "./store.ts";
export { handleMosaicQuery, parseMosaicQuery, isAllowedSql, ARROW_IPC_CONTENT_TYPE } from "./mosaic.ts";
export { detectSpatialColumns, parseBbox } from "./state.ts";
export type { SpatialColumns, ChannelConfig, DatasetConfig, DatasetMeta, ViewerState, BboxRect } from "./state.ts";
export type { MosaicQuery } from "./mosaic.ts";
export type { EmbeddingMeta } from "./store.ts";
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

export interface AppOptions {
  /** Port to listen on. */
  port: number;
  /** Hostname to bind to. */
  host: string;
  /** Initialized EmbeddingStore (obs loaded into DuckDB). */
  store: EmbeddingStore;
  /** Viewer session state. */
  state: ViewerState;
  /** Static metadata for /data/metadata.json. */
  config: DatasetMeta;
  /** Path to frontend dist directory (optional; auto-resolved if omitted). */
  frontendDir?: string;
  /** Disable static file serving (API-only mode). */
  noStatic?: boolean;
}

// ─── Server factory ─────────────────────────────────────────────────────────

/**
 * Create a Bun.serve server with HTTP routes and WebSocket support.
 *
 * HTTP routes match the frontend API contract (see frontend/API_CONTRACT.md).
 * WebSocket support is stubbed for future axial protocol migration.
 */
export function createApp(options: AppOptions) {
  const { store, state, config } = options;
  const frontendDir = options.noStatic ? null : resolveFrontendDir(options.frontendDir);

  return Bun.serve<WsContext>({
    port: options.port,
    hostname: options.host,

    async fetch(req, server) {
      const url = new URL(req.url);
      const { pathname } = url;

      // ── WebSocket upgrade ───────────────────────────────────────
      // /mosaic → Mosaic socketConnector framing (raw {type, sql}, binary arrow)
      // any other path → ndea framed protocol (_id/_type JSON)
      if (req.headers.get("upgrade") === "websocket") {
        const kind: WsContext["kind"] = pathname === "/mosaic" ? "mosaic" : "ndea";
        const upgraded = server.upgrade(req, { data: { kind, state, store } });
        if (!upgraded) {
          return withCors(new Response("WebSocket upgrade failed", { status: 400 }));
        }
        // After a successful upgrade, Bun takes over — return a 101 sentinel.
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
  store: EmbeddingStore,
  state: ViewerState,
  config: DatasetMeta,
  frontendDir: string | null,
  options: AppOptions,
): Promise<Response> {
  // ── Mosaic query protocol (POST/GET /data/query) ────────────────
  if (pathname === "/data/query") {
    return handleMosaicRoute(req, store);
  }

  // ── Metadata (GET /data/metadata.json) ──────────────────────────
  if (pathname === "/data/metadata.json" && req.method === "GET") {
    return handleMetadata(state, config);
  }

  // Colormap surface moved to the frontend in Phase 8 — see
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
  if (!options.noStatic) {
    return serveStatic(pathname, frontendDir);
  }

  // `--no-static` mode: backend is API-only and the Vite dev server owns
  // the HTML bundle on :5173. Anyone landing here in a browser probably
  // guessed the backend port — point them at the dev URL.
  if (req.headers.get("accept")?.includes("text/html")) {
    return new Response(
      `<!doctype html><html><body style="font-family:system-ui;padding:2rem;line-height:1.5"><h2>Backend (no static)</h2><p>The API backend is running on this port (${options.port}). The dev frontend is served by Vite — open <a href="http://${options.host}:5173">http://${options.host}:5173</a>.</p></body></html>`,
      { status: 404, headers: { "Content-Type": "text/html; charset=utf-8" } },
    );
  }
  return new Response("Not Found", { status: 404 });
}

// ─── API sub-router ─────────────────────────────────────────────────────────

interface ApiCtx {
  req: Request;
  url: URL;
  store: EmbeddingStore;
  state: ViewerState;
}

type ApiHandler = (ctx: ApiCtx, params: string[]) => Response | Promise<Response>;

interface ApiRoute {
  method: "GET" | "POST" | "DELETE";
  match: string | RegExp;
  handler: ApiHandler;
}

const API_ROUTES: ApiRoute[] = [
  { method: "GET", match: "/api/health", handler: ({ state }) => handleHealth(state) },
  { method: "GET", match: "/api/config", handler: ({ state }) => handleConfig(state) },
  {
    method: "GET",
    match: "/api/scatter-positions",
    handler: ({ url, req, state }) => handleScatterPositions(url, state, req.signal),
  },
  { method: "GET", match: "/api/scatter-categories", handler: ({ url, store }) => handleScatterCategories(url, store) },
  {
    method: "GET",
    match: "/api/scatter-continuous-values",
    handler: ({ url, store }) => handleScatterContinuousValues(url, store),
  },
  {
    method: "POST",
    match: "/api/scatter-selection",
    handler: ({ req, store }) => handleScatterSelectionPost(req, store),
  },
  {
    method: "DELETE",
    match: "/api/scatter-selection",
    handler: ({ store }) => handleScatterSelectionDelete(store),
  },
  {
    method: "GET",
    match: "/api/trajectory",
    handler: ({ url, req, state }) => handleTrajectory(url, state, req.signal),
  },
  // Obs batch + detail must be ordered before /api/obs/{row_index}.
  { method: "GET", match: "/api/obs/batch", handler: ({ url, state }) => handleObsBatch(url, state) },
  {
    method: "GET",
    match: /^\/api\/obs\/(\d+)\/detail$/,
    handler: ({ state }, [id]) => handleObsDetail(Number(id), state),
  },
  {
    method: "GET",
    match: /^\/api\/obs\/(\d+)$/,
    handler: ({ state }, [id]) => handleObsInfo(Number(id), state),
  },
  {
    method: "GET",
    match: /^\/api\/embeddings\/(.+)\/status$/,
    handler: ({ state }, [name]) => handleEmbeddingStatus(decodeURIComponent(name), state),
  },
  {
    method: "POST",
    match: /^\/api\/embeddings\/(.+)$/,
    handler: ({ state }, [name]) => handleLoadEmbedding(decodeURIComponent(name), state),
  },
  { method: "GET", match: "/api/obssets", handler: ({ store }) => handleListObsSets(store) },
  { method: "POST", match: "/api/obssets", handler: ({ req, store }) => handleCreateObsSet(req, store) },
  {
    method: "POST",
    match: /^\/api\/obssets\/(.+)\/activate$/,
    handler: ({ store }, [name]) => handleActivateObsSet(decodeURIComponent(name), store),
  },
  {
    method: "DELETE",
    match: /^\/api\/obssets\/(.+)$/,
    handler: ({ store }, [name]) => handleDeleteObsSet(decodeURIComponent(name), store),
  },
  { method: "GET", match: "/api/var/names", handler: ({ url, state }) => handleVarNames(url, state) },
  { method: "GET", match: "/api/var/layers", handler: ({ state }) => handleVarLayers(state) },
  { method: "POST", match: "/api/var-column", handler: ({ req, state }) => handleVarColumn(req, state) },
  {
    method: "GET",
    match: /^\/api\/var-column\/(.+)\/status$/,
    handler: (_, [name]) => handleVarColumnStatus(decodeURIComponent(name)),
  },
  { method: "POST", match: "/api/categorize", handler: ({ req, state }) => handleCategorize(req, state) },
  { method: "POST", match: "/api/export", handler: ({ req, store }) => handleExport(req, store) },
  {
    method: "GET",
    match: /^\/api\/export\/(.+)\/status$/,
    handler: (_, [name]) => handleExportStatus(decodeURIComponent(name)),
  },
  {
    method: "GET",
    match: /^\/api\/crop\/(.+?)\/?$/,
    handler: ({ req, state }, [param]) => handleCrop(param, req, state),
  },
];

function routeApi(
  req: Request,
  url: URL,
  pathname: string,
  store: EmbeddingStore,
  state: ViewerState,
): Promise<Response> | Response {
  const ctx: ApiCtx = { req, url, store, state };
  for (const route of API_ROUTES) {
    if (route.method !== req.method) continue;
    if (typeof route.match === "string") {
      if (pathname === route.match) return route.handler(ctx, []);
    } else {
      const m = pathname.match(route.match);
      if (m) return route.handler(ctx, m.slice(1));
    }
  }
  return Response.json({ error: `Unknown API endpoint: ${req.method} ${pathname}` }, { status: 404 });
}
