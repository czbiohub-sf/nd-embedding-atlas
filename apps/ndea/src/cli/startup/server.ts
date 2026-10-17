import { flushAnnotationSaves } from "../../server/routes/annotate.ts";
import type { DatasetSessionMetadata, ServerSession } from "../../server/state.ts";
import type { LaunchConfig } from "../config.ts";
import { isCompiledBinary } from "../lib/paths.ts";
import { displayHost, printShutdownHint, printShuttingDown } from "./output.ts";

interface RunningServer {
  stop(closeActiveConnections?: boolean): void | Promise<void>;
}

function isPortCollision(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("address already in use") ||
    message.includes("EADDRINUSE") ||
    (message.includes("Is port") && message.includes("in use"))
  );
}

export async function startServer(
  config: LaunchConfig,
  state: ServerSession,
  metadata: DatasetSessionMetadata,
): Promise<RunningServer> {
  // A binary embeds the built frontend; only a checkout has the source for Bun's dev server.
  if (config.dev && isCompiledBinary()) {
    throw new Error("--dev serves the frontend source: run it from a checkout (vp run dev)");
  }
  const { createApp } = await import("../../server/app.ts");
  const { loadMcpToken } = await import("../../server/mcp-token.ts");
  const mcpToken = await loadMcpToken();
  try {
    return createApp({
      port: config.port,
      host: config.host,
      store: state.store,
      state,
      config: metadata,
      dev: config.dev,
      mcpToken,
    });
  } catch (error) {
    if (!isPortCollision(error)) throw error;
    throw new Error(
      `port ${config.port} is already in use on ${config.host}\n` +
        `  find the existing process:  lsof -nP -iTCP:${config.port} -sTCP:LISTEN\n` +
        `  stop it:                    pkill -f "ndea view"\n` +
        `  or pick another port:       ndea view ... --port ${config.port + 1}`,
      { cause: error },
    );
  }
}

export async function prewarmEmbeddings(state: ServerSession): Promise<void> {
  if (state.availableObsmKeys.length === 0) return;
  const { loadEmbeddingAsync } = await import("../../server/routes/embeddings.ts");
  await Promise.all(state.availableObsmKeys.map((key) => loadEmbeddingAsync(key, state)));
}

export function openBrowser(config: LaunchConfig): void {
  if (config.noOpen) return;
  const url = `http://${displayHost(config.host)}:${config.port}`;
  try {
    if (process.platform === "darwin") Bun.spawn(["open", url]);
    else if (process.platform === "linux") Bun.spawn(["xdg-open", url]);
    else if (process.platform === "win32") Bun.spawn(["cmd", "/c", "start", "", url]);
  } catch {
    // Browser opening is non-critical; the URL was already printed.
  }
}

export function registerGracefulShutdown(state: ServerSession, server: RunningServer): void {
  printShutdownHint();
  const shutdown = async () => {
    printShuttingDown();
    await flushAnnotationSaves(state);
    void server.stop();
    state.store.close();
    // The server outlives the `view` action (Crust's invocation ended at
    // "Ready"), so no command boundary is left to return through: exiting is
    // how a long-running server stops.
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}
