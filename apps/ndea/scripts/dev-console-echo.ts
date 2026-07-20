import type { Plugin } from "vite-plus";

/**
 * devConsoleEcho: dev-only Vite plugin that echoes browser console output
 * (and uncaught errors / unhandled promise rejections) into the terminal
 * stdout where the dev server is running.
 *
 * Mirrors the spirit of Bun's fullstack `Bun.serve({ development: { console:
 * true } })` (see https://bun.com/docs/bundler/fullstack) without requiring
 * us to switch off Vite for HMR.
 *
 * Wiring:
 *   1. `transformIndexHtml` injects a tiny shim that monkey-patches
 *      `console.{log,info,warn,error,debug}` to also push entries onto a
 *      batched queue. Originals fire normally so the browser DevTools
 *      console is unaffected.
 *   2. The shim flushes every 100ms (or on visibility change / pagehide)
 *      via `POST /__client_console` to a dev-server middleware.
 *   3. The middleware writes one ANSI-colored line per entry to stdout,
 *      prefixed with `[browser:<level>]`.
 *
 * Filters: messages starting with `[vite`/`[hmr` are dropped: Vite's own
 * HMR client chatter already lands in stdout via the proxy logger, no need
 * to double-print it.
 *
 * Apply: serve only: production builds inline nothing.
 */

interface ConsoleEntry {
  level: "log" | "info" | "warn" | "error" | "debug";
  message: string;
  ts: number;
}

interface ConsoleBatchPayload {
  batch?: ConsoleEntry[];
}

const COLOR: Record<string, string> = {
  error: "\x1b[31m", // red
  warn: "\x1b[33m", // yellow
  info: "\x1b[36m", // cyan
  debug: "\x1b[90m", // gray
  log: "\x1b[37m", // white
};
const RESET = "\x1b[0m";

const CLIENT_SHIM = `
(function () {
  if (typeof window === "undefined" || window.__ndeaConsoleEcho) return;
  window.__ndeaConsoleEcho = true;

  const original = {
    log: console.log,
    info: console.info,
    warn: console.warn,
    error: console.error,
    debug: console.debug,
  };

  const queue = [];
  let flushScheduled = false;
  let suppress = false;
  const MAX_QUEUE = 200;

  function fmtArg(a) {
    if (a == null) return String(a);
    if (typeof a === "string") return a;
    if (typeof a === "number" || typeof a === "boolean") return String(a);
    if (a instanceof Error) return a.stack || a.message;
    if (typeof a === "function") return "[Function " + (a.name || "anonymous") + "]";
    try {
      const s = JSON.stringify(a);
      return s && s.length > 600 ? s.slice(0, 600) + "…" : s;
    } catch (_) {
      return Object.prototype.toString.call(a);
    }
  }

  function flush() {
    flushScheduled = false;
    if (queue.length === 0) return;
    const batch = queue.splice(0, queue.length);
    suppress = true;
    try {
      fetch("/__client_console", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ batch }),
        keepalive: true,
      })
        .catch(function () {})
        .finally(function () { suppress = false; });
    } catch (_) {
      suppress = false;
    }
  }

  function enqueue(level, args) {
    if (suppress) return;
    let message;
    try {
      message = Array.prototype.map.call(args, fmtArg).join(" ");
    } catch (_) {
      return;
    }
    // Skip Vite's own HMR chatter: already shows up via the dev-server logger.
    if (message.startsWith("[vite") || message.startsWith("[hmr")) return;
    queue.push({ level: level, message: message, ts: Date.now() });
    if (queue.length > MAX_QUEUE) queue.splice(0, queue.length - MAX_QUEUE);
    if (!flushScheduled) {
      flushScheduled = true;
      setTimeout(flush, 100);
    }
  }

  ["log", "info", "warn", "error", "debug"].forEach(function (level) {
    console[level] = function () {
      try { enqueue(level, arguments); } catch (_) {}
      original[level].apply(console, arguments);
    };
  });

  window.addEventListener("error", function (e) {
    enqueue("error", [
      "Uncaught:",
      e.message || String(e.error),
      (e.filename || "?") + ":" + (e.lineno || 0) + ":" + (e.colno || 0),
    ]);
  });
  window.addEventListener("unhandledrejection", function (e) {
    const reason = e.reason instanceof Error ? (e.reason.stack || e.reason.message) : String(e.reason);
    enqueue("error", ["Unhandled rejection:", reason]);
  });
  window.addEventListener("visibilitychange", flush);
  window.addEventListener("pagehide", flush);
})();
`.trim();

export function devConsoleEcho(): Plugin {
  return {
    name: "ndea:dev-console-echo",
    apply: "serve",

    transformIndexHtml: {
      order: "pre",
      handler(html) {
        return html.replace(/<head([^>]*)>/i, `<head$1>\n<script>${CLIENT_SHIM}</script>`);
      },
    },

    configureServer(server) {
      server.middlewares.use("/__client_console", (req, res) => {
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
            const payload = JSON.parse(body) as ConsoleBatchPayload;
            const batch = payload.batch ?? [];
            for (const entry of batch) {
              const color = COLOR[entry.level] ?? COLOR.log;
              const line = `${color}[browser:${entry.level}]${RESET} ${entry.message}`;
              process.stdout.write(`${line}\n`);
            }
            res.statusCode = 204;
            res.end();
          } catch (err) {
            res.statusCode = 400;
            res.end(`Invalid console payload: ${String(err)}`);
          }
        });
      });
    },
  };
}
