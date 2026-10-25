import type { Server } from "bun";
import type { CreateAppOptions } from "../../server/app.ts";
import { stopRemoteRender } from "../../server/remote-render.ts";
import type { DatasetSessionMetadata, ServerSession } from "../../server/state.ts";
import type { ServerSocketContext } from "../../server/ws.ts";
import type { LaunchConfig } from "../config.ts";
import { isCompiledBinary } from "../lib/paths.ts";
import { displayHost, openUrl, printShutdownHint, printShuttingDown } from "./output.ts";

export interface RunningServer {
  stop(closeActiveConnections?: boolean): void | Promise<void>;
  /** Serve another session on the same port (a collection switch). */
  serve(state: ServerSession, metadata: DatasetSessionMetadata): void;
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
  switchCollection: (name: string) => Promise<void>,
): Promise<RunningServer> {
  // A binary embeds the built frontend; only a checkout has the source for Bun's dev server.
  if (config.dev && isCompiledBinary()) {
    throw new Error("--dev serves the frontend source: run it from a checkout (vp run dev)");
  }
  const { appServeOptions, createApp } = await import("../../server/app.ts");
  const { loadMcpToken } = await import("../../server/mcp-token.ts");
  const mcpToken = await loadMcpToken();
  const options = (session: ServerSession, sessionMetadata: DatasetSessionMetadata): CreateAppOptions => ({
    port: config.port,
    host: config.host,
    store: session.store,
    state: session,
    config: sessionMetadata,
    dev: config.dev,
    mcpToken,
    switchCollection,
  });
  let server: Server<ServerSocketContext>;
  try {
    server = createApp(options(state, metadata));
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
  return {
    stop: (closeActiveConnections) => server.stop(closeActiveConnections),
    serve: (next, nextMetadata) => server.reload<string>(appServeOptions(options(next, nextMetadata))),
  };
}

export async function prewarmEmbeddings(state: ServerSession): Promise<void> {
  if (state.availableObsmKeys.length === 0) return;
  const { loadEmbeddingAsync } = await import("../../server/routes/embeddings.ts");
  await Promise.all(state.availableObsmKeys.map((key) => loadEmbeddingAsync(key, state)));
}

export const localUrl = (config: Pick<LaunchConfig, "host" | "port">): string =>
  `http://${displayHost(config.host)}:${config.port}`;

export function openBrowser(config: LaunchConfig): void {
  if (!config.noOpen) openUrl(localUrl(config));
}

/** Ctrl+C and SIGTERM, or `q` on the status screen when `config.tui` is set, stop the server gracefully. */
export async function registerGracefulShutdown(
  config: Pick<LaunchConfig, "host" | "port" | "tui">,
  /** The live session: a collection switch replaces it. */
  session: () => ServerSession,
  server: Pick<RunningServer, "stop">,
): Promise<void> {
  const shutdown = async () => {
    printShuttingDown();
    await stopRemoteRender();
    void server.stop();
    session().store.close();
    // The server outlives the `view` action (Crust's invocation ended at
    // "Ready"), so no command boundary is left to return through: exiting is
    // how a long-running server stops.
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
  if (!config.tui) return printShutdownHint();
  // Lazy: OpenTUI loads its native library on import; log mode never needs it.
  const [{ runStatusTui }, { getRuntimeStatus, muteConsole }, { datasetStructure }] = await Promise.all([
    import("../tui.ts"),
    import("../../server/status.ts"),
    import("../../server/structure.ts"),
  ]);
  const url = localUrl(config);
  muteConsole(true);
  await runStatusTui(
    () => getRuntimeStatus(session(), url),
    (name) => datasetStructure(session(), name),
  );
  muteConsole(false);
  await shutdown();
}
