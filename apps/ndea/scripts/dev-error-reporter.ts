import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Plugin } from "vite-plus";

/**
 * devErrorReporter: dev-only Vite plugin that bridges backend errors into
 * Vite's HMR client error overlay.
 *
 * Two mechanisms:
 *
 * 1. Writes `.vite/dev-server.json` with the dev-server URL and port on
 *    server start. The Bun backend reads this at startup (and on each error)
 *    so it can POST error payloads to us without hardcoding :5173 (which
 *    breaks under walk-up / worktree coexistence).
 *
 * 2. Registers a POST `/__dev_error` middleware that accepts JSON error
 *    payloads ({ message, stack?, file?, line?, column? }) and broadcasts
 *    them over the HMR WebSocket with type="error". Vite's client-side
 *    overlay renders the red full-screen error panel we already see for
 *    frontend compile errors, now for backend runtime errors too.
 *
 * Enabled only in dev (apply: "serve"). Build mode is a no-op.
 */

interface BackendErrorPayload {
  message?: string;
  stack?: string;
  id?: string;
  file?: string;
  line?: number;
  column?: number;
  plugin?: string;
}

export function devErrorReporter(): Plugin {
  return {
    name: "nd-viz:dev-error-reporter",
    apply: "serve",

    configureServer(server) {
      // ── Write dev-server.json once the listener is bound ───────────────
      server.httpServer?.once("listening", () => {
        try {
          const address = server.httpServer?.address();
          if (address == null || typeof address === "string") return;

          const port = address.port;
          const host = server.config.server.host ?? "localhost";
          const url = `http://${String(host)}:${port}`;
          const root = server.config.root;
          const outPath = join(root, ".vite", "dev-server.json");

          mkdirSync(dirname(outPath), { recursive: true });
          writeFileSync(outPath, JSON.stringify({ url, port, pid: process.pid }, null, 2), "utf8");
        } catch (err) {
          // Non-fatal: backend error overlay just won't work without this.
          server.config.logger.warn(`[dev-error-reporter] failed to write .vite/dev-server.json: ${String(err)}`);
        }
      });

      // ── POST /__dev_error → broadcast to HMR client ────────────────────
      server.middlewares.use("/__dev_error", (req, res) => {
        if (req.method !== "POST") {
          res.statusCode = 405;
          res.end("POST only");
          return;
        }

        const chunks: Buffer[] = [];
        req.on("data", (chunk: Buffer) => chunks.push(chunk));
        req.on("end", () => {
          try {
            const body = Buffer.concat(chunks).toString("utf8");
            const payload = JSON.parse(body) as BackendErrorPayload;

            // Vite's HMR `err` object expects `message` at minimum. Fill in
            // sensible defaults so the overlay always has something to show.
            server.ws.send({
              type: "error",
              err: {
                message: payload.message ?? "Unknown backend error",
                stack: payload.stack ?? "",
                id: payload.id ?? "(backend)",
                frame: "",
                plugin: payload.plugin ?? "backend",
                loc: payload.file
                  ? {
                      file: payload.file,
                      line: payload.line ?? 0,
                      column: payload.column ?? 0,
                    }
                  : undefined,
              },
            });

            res.statusCode = 204;
            res.end();
          } catch (err) {
            res.statusCode = 400;
            res.end(`Invalid error payload: ${String(err)}`);
          }
        });
      });
    },
  };
}
