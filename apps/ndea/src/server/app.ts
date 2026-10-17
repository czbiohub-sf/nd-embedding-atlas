/**
 * Bun.serve HTTP + WebSocket server factory: one declarative `routes` table.
 *
 * - `/api/*` REST routes and the /data/query Mosaic endpoint, with CORS
 * - `/ws`: framed `workspace/watch` sync; `/ws/render`: remote-render sessions;
 *   `/mcp`: MCP over Streamable HTTP
 * - `/plate/*`: OME-Zarr HCS store files
 * - `/*`: the frontend as an HTML import. Bun's dev server bundles it with HMR
 *   when `dev` is set; `bun build --compile` embeds the production bundle.
 */

import type { BunRequest, Server } from "bun";
import type { DatasetQuerySession } from "./store.ts";
import type { ServerSession, DatasetSessionMetadata } from "./state.ts";
import index from "../../index.html";
import { handleMosaicRoute } from "./routes/mosaic.ts";
import { handleMetadata } from "./routes/meta.ts";
import {
  handleCreateAnnotationColumn,
  handleCommitAnnotations,
  handleDeleteAnnotationColumn,
  handleExportAnnotations,
  handleListAnnotationColumns,
  handleSaveAnnotations,
  handleWriteAnnotationValues,
} from "./routes/annotate.ts";
import { handleCategorize } from "./routes/categorize.ts";
import { handleChannelStats } from "./routes/channel-stats.ts";
import { handleCrop } from "./routes/crops.ts";
import { handleEmbeddingStatus, handleLoadEmbedding } from "./routes/embeddings.ts";
import { handleExport, handleExportStatus, handleGetExportDir } from "./routes/export.ts";
import { handleFilter } from "./routes/filter.ts";
import { handleSetsPost } from "./routes/sets.ts";
import {
  handleWorkspaceGet,
  handleWorkspaceHistory,
  handleWorkspacePatch,
  handleWorkspaceRestore,
  handleWorkspaceResult,
  handleWorkspaceRevision,
} from "./routes/workspace.ts";
import { handleHealth, handleObsBatch, handleObsDetail, handleObsInfo } from "./routes/obs.ts";
import { handleScatterCategories, handleScatterContinuousValues, handleScatterPositions } from "./routes/scatter.ts";
import { handleTrajectory } from "./routes/trajectory.ts";
import { handleVarColumn, handleVarColumnStatus, handleVarLayers, handleVarNames } from "./routes/var.ts";
import { CropPool } from "./crop-pool.ts";
import { servePlateFile } from "./plate.ts";
import { handleWsMessage, handleWsOpen, handleWsClose, type ServerSocketContext } from "./ws.ts";
import {
  handleRenderClose,
  handleRenderMessage,
  handleRenderOpen,
  isRenderSocket,
  renderSocketData,
} from "./remote-render.ts";
import { createMcpEndpoint } from "./mcp.ts";
import { hasBearer } from "./mcp-token.ts";
import { getRuntimeStatus } from "./status.ts";
import { handleStructure } from "./structure.ts";

// ─── CORS + method handling ─────────────────────────────────────────────────

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function withCors(response: Response): Response {
  for (const [key, value] of Object.entries(CORS_HEADERS)) response.headers.set(key, value);
  return response;
}

const preflight = () => new Response(null, { status: 204, headers: CORS_HEADERS });
const unknownApi = (req: Request) =>
  Response.json({ error: `Unknown API endpoint: ${req.method} ${new URL(req.url).pathname}` }, { status: 404 });

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
type Method = (typeof METHODS)[number];
type ApiHandler<P extends string> = (req: BunRequest<P>) => Response | Promise<Response>;

/** CORS on every response, a 204 preflight, and a 405 (with `Allow`) for any method a route doesn't list. */
function api<T extends { [P in keyof T & string]: Partial<Record<Method, ApiHandler<P>>> }>(table: T) {
  const routes: Record<string, Partial<Record<Method | "OPTIONS", ApiHandler<string>>>> = {};
  for (const [path, handlers] of Object.entries(table as Record<string, Partial<Record<Method, ApiHandler<string>>>>)) {
    const allow = Object.keys(handlers).join(", ");
    const route: (typeof routes)[string] = { OPTIONS: preflight };
    for (const method of METHODS) {
      const handler = handlers[method];
      route[method] = async (req) =>
        withCors(
          handler
            ? await handler(req)
            : Response.json(
                { error: `Method not allowed: ${method} ${new URL(req.url).pathname}` },
                { status: 405, headers: { Allow: allow } },
              ),
        );
    }
    routes[path] = route;
  }
  return routes;
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
  /** Disable the frontend route (API-only mode). */
  noStatic?: boolean;
  /** Serve the frontend source through Bun's dev server (bundling + HMR + browser console echo). */
  dev?: boolean;
  /** Bearer token that /mcp requires; without one the MCP endpoint is off. */
  mcpToken?: string;
}

// ─── Server factory ─────────────────────────────────────────────────────────

export function createApp(options: CreateAppOptions) {
  const { store, state, config } = options;
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
    development: options.dev ? { hmr: true, console: true } : false,

    routes: {
      ...(options.noStatic ? {} : { "/*": index }),

      // MCP has its own Host/Origin/token guard and no CORS.
      "/mcp": (req: Request) => (mcp ? mcp(req) : new Response("Not Found", { status: 404 })),
      "/ws": (req: Request, server: Server<ServerSocketContext>) =>
        server.upgrade(req, { data: { state } })
          ? undefined
          : withCors(new Response("WebSocket upgrade failed", { status: 400 })),
      "/ws/render": (req: Request, server: Server<ServerSocketContext>) => {
        const render = renderSocketData(req, server);
        if (!render) return new Response("Unknown render session", { status: 403 });
        return server.upgrade(req, { data: { state, render } })
          ? undefined
          : new Response("WebSocket upgrade failed", { status: 400 });
      },
      "/plate/*": async (req: Request) =>
        withCors(
          (await servePlateFile(new URL(req.url).pathname, state.plateMounts)) ??
            new Response("Not Found", { status: 404 }),
        ),
      "/api/*": (req: Request) => (req.method === "OPTIONS" ? preflight() : withCors(unknownApi(req))),

      ...api({
        // Exposes filesystem paths, so it takes the MCP bearer token.
        "/api/status": {
          GET: (req) =>
            options.mcpToken && hasBearer(req, options.mcpToken)
              ? Response.json(
                  getRuntimeStatus(
                    state,
                    `http://${options.host.replace(/^127\.0\.0\.1$/, "localhost")}:${options.port}`,
                  ),
                )
              : Response.json({ error: "Unauthorized" }, { status: 401, headers: { "WWW-Authenticate": "Bearer" } }),
        },
        "/api/status/datasets/:name/structure": {
          GET: (req) => handleStructure(req, state, req.params.name, options.mcpToken),
        },
        "/data/query": { GET: (req) => handleMosaicRoute(req, store), POST: (req) => handleMosaicRoute(req, store) },
        "/data/metadata.json": { GET: () => handleMetadata(state, config) },

        "/api/health": { GET: () => handleHealth(state) },

        "/api/scatter-positions": { GET: (req) => handleScatterPositions(new URL(req.url), state, req.signal) },
        "/api/scatter-categories": { GET: (req) => handleScatterCategories(new URL(req.url), store) },
        "/api/scatter-continuous-values": { GET: (req) => handleScatterContinuousValues(new URL(req.url), store) },
        "/api/trajectory": { GET: (req) => handleTrajectory(new URL(req.url), state, req.signal) },
        "/api/sets": { POST: (req) => handleSetsPost(req, state) },

        "/api/obs/batch": { POST: (req) => handleObsBatch(req, state) },
        "/api/obs/:id": {
          GET: (req) => (/^\d+$/.test(req.params.id) ? handleObsInfo(Number(req.params.id), state) : unknownApi(req)),
        },
        "/api/obs/:id/detail": {
          GET: (req) => (/^\d+$/.test(req.params.id) ? handleObsDetail(Number(req.params.id), state) : unknownApi(req)),
        },

        "/api/embeddings/:key": { POST: (req) => handleLoadEmbedding(req.params.key, state) },
        "/api/embeddings/:key/status": { GET: (req) => handleEmbeddingStatus(req.params.key, state) },

        "/api/var/names": { GET: (req) => handleVarNames(new URL(req.url), state) },
        "/api/var/layers": { GET: () => handleVarLayers(state) },
        "/api/var-column": { POST: (req) => handleVarColumn(req, state) },
        "/api/var-column/:id/status": { GET: (req) => handleVarColumnStatus(req.params.id) },
        "/api/categorize": { POST: (req) => handleCategorize(req, store) },
        "/api/filter": { POST: (req) => handleFilter(req, state) },

        "/api/workspace": { GET: () => handleWorkspaceGet(state), PATCH: (req) => handleWorkspacePatch(req, state) },
        "/api/workspace/history": { GET: (req) => handleWorkspaceHistory(req, state) },
        "/api/workspace/revisions/:revision": { GET: (req) => handleWorkspaceRevision(req.params.revision, state) },
        "/api/workspace/restore": { POST: (req) => handleWorkspaceRestore(req, state) },
        "/api/workspace/elements/:id": { GET: (req) => handleWorkspaceResult({ element: req.params.id }, state) },
        "/api/workspace/data/:name": { GET: (req) => handleWorkspaceResult({ data: req.params.name }, state) },

        "/api/annotations/columns": {
          GET: () => handleListAnnotationColumns(state),
          POST: (req) => handleCreateAnnotationColumn(req, state),
        },
        "/api/annotations/columns/:name": { DELETE: (req) => handleDeleteAnnotationColumn(req.params.name, state) },
        "/api/annotations/values": { POST: (req) => handleWriteAnnotationValues(req, state) },
        "/api/annotations/save": { POST: () => handleSaveAnnotations(state) },
        "/api/annotations/export": { POST: (req) => handleExportAnnotations(req, state) },
        "/api/annotations/commit": {
          POST: (req) => handleCommitAnnotations(req, state, new URL(req.url).searchParams.get("dryRun") === "1"),
        },

        "/api/export-dir": { GET: () => handleGetExportDir() },
        "/api/export": { POST: (req) => handleExport(req, store) },
        "/api/export/:id/status": { GET: (req) => handleExportStatus(req.params.id) },

        // FOV paths carry raw slashes (`A/1/0`), so these take the whole wildcard tail.
        "/api/crop/*": { POST: (req) => handleCrop(new URL(req.url).pathname.slice("/api/crop/".length), req, state) },
        "/api/channel-stats/*": {
          GET: (req) => handleChannelStats(new URL(req.url).pathname.slice("/api/channel-stats/".length), req, state),
        },
      }),
    },

    error(err) {
      console.error(`[ndea] Unhandled error: ${err.message}`);
      return withCors(Response.json({ error: err.message }, { status: 500 }));
    },

    websocket: {
      message: (ws, message) => (isRenderSocket(ws) ? handleRenderMessage(ws, message) : handleWsMessage(ws, message)),
      open: (ws) => (isRenderSocket(ws) ? handleRenderOpen(ws) : handleWsOpen(ws)),
      close: (ws) => (isRenderSocket(ws) ? handleRenderClose(ws) : handleWsClose(ws)),
    },
  });
}
