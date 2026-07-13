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
import { handleConfig } from "./routes/config.ts";
import { handleLoadEmbedding, handleEmbeddingStatus } from "./routes/embeddings.ts";
import {
  handleScatterPositions,
  handleScatterCategories,
  handleScatterContinuousValues,
  handleScatterSelectionPost,
  handleScatterSelectionDelete,
  handleSelectionPost,
  handleSelectionDelete,
} from "./routes/scatter.ts";
import { handleTrajectory } from "./routes/trajectory.ts";
import { handleObsBatch, handleObsInfo, handleObsDetail, handleHealth } from "./routes/obs.ts";
import {
  handleListCollections,
  handleCreateCollection,
  handlePatchCollection,
  handleDeleteCollection,
  handleAddMembers,
  handleExportCollection,
  handleSetActiveSelection,
  handleGetActiveSelectionRowIndices,
  handleClearActiveSelection,
} from "./routes/collections.ts";
import { handleVarNames, handleVarLayers, handleVarColumn, handleVarColumnStatus } from "./routes/var.ts";
import { handleCategorize } from "./routes/categorize.ts";
import {
  handleListAnnotationColumns,
  handleCreateAnnotationColumn,
  handleDeleteAnnotationColumn,
  handleWriteAnnotationValues,
  handleSaveAnnotations,
  handleExportAnnotations,
  handleCommitAnnotations,
} from "./routes/annotate.ts";
import { handleExport, handleExportStatus, handleGetExportDir } from "./routes/export.ts";
import { handleCrop } from "./routes/crops.ts";
import { handleChannelStats } from "./routes/channel-stats.ts";
import { CropPool } from "./crop-pool.ts";
import { servePlateFile } from "./plate.ts";
import { serveStatic, resolveFrontendDir } from "./static.ts";
import { handleWsMessage, handleWsOpen, handleWsClose, type ServerSocketContext } from "./ws.ts";
import { handleMosaicWsMessage } from "./mosaic-ws.ts";

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

// ─── URL path routing helpers ───────────────────────────────────────────────

/** Extract a path parameter from a URL pattern like /api/obs/{id}. */
function extractPathParam(pathname: string, prefix: string): string | null {
  if (!pathname.startsWith(prefix)) return null;
  const rest = pathname.slice(prefix.length);
  // Strip trailing slash
  return rest.endsWith("/") ? rest.slice(0, -1) : rest;
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

  // Spin up the Bun Worker pool for crop rendering when a plate is
  // available. Pool persists for the lifetime of the server; workers keep
  // their zarr Array LRU + WebP WASM init warm across requests.
  if (state.plateMounts.length > 0 && !state.cropPool) {
    state.cropPool = new CropPool(state.plateMounts);
  }

  // Boot banner — lets the dev terminal show *exactly* which routes the
  // running process has registered. If a `bun --hot` reload missed the new
  // file, the missing route name in this list makes that obvious.
  console.log(
    `[ndea] createApp registered: /api/collections, /api/active-selection ` +
      `(POST|GET row-indices|DELETE), /api/scatter-selection, ...other`,
  );

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

function routeApi(
  req: Request,
  url: URL,
  pathname: string,
  store: DatasetQuerySession,
  state: ServerSession,
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
    return handleScatterPositions(url, state, req.signal);
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

  // ── Per-instance scatter selection (§6.5 — sel_<instanceId>) ─────
  if (pathname.startsWith("/api/selection/")) {
    const instanceId = decodeURIComponent(pathname.slice("/api/selection/".length));
    if (!instanceId) return new Response("Not Found", { status: 404 });
    if (method === "POST") return handleSelectionPost(req, store, instanceId);
    if (method === "DELETE") return handleSelectionDelete(store, instanceId);
  }

  // ── Trajectory (server-side join of metadata + obsm positions) ──
  if (pathname === "/api/trajectory" && method === "GET") {
    return handleTrajectory(url, state, req.signal);
  }

  // ── Obs batch (must match before /api/obs/{row_index}) ──────────
  if (pathname === "/api/obs/batch" && method === "POST") {
    return handleObsBatch(req, state);
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

  // ── Collections ─────────────────────────────────────────────────
  if (pathname === "/api/collections") {
    if (method === "GET") return handleListCollections(store);
    if (method === "POST") return handleCreateCollection(req, store);
  }

  // Sub-resources need to match before the bare /api/collections/:id route.
  const collectionMembersMatch = pathname.match(/^\/api\/collections\/([^/]+)\/members$/);
  if (collectionMembersMatch && method === "POST") {
    return handleAddMembers(decodeURIComponent(collectionMembersMatch[1]), req, store);
  }

  const collectionExportMatch = pathname.match(/^\/api\/collections\/([^/]+)\/export$/);
  if (collectionExportMatch && method === "POST") {
    return handleExportCollection(decodeURIComponent(collectionExportMatch[1]), req, store);
  }

  const collectionByIdMatch = pathname.match(/^\/api\/collections\/([^/]+)$/);
  if (collectionByIdMatch) {
    const id = decodeURIComponent(collectionByIdMatch[1]);
    if (method === "PATCH") return handlePatchCollection(id, req, store);
    if (method === "DELETE") return handleDeleteCollection(id, store);
  }

  // ── Active selection (token-scoped, generic for PR3 set algebra) ─
  if (pathname === "/api/active-selection/row-indices" && method === "GET") {
    return handleGetActiveSelectionRowIndices(store);
  }
  if (pathname === "/api/active-selection") {
    if (method === "POST") return handleSetActiveSelection(req, store);
    if (method === "DELETE") return handleClearActiveSelection(store);
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

  // ── Categorical index materialization ────────────────────────────
  if (pathname === "/api/categorize" && method === "POST") {
    return handleCategorize(req, state);
  }

  // ── Annotations ──────────────────────────────────────────────────
  if (pathname === "/api/annotations/columns") {
    if (method === "GET") return handleListAnnotationColumns(state);
    if (method === "POST") return handleCreateAnnotationColumn(req, state);
  }

  const annotationColMatch = pathname.match(/^\/api\/annotations\/columns\/(.+)$/);
  if (annotationColMatch && method === "DELETE") {
    return handleDeleteAnnotationColumn(decodeURIComponent(annotationColMatch[1]), state);
  }

  if (pathname === "/api/annotations/values" && method === "POST") {
    return handleWriteAnnotationValues(req, state);
  }

  if (pathname === "/api/annotations/save" && method === "POST") {
    return handleSaveAnnotations(state);
  }

  if (pathname === "/api/annotations/export" && method === "POST") {
    return handleExportAnnotations(req, state);
  }

  if (pathname === "/api/annotations/commit" && method === "POST") {
    return handleCommitAnnotations(req, state, url.searchParams.get("dryRun") === "1");
  }

  // ── Export ───────────────────────────────────────────────────────
  if (pathname === "/api/export-dir" && method === "GET") {
    return handleGetExportDir();
  }

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

  // ── Per-channel pixel stats (autocontrast) ──────────────────────
  const statsParam = extractPathParam(pathname, "/api/channel-stats/");
  if (statsParam != null) {
    return handleChannelStats(statsParam, req, state);
  }

  // ── 404 ─────────────────────────────────────────────────────────
  return Response.json({ error: `Unknown API endpoint: ${method} ${pathname}` }, { status: 404 });
}
