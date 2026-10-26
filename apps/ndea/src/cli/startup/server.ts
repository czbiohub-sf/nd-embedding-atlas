import type { Server } from "bun";
import type { CreateAppOptions } from "../../server/app.ts";
import { stopRemoteRender } from "../../server/remote-render.ts";
import type { SessionHost, HostedSession } from "../../server/session-host.ts";
import type { ServerSession } from "../../server/state.ts";
import type { ServerSocketContext } from "../../server/ws.ts";
import type { LaunchConfig } from "../config.ts";
import { isCompiledBinary } from "../../env/paths.ts";
import { displayHost, openUrl, printShutdownHint, printShuttingDown } from "./output.ts";

type RunningServer = Server<ServerSocketContext>;

function isPortCollision(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("address already in use") ||
    message.includes("EADDRINUSE") ||
    (message.includes("Is port") && message.includes("in use"))
  );
}

/** Serve `sessions.current`; each collection switch reloads the routes for the new session on the same port. */
export async function startServer(config: LaunchConfig, sessions: SessionHost): Promise<RunningServer> {
  // A binary embeds the built frontend; only a checkout has the source for Bun's dev server.
  if (config.dev && isCompiledBinary()) {
    throw new Error("--dev serves the frontend source: run it from a checkout (vp run dev)");
  }
  const { appServeOptions, createApp } = await import("../../server/app.ts");
  const { loadMcpToken } = await import("../../server/mcp-token.ts");
  const mcpToken = await loadMcpToken();
  const options = ({ state, metadata }: HostedSession): CreateAppOptions => ({
    port: config.port,
    host: config.host,
    store: state.store,
    state,
    config: metadata,
    dev: config.dev,
    mcpToken,
    sessions,
  });
  let server: RunningServer;
  try {
    server = createApp(options(sessions.current));
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
  // Subscribed before any socket, so routes reload before `session/watch` tells tabs to reload.
  sessions.onChange((next) => server.reload<string>(appServeOptions(options(next))));
  return server;
}

export async function prewarmEmbeddings(state: ServerSession): Promise<void> {
  if (state.availableObsmKeys.length === 0) return;
  const { loadEmbeddingAsync } = await import("../../server/routes/embeddings.ts");
  await Promise.all(state.availableObsmKeys.map((key) => loadEmbeddingAsync(key, state)));
}

const localUrl = (config: Pick<LaunchConfig, "host" | "port">): string =>
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
    // fallow-ignore-next-line boundary-violation -- the server's shutdown (AGENTS.md)
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
  if (!config.tui) return printShutdownHint();
  // Lazy: OpenTUI loads its native library on import; log mode never needs it.
  const [{ runStatusTui }, { getRuntimeStatus, muteConsole }] = await Promise.all([
    import("../tui.ts"),
    import("../../server/status.ts"),
  ]);
  const url = localUrl(config);
  muteConsole(true);
  await runStatusTui(() => getRuntimeStatus(session(), url));
  muteConsole(false);
  await shutdown();
}
