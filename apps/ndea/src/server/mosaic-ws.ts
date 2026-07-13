/**
 * Mosaic socketConnector adapter.
 *
 * Client (@uwdata/mosaic-core `socketConnector`) sends one request at a time
 * as `JSON.stringify({type, sql})`. Server replies with:
 *   - `arrow` → binary Arrow IPC stream
 *   - `exec`  → any text frame (connector resolves undefined)
 *   - `json`  → `JSON.stringify(rows)`
 *   - error   → `JSON.stringify({error: "..."})` text frame
 *
 * The connector has no request id and no multiplexing — strictly serial
 * request/response per socket. That matches Bun.serve WS cleanly.
 */

import type { ServerWebSocket } from "bun";
import { isAllowedSql } from "./mosaic.ts";
import { MosaicQueryBodySchema } from "./protocol.ts";
import type { EmbeddingStore } from "./store.ts";
import type { WsContext } from "./ws.ts";

type WS = ServerWebSocket<WsContext>;

function sendError(ws: WS, message: string): void {
  ws.send(JSON.stringify({ error: message }));
}

export async function handleMosaicWsMessage(ws: WS, raw: string | Buffer): Promise<void> {
  if (typeof raw !== "string") {
    sendError(ws, "Expected JSON text frame");
    return;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    sendError(ws, "Invalid JSON frame");
    return;
  }

  const result = MosaicQueryBodySchema.safeParse(parsed);
  if (!result.success) {
    sendError(ws, "Query payload failed validation");
    return;
  }

  const { sql, type } = result.data;

  if (!isAllowedSql(sql)) {
    sendError(ws, "Statement type not allowed");
    return;
  }

  const store: EmbeddingStore = ws.data.store;

  try {
    if (type === "exec") {
      await store.execute(sql);
      ws.send(JSON.stringify({}));
      return;
    }

    if (type === "arrow") {
      const ipc = await store.queryArrow(sql);
      // Bun serializes Uint8Array as a binary WS frame; client receives it
      // as an ArrayBuffer because socketConnector sets binaryType.
      ws.send(ipc);
      return;
    }

    if (type === "json") {
      const rows = await store.queryJson(sql);
      ws.send(JSON.stringify(rows));
      return;
    }

    sendError(ws, `Unknown command: ${String(type)}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[mosaic-ws] ${type} failed: ${message}\n  SQL: ${sql}`);
    sendError(ws, message);
  }
}
