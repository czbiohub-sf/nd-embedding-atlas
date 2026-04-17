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
import { handleObsBatch, handleObsInfo, handleObsDetail, handleHealth } from "./routes/obs.ts";
import { handleListObsSets, handleCreateObsSet, handleDeleteObsSet, handleActivateObsSet } from "./routes/obssets.ts";
import { handleVarNames, handleVarLayers, handleVarColumn, handleVarColumnStatus } from "./routes/var.ts";
import { handleExport, handleExportStatus } from "./routes/export.ts";
import { handleCrop } from "./routes/crops.ts";
import { servePlateFile } from "./plate.ts";
import { serveStatic, resolveFrontendDir } from "./static.ts";
import { handleWsMessage, handleWsOpen, handleWsClose, type WsContext } from "./ws.ts";

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

// ─── URL path routing helpers ───────────────────────────────────────────────

/** Extract a path parameter from a URL pattern like /api/obs/{id}. */
function extractPathParam(pathname: string, prefix: string): string | null {
  if (!pathname.startsWith(prefix)) return null;
  const rest = pathname.slice(prefix.length);
  // Strip trailing slash
  return rest.endsWith("/") ? rest.slice(0, -1) : rest;
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
      if (req.headers.get("upgrade") === "websocket") {
        const upgraded = server.upgrade(req, { data: { state, store } });
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
        handleWsMessage(ws, raw);
      },
      open(ws) {
        handleWsOpen(ws);
      },
      close(ws) {
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

  return new Response("Not Found", { status: 404 });
}

// ─── API sub-router ─────────────────────────────────────────────────────────

function routeApi(
  req: Request,
  url: URL,
  pathname: string,
  store: EmbeddingStore,
  state: ViewerState,
): Promise<Response> | Response {
  const method = req.method;

  // ── Health ───────────────────────────────────────────────────────
  if (pathname === "/api/health" && method === "GET") {
    return handleHealth(state);
  }

  // ── Config ──────────────────────────────────────────────────────
  if (pathname === "/api/config" && method === "GET") {
    return handleConfig(state);
  }

  // ── Scatter positions ───────────────────────────────────────────
  if (pathname === "/api/scatter-positions" && method === "GET") {
    return handleScatterPositions(url, store);
  }

  // ── Scatter categories ──────────────────────────────────────────
  if (pathname === "/api/scatter-categories" && method === "GET") {
    return handleScatterCategories(url, store);
  }

  // ── Scatter continuous values (Phase 7: GPU-side colormap) ──────
  if (pathname === "/api/scatter-continuous-values" && method === "GET") {
    return handleScatterContinuousValues(url, store);
  }

  // ── Scatter selection ───────────────────────────────────────────
  if (pathname === "/api/scatter-selection") {
    if (method === "POST") return handleScatterSelectionPost(req, store);
    if (method === "DELETE") return handleScatterSelectionDelete(store);
  }

  // ── Obs batch (must match before /api/obs/{row_index}) ──────────
  if (pathname === "/api/obs/batch" && method === "GET") {
    return handleObsBatch(url, state);
  }

  // ── Obs detail (must match before /api/obs/{row_index}) ─────────
  const detailMatch = pathname.match(/^\/api\/obs\/(\d+)\/detail$/);
  if (detailMatch && method === "GET") {
    return handleObsDetail(Number(detailMatch[1]), state);
  }

  // ── Obs info ────────────────────────────────────────────────────
  const obsMatch = pathname.match(/^\/api\/obs\/(\d+)$/);
  if (obsMatch && method === "GET") {
    return handleObsInfo(Number(obsMatch[1]), state);
  }

  // ── Embeddings ──────────────────────────────────────────────────
  const embStatusMatch = pathname.match(/^\/api\/embeddings\/(.+)\/status$/);
  if (embStatusMatch && method === "GET") {
    return handleEmbeddingStatus(decodeURIComponent(embStatusMatch[1]), state);
  }

  const embLoadMatch = pathname.match(/^\/api\/embeddings\/(.+)$/);
  if (embLoadMatch && method === "POST") {
    return handleLoadEmbedding(decodeURIComponent(embLoadMatch[1]), state);
  }

  // ── ObsSets ─────────────────────────────────────────────────────
  if (pathname === "/api/obssets") {
    if (method === "GET") return handleListObsSets(store);
    if (method === "POST") return handleCreateObsSet(req, store);
  }

  const obssetActivateMatch = pathname.match(/^\/api\/obssets\/(.+)\/activate$/);
  if (obssetActivateMatch && method === "POST") {
    return handleActivateObsSet(decodeURIComponent(obssetActivateMatch[1]), store);
  }

  const obssetDeleteMatch = pathname.match(/^\/api\/obssets\/(.+)$/);
  if (obssetDeleteMatch && method === "DELETE") {
    return handleDeleteObsSet(decodeURIComponent(obssetDeleteMatch[1]), store);
  }

  // ── Var / Var column ────────────────────────────────────────────
  if (pathname === "/api/var/names" && method === "GET") {
    return handleVarNames(url, state);
  }

  if (pathname === "/api/var/layers" && method === "GET") {
    return handleVarLayers(state);
  }

  if (pathname === "/api/var-column" && method === "POST") {
    return handleVarColumn(req, state);
  }

  const varColStatusMatch = pathname.match(/^\/api\/var-column\/(.+)\/status$/);
  if (varColStatusMatch && method === "GET") {
    return handleVarColumnStatus(decodeURIComponent(varColStatusMatch[1]));
  }

  // ── Export ───────────────────────────────────────────────────────
  if (pathname === "/api/export" && method === "POST") {
    return handleExport(req, store);
  }

  const exportStatusMatch = pathname.match(/^\/api\/export\/(.+)\/status$/);
  if (exportStatusMatch && method === "GET") {
    return handleExportStatus(decodeURIComponent(exportStatusMatch[1]));
  }

  // ── Image crop ──────────────────────────────────────────────────
  const cropParam = extractPathParam(pathname, "/api/crop/");
  if (cropParam != null) {
    return handleCrop(cropParam, req, state);
  }

  // ── 404 ─────────────────────────────────────────────────────────
  return Response.json({ error: `Unknown API endpoint: ${method} ${pathname}` }, { status: 404 });
}
