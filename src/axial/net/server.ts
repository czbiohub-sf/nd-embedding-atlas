/**
 * Axial WebSocket Server — typed, binary-native, Bun.serve powered.
 *
 * Usage:
 *   const server = createServer<MyProtocol>({
 *     port: 3000,
 *     handlers: {
 *       meta: async (params) => ({ nObs: 39170, nVar: 768 }),
 *       query: async (params, send) => { send.binary(arrowIpc); },
 *       x: async (params, send) => {
 *         for (const chunk of chunks) send.binary(chunk);
 *         send.end();
 *       },
 *     },
 *   });
 */

import type { ControlMessage, ProtocolMap, ReqOf, ResOf } from "./protocol.ts";
import { encodeBinaryFrame } from "./protocol.ts";

// ---------------------------------------------------------------------------
// Handler types
// ---------------------------------------------------------------------------

/** Send interface passed to handlers for responding. */
export interface ResponseSender {
  /** Send a JSON response. Completes the request. */
  json(data: unknown): void;
  /** Send a binary chunk (Arrow IPC). For streaming, call multiple times. */
  binary(data: Uint8Array): void;
  /** Signal end of a streaming response. */
  end(): void;
  /** Signal an error. */
  error(message: string): void;
}

/** Handler function for a protocol method. */
export type Handler<Req, _Res = unknown> = (
  params: Req,
  send: ResponseSender,
) => Promise<void> | void;

/** Map of handlers matching a protocol. */
export type Handlers<P extends ProtocolMap> = {
  [M in keyof P]: Handler<ReqOf<P, M>, ResOf<P, M>>;
};

// ---------------------------------------------------------------------------
// Server options
// ---------------------------------------------------------------------------

export interface ServerOptions<P extends ProtocolMap> {
  port: number;
  handlers: Handlers<P>;
  /** Called when a client connects. */
  onConnect?: (clientId: string) => void;
  /** Called when a client disconnects. */
  onDisconnect?: (clientId: string) => void;
  /** Max concurrent requests per client. Default: 64. */
  maxConcurrent?: number;
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

interface ClientData {
  id: string;
  activeRequests: number;
}

let clientCounter = 0;

export function createServer<P extends ProtocolMap>(
  options: ServerOptions<P>,
): { server: ReturnType<typeof Bun.serve>; stop: () => void } {
  const { handlers, maxConcurrent = 64 } = options;

  const server = Bun.serve({
    port: options.port,

    fetch(req, server) {
      const url = new URL(req.url);

      // Upgrade to WebSocket
      if (url.pathname === "/ws" || req.headers.get("upgrade") === "websocket") {
        const clientId = `client_${++clientCounter}`;
        const upgraded = server.upgrade(req, {
          data: { id: clientId, activeRequests: 0 } as any,
        });
        if (!upgraded) {
          return new Response("WebSocket upgrade failed", { status: 400 });
        }
        return undefined;
      }

      // Health check
      if (url.pathname === "/health") {
        return new Response("ok");
      }

      return new Response("axial server — connect via WebSocket at /ws", { status: 200 });
    },

    websocket: {
      open(ws) {
        const data = ws.data as unknown as ClientData;
        options.onConnect?.(data.id);
      },

      close(ws) {
        const data = ws.data as unknown as ClientData;
        options.onDisconnect?.(data.id);
      },

      async message(ws, raw) {
        // Only handle text (JSON control) messages — binary from client not expected
        if (typeof raw !== "string") return;

        let msg: ControlMessage;
        try {
          msg = JSON.parse(raw);
        } catch {
          ws.send(JSON.stringify({ _id: -1, _ch: "error", _error: "Invalid JSON" }));
          return;
        }

        const { _id: id, _type: method, _stream: _isStream, ...params } = msg as any;

        if (typeof id !== "number" || typeof method !== "string") {
          ws.send(JSON.stringify({ _id: id ?? -1, _ch: "error", _error: "Missing _id or _type" }));
          return;
        }

        const handler = (handlers as any)[method];
        if (!handler) {
          ws.send(JSON.stringify({ _id: id, _ch: "error", _error: `Unknown method: ${method}` }));
          return;
        }

        // Concurrency check
        const data = ws.data as unknown as ClientData;
        if (data.activeRequests >= maxConcurrent) {
          ws.send(
            JSON.stringify({ _id: id, _ch: "error", _error: "Too many concurrent requests" }),
          );
          return;
        }
        data.activeRequests++;

        // Build sender — `responded` guards against double-decrement when a
        // handler calls a terminal method and then throws.
        let responded = false;
        const sender: ResponseSender = {
          json(responseData: unknown) {
            if (responded) return;
            responded = true;
            ws.send(JSON.stringify({ _id: id, _type: method, ...(responseData as object) }));
            data.activeRequests--;
          },
          binary(chunk: Uint8Array) {
            ws.send(encodeBinaryFrame(id, chunk));
          },
          end() {
            if (responded) return;
            responded = true;
            ws.send(JSON.stringify({ _id: id, _ch: "end" }));
            data.activeRequests--;
          },
          error(message: string) {
            if (responded) return;
            responded = true;
            ws.send(JSON.stringify({ _id: id, _ch: "error", _error: message }));
            data.activeRequests--;
          },
        };

        try {
          await handler(params, sender);
        } catch (err: any) {
          sender.error(err.message ?? String(err));
        }
      },
    },
  });

  return {
    server,
    stop() {
      void server.stop();
    },
  };
}
