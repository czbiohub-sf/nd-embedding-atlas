import type { PluginRuntimeSnapshot } from "./plugins/assets.ts";
import { pluginBootstrapResponse } from "./plugins/bootstrap.ts";
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
import { handleConfig } from "./routes/config.ts";
import { handleCrop } from "./routes/crops.ts";
import { handleEmbeddingStatus, handleLoadEmbedding } from "./routes/embeddings.ts";
import { handleExport, handleExportStatus, handleGetExportDir } from "./routes/export.ts";
import { handleHealth, handleObsBatch, handleObsDetail, handleObsInfo } from "./routes/obs.ts";
import {
  handleScatterCategories,
  handleScatterContinuousValues,
  handleScatterPositions,
  handleScatterSelectionDelete,
  handleScatterSelectionPost,
  handleSelectionDelete,
  handleSelectionPost,
} from "./routes/scatter.ts";
import { handleTrajectory } from "./routes/trajectory.ts";
import { handleVarColumn, handleVarColumnStatus, handleVarLayers, handleVarNames } from "./routes/var.ts";
import type { ServerSession } from "./state.ts";
import type { DatasetQuerySession } from "./store.ts";

interface ApiRouteContext {
  req: Request;
  url: URL;
  pathname: string;
  method: string;
  store: DatasetQuerySession;
  state: ServerSession;
  pluginSnapshot: PluginRuntimeSnapshot;
}

type ApiRouteResult = Response | Promise<Response> | null;
type ApiRouteDispatcher = (context: ApiRouteContext) => ApiRouteResult;

/** Extract a path parameter from a URL pattern like /api/crop/{id}. */
function extractPathParam(pathname: string, prefix: string): string | null {
  if (!pathname.startsWith(prefix)) return null;
  const rest = pathname.slice(prefix.length);
  return rest.endsWith("/") ? rest.slice(0, -1) : rest;
}

function routeCore({ pathname, method, state, pluginSnapshot }: ApiRouteContext): ApiRouteResult {
  if (pathname === "/api/health" && method === "GET") return handleHealth(state);
  if (pathname === "/api/config" && method === "GET") return handleConfig(state);
  if (pathname === "/api/plugins/bootstrap" && method === "GET") {
    return pluginBootstrapResponse(pluginSnapshot);
  }
  return null;
}

function routeScatterValues({ req, url, pathname, method, store, state }: ApiRouteContext): ApiRouteResult {
  if (pathname === "/api/scatter-positions" && method === "GET") {
    return handleScatterPositions(url, state, req.signal);
  }
  if (pathname === "/api/scatter-categories" && method === "GET") {
    return handleScatterCategories(url, store);
  }
  if (pathname === "/api/scatter-continuous-values" && method === "GET") {
    return handleScatterContinuousValues(url, store);
  }
  return null;
}

function routeScatterSelection({ req, pathname, method, store }: ApiRouteContext): ApiRouteResult {
  if (pathname === "/api/scatter-selection" && method === "POST") {
    return handleScatterSelectionPost(req, store);
  }
  if (pathname === "/api/scatter-selection" && method === "DELETE") {
    return handleScatterSelectionDelete(store);
  }
  return null;
}

function routeSelection({ req, pathname, method, store }: ApiRouteContext): ApiRouteResult {
  if (!pathname.startsWith("/api/selection/")) return null;
  const instanceId = decodeURIComponent(pathname.slice("/api/selection/".length));
  if (!instanceId) return new Response("Not Found", { status: 404 });
  if (method === "POST") return handleSelectionPost(req, store, instanceId);
  if (method === "DELETE") return handleSelectionDelete(store, instanceId);
  return null;
}

function routeTrajectory({ req, url, pathname, method, state }: ApiRouteContext): ApiRouteResult {
  if (pathname !== "/api/trajectory" || method !== "GET") return null;
  return handleTrajectory(url, state, req.signal);
}

function routeObs({ req, pathname, method, state }: ApiRouteContext): ApiRouteResult {
  if (pathname === "/api/obs/batch" && method === "POST") return handleObsBatch(req, state);

  const detailMatch = pathname.match(/^\/api\/obs\/(\d+)\/detail$/);
  if (detailMatch && method === "GET") return handleObsDetail(Number(detailMatch[1]), state);

  const obsMatch = pathname.match(/^\/api\/obs\/(\d+)$/);
  if (obsMatch && method === "GET") return handleObsInfo(Number(obsMatch[1]), state);
  return null;
}

function routeEmbeddings({ pathname, method, state }: ApiRouteContext): ApiRouteResult {
  const statusMatch = pathname.match(/^\/api\/embeddings\/(.+)\/status$/);
  if (statusMatch && method === "GET") {
    return handleEmbeddingStatus(decodeURIComponent(statusMatch[1]), state);
  }

  const loadMatch = pathname.match(/^\/api\/embeddings\/(.+)$/);
  if (loadMatch && method === "POST") {
    return handleLoadEmbedding(decodeURIComponent(loadMatch[1]), state);
  }
  return null;
}

function routeVarMetadata({ url, pathname, method, state }: ApiRouteContext): ApiRouteResult {
  if (pathname === "/api/var/names" && method === "GET") return handleVarNames(url, state);
  if (pathname === "/api/var/layers" && method === "GET") return handleVarLayers(state);
  return null;
}

function routeVarColumn({ req, pathname, method, state }: ApiRouteContext): ApiRouteResult {
  if (pathname === "/api/var-column" && method === "POST") return handleVarColumn(req, state);

  const statusMatch = pathname.match(/^\/api\/var-column\/(.+)\/status$/);
  if (statusMatch && method === "GET") {
    return handleVarColumnStatus(decodeURIComponent(statusMatch[1]));
  }
  return null;
}

function routeCategorize({ req, pathname, method, state }: ApiRouteContext): ApiRouteResult {
  if (pathname === "/api/categorize" && method === "POST") return handleCategorize(req, state);
  return null;
}

function routeAnnotationColumns({ req, pathname, method, state }: ApiRouteContext): ApiRouteResult {
  if (pathname === "/api/annotations/columns" && method === "GET") {
    return handleListAnnotationColumns(state);
  }
  if (pathname === "/api/annotations/columns" && method === "POST") {
    return handleCreateAnnotationColumn(req, state);
  }

  const columnMatch = pathname.match(/^\/api\/annotations\/columns\/(.+)$/);
  if (columnMatch && method === "DELETE") {
    return handleDeleteAnnotationColumn(decodeURIComponent(columnMatch[1]), state);
  }
  return null;
}

function routeAnnotationValues({ req, pathname, method, state }: ApiRouteContext): ApiRouteResult {
  if (pathname === "/api/annotations/values" && method === "POST") {
    return handleWriteAnnotationValues(req, state);
  }
  return null;
}

function routeAnnotationPersistence({ req, url, pathname, method, state }: ApiRouteContext): ApiRouteResult {
  if (pathname === "/api/annotations/save" && method === "POST") return handleSaveAnnotations(state);
  if (pathname === "/api/annotations/export" && method === "POST") {
    return handleExportAnnotations(req, state);
  }
  if (pathname === "/api/annotations/commit" && method === "POST") {
    return handleCommitAnnotations(req, state, url.searchParams.get("dryRun") === "1");
  }
  return null;
}

function routeExports({ req, pathname, method, store }: ApiRouteContext): ApiRouteResult {
  if (pathname === "/api/export-dir" && method === "GET") return handleGetExportDir();
  if (pathname === "/api/export" && method === "POST") return handleExport(req, store);

  const statusMatch = pathname.match(/^\/api\/export\/(.+)\/status$/);
  if (statusMatch && method === "GET") {
    return handleExportStatus(decodeURIComponent(statusMatch[1]));
  }
  return null;
}

function routeImages({ req, pathname, state }: ApiRouteContext): ApiRouteResult {
  const cropParam = extractPathParam(pathname, "/api/crop/");
  if (cropParam != null) return handleCrop(cropParam, req, state);

  const statsParam = extractPathParam(pathname, "/api/channel-stats/");
  if (statsParam != null) return handleChannelStats(statsParam, req, state);
  return null;
}

const API_ROUTE_DISPATCHERS: readonly ApiRouteDispatcher[] = [
  routeCore,
  routeScatterValues,
  routeScatterSelection,
  routeSelection,
  routeTrajectory,
  routeObs,
  routeEmbeddings,
  routeVarMetadata,
  routeVarColumn,
  routeCategorize,
  routeAnnotationColumns,
  routeAnnotationValues,
  routeAnnotationPersistence,
  routeExports,
  routeImages,
];

export function routeApi(
  req: Request,
  url: URL,
  pathname: string,
  store: DatasetQuerySession,
  state: ServerSession,
  pluginSnapshot: PluginRuntimeSnapshot,
): Response | Promise<Response> {
  const context: ApiRouteContext = { req, url, pathname, method: req.method, store, state, pluginSnapshot };
  for (const dispatch of API_ROUTE_DISPATCHERS) {
    const response = dispatch(context);
    if (response) return response;
  }
  return Response.json({ error: `Unknown API endpoint: ${req.method} ${pathname}` }, { status: 404 });
}
