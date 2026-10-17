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
 * Methods: `workspace/watch` pushes every accepted workspace revision until
 * the client sends `{ _id: <new>, _type: "unsubscribe", target_id: <sub_id> }`.
 * Data loads and Mosaic queries use the HTTP routes.
 */

import type { ServerWebSocket } from "bun";
import type { ServerSession } from "./state.ts";

/** Data attached to every ServerWebSocket via server.upgrade(req, { data }). */
export interface ServerSocketContext {
  state: ServerSession;
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
  "workspace/watch": handleWorkspaceWatchWs,
};

// ─── workspace/watch ────────────────────────────────────────────────────────

/** Push every accepted workspace revision with its ops until unsubscribed. */
function handleWorkspaceWatchWs(ws: WS, id: number): void {
  const dispose = ws.data.state.workspace.watch((change) => sendData(ws, id, { ...change }));
  socketSubs.get(ws)?.set(id, dispose);
}
