/**
 * WebSocket dispatch layer for the ndea server.
 *
 * Text frame shape (JSON):
 *   { _id: number, _type: string, _ch?: "data"|"end"|"error", ...payload }
 *
 * - `_id` is client-monotonic; server echoes it on every reply and push frame
 *   tied to the same request.
 * - One-shot reply: omit `_ch` on the response (implicit "end").
 * - Streaming/push: emit `{_ch: "data", ...}` frames, then `{_ch: "end"}`.
 * - Errors: `{_ch: "error", error: string}` (also implicit terminal).
 *
 * To long-poll a status endpoint, the client sends `{ subscribe: true }` in
 * the request payload. The server then pushes every transition until the
 * task completes or the client sends an unsubscribe frame:
 *   { _id: <new>, _type: "unsubscribe", target_id: <sub_id> }
 *
 * All 6 migrated methods have 1:1 HTTP fallbacks — this layer is strictly
 * additive.
 */

import type { ServerWebSocket } from "bun";
import type { ServerSession } from "./state.ts";
import type { DatasetQuerySession } from "./store.ts";
import {
  handleLoadEmbedding,
  currentEmbeddingStatus,
  subscribeEmbeddingStatus,
  type EmbeddingStatusEvent,
} from "./routes/embeddings.ts";
import { handleVarColumn, getVarTask, subscribeVarTask, type VarTask } from "./routes/var.ts";
import { handleExport, getExportTask, subscribeExportTask, type ExportTask } from "./routes/export.ts";
import { VarColumnBodySchema } from "./protocol.ts";

/** Data attached to every ServerWebSocket via server.upgrade(req, { data }). */
export interface ServerSocketContext {
  /**
   * Socket role. `ndea` uses the framed `{_id,_type,...}` protocol handled
   * in this file. `mosaic` uses the Mosaic socketConnector framing (raw
   * `{type, sql}` in, Arrow IPC / JSON out) handled in mosaic-ws.ts.
   */
  kind: "ndea" | "mosaic";
  state: ServerSession;
  store: DatasetQuerySession;
}

type WS = ServerWebSocket<ServerSocketContext>;

interface Frame {
  _id?: unknown;
  _type?: unknown;
  [k: string]: unknown;
}

type Disposer = () => void;

/** Per-socket map: subscription _id → disposer. Cleared on close. */
const socketSubs = new WeakMap<WS, Map<number, Disposer>>();

// ─── Lifecycle ──────────────────────────────────────────────────────────────

export function handleWsOpen(ws: WS): void {
  socketSubs.set(ws, new Map());
}

export function handleWsClose(ws: WS): void {
  const subs = socketSubs.get(ws);
  if (!subs) return;
  for (const dispose of subs.values()) dispose();
  subs.clear();
  socketSubs.delete(ws);
}

// ─── Frame helpers ──────────────────────────────────────────────────────────

function sendJson(ws: WS, payload: Record<string, unknown>): void {
  ws.send(JSON.stringify(payload));
}

function sendData(ws: WS, id: number, data: Record<string, unknown>): void {
  sendJson(ws, { _id: id, _ch: "data", ...data });
}

function sendEnd(ws: WS, id: number, data: Record<string, unknown> = {}): void {
  sendJson(ws, { _id: id, _ch: "end", ...data });
}

function sendError(ws: WS, id: number, error: string): void {
  sendJson(ws, { _id: id, _ch: "error", error });
}

function disposeSub(ws: WS, id: number): void {
  const subs = socketSubs.get(ws);
  const dispose = subs?.get(id);
  if (dispose) {
    dispose();
    subs!.delete(id);
  }
}

// ─── Entry point ────────────────────────────────────────────────────────────

export function handleWsMessage(ws: WS, raw: string | Buffer): void {
  if (typeof raw !== "string") {
    // Binary frames reserved for future Arrow IPC responses.
    return;
  }
  let frame: Frame;
  try {
    frame = JSON.parse(raw) as Frame;
  } catch {
    sendError(ws, -1, "Invalid JSON frame");
    return;
  }
  const id = typeof frame._id === "number" ? frame._id : -1;
  const type = typeof frame._type === "string" ? frame._type : "";
  if (id < 0 || type === "") {
    sendError(ws, id, "Missing _id or _type");
    return;
  }

  if (type === "unsubscribe") {
    const target = typeof frame["target_id"] === "number" ? frame["target_id"] : id;
    disposeSub(ws, target);
    sendEnd(ws, id);
    return;
  }

  const handler = HANDLERS[type];
  if (!handler) {
    sendError(ws, id, `Unknown method: ${type}`);
    return;
  }

  void Promise.resolve()
    .then(() => handler(ws, id, frame))
    .catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      sendError(ws, id, msg);
    });
}

// ─── Handler table ──────────────────────────────────────────────────────────

type Handler = (ws: WS, id: number, frame: Frame) => void | Promise<void>;

const HANDLERS: Record<string, Handler> = {
  "embeddings/load": handleEmbeddingsLoadWs,
  "embeddings/status": handleEmbeddingsStatusWs,
  "var-column/load": handleVarColumnLoadWs,
  "var-column/status": handleVarColumnStatusWs,
  "export/start": handleExportStartWs,
  "export/status": handleExportStatusWs,
};

// ─── Helpers: synthetic Request for reusing HTTP handlers ───────────────────

function synthPostRequest(payload: unknown): Request {
  return new Request("http://internal/", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

async function respondFromHttp(ws: WS, id: number, resp: Response): Promise<void> {
  const body = await resp.json().catch(() => ({ error: "Invalid JSON response" }));
  if (!resp.ok) {
    const msg =
      typeof (body as { error?: unknown }).error === "string"
        ? (body as { error: string }).error
        : `HTTP ${resp.status}`;
    sendError(ws, id, msg);
    return;
  }
  sendEnd(ws, id, body as Record<string, unknown>);
}

// ─── embeddings/load ────────────────────────────────────────────────────────

async function handleEmbeddingsLoadWs(ws: WS, id: number, frame: Frame): Promise<void> {
  const key = typeof frame["key"] === "string" ? frame["key"] : "";
  if (key === "") {
    sendError(ws, id, "Missing required field: key");
    return;
  }
  const resp = handleLoadEmbedding(key, ws.data.state);
  await respondFromHttp(ws, id, resp);
}

// ─── embeddings/status ──────────────────────────────────────────────────────

function handleEmbeddingsStatusWs(ws: WS, id: number, frame: Frame): void {
  const key = typeof frame["key"] === "string" ? frame["key"] : "";
  const subscribe = frame["subscribe"] === true;
  if (key === "") {
    sendError(ws, id, "Missing required field: key");
    return;
  }
  const state = ws.data.state;

  if (!subscribe) {
    const ev = currentEmbeddingStatus(key, state);
    sendEnd(ws, id, embeddingPayload(ev));
    return;
  }

  const dispose = subscribeEmbeddingStatus(key, state, (ev) => {
    if (ev.status === "ready" || ev.status === "error") {
      sendEnd(ws, id, embeddingPayload(ev));
      disposeSub(ws, id);
    } else {
      sendData(ws, id, embeddingPayload(ev));
    }
  });
  socketSubs.get(ws)?.set(id, dispose);
}

function embeddingPayload(ev: EmbeddingStatusEvent): Record<string, unknown> {
  const out: Record<string, unknown> = { status: ev.status };
  if (ev.error !== undefined) out["error"] = ev.error;
  if (ev.nDims !== undefined) out["n_dims"] = ev.nDims;
  return out;
}

// ─── var-column/load ────────────────────────────────────────────────────────

async function handleVarColumnLoadWs(ws: WS, id: number, frame: Frame): Promise<void> {
  const name = typeof frame["name"] === "string" ? frame["name"] : "";
  const layer = typeof frame["layer"] === "string" ? frame["layer"] : undefined;
  const modality = typeof frame["modality"] === "string" ? frame["modality"] : undefined;
  if (name === "") {
    sendError(ws, id, "Missing required field: name");
    return;
  }
  const parsed = VarColumnBodySchema.safeParse({ name, layer, modality });
  if (!parsed.success) {
    sendError(ws, id, "Invalid var-column request");
    return;
  }
  const req = synthPostRequest(parsed.data);
  const resp = await handleVarColumn(req, ws.data.state);
  await respondFromHttp(ws, id, resp);
}

// ─── var-column/status ──────────────────────────────────────────────────────

function handleVarColumnStatusWs(ws: WS, id: number, frame: Frame): void {
  const taskId = typeof frame["task_id"] === "string" ? frame["task_id"] : "";
  const subscribe = frame["subscribe"] === true;
  if (taskId === "") {
    sendError(ws, id, "Missing required field: task_id");
    return;
  }
  const task = getVarTask(taskId);
  if (!task) {
    sendError(ws, id, "Unknown task_id");
    return;
  }

  if (!subscribe) {
    sendEnd(ws, id, varPayload(task));
    return;
  }

  const dispose = subscribeVarTask(taskId, (t) => {
    if (t.status === "ready" || t.status === "error") {
      sendEnd(ws, id, varPayload(t));
      disposeSub(ws, id);
    } else {
      sendData(ws, id, varPayload(t));
    }
  });
  socketSubs.get(ws)?.set(id, dispose);
}

function varPayload(task: VarTask): Record<string, unknown> {
  const out: Record<string, unknown> = { status: task.status, column: task.column };
  if (task.error !== undefined) out["error"] = task.error;
  return out;
}

// ─── export/start ───────────────────────────────────────────────────────────

async function handleExportStartWs(ws: WS, id: number, frame: Frame): Promise<void> {
  const payload: Record<string, unknown> = {};
  for (const k of ["predicate", "filename", "output_path", "selection_type", "embedding_key"]) {
    if (frame[k] !== undefined) payload[k] = frame[k];
  }
  const req = synthPostRequest(payload);
  const resp = await handleExport(req, ws.data.store);
  await respondFromHttp(ws, id, resp);
}

// ─── export/status ──────────────────────────────────────────────────────────

function handleExportStatusWs(ws: WS, id: number, frame: Frame): void {
  const taskId = typeof frame["task_id"] === "string" ? frame["task_id"] : "";
  const subscribe = frame["subscribe"] === true;
  if (taskId === "") {
    sendError(ws, id, "Missing required field: task_id");
    return;
  }
  const task = getExportTask(taskId);
  if (!task) {
    sendError(ws, id, "Export task not found");
    return;
  }

  if (!subscribe) {
    sendEnd(ws, id, exportPayload(task));
    return;
  }

  const dispose = subscribeExportTask(taskId, (t) => {
    if (t.status === "done" || t.status === "error") {
      sendEnd(ws, id, exportPayload(t));
      disposeSub(ws, id);
    } else {
      sendData(ws, id, exportPayload(t));
    }
  });
  socketSubs.get(ws)?.set(id, dispose);
}

function exportPayload(task: ExportTask): Record<string, unknown> {
  const out: Record<string, unknown> = { status: task.status };
  if (task.outputPath !== undefined) out["output_path"] = task.outputPath;
  if (task.nObs !== undefined) out["n_obs"] = task.nObs;
  if (task.error !== undefined) out["error"] = task.error;
  return out;
}
