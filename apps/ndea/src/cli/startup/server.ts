import { resolve } from "node:path";
import type { HTMLBundle } from "bun";
import { isCompiled } from "../../server/embedded-assets.ts";
import { flushAnnotationSaves } from "../../server/routes/annotate.ts";
import type { DatasetSessionMetadata, ServerSession } from "../../server/state.ts";
import { resolveFrontendDir } from "../../server/static.ts";
import type { LaunchConfig } from "../config.ts";
import { displayHost, printMissingFrontend, printShutdownHint, printShuttingDown } from "./output.ts";

// Held in a variable so `bun build --compile` never bundles the frontend source into the binary.
const DEV_INDEX_HTML = resolve(import.meta.dir, "../../../index.html");

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

export function resolveStaticDirectory(config: LaunchConfig): string | undefined {
  if (config.dev) return undefined;
  const staticDirectory = resolveFrontendDir() ?? undefined;
  if (!staticDirectory) printMissingFrontend();
  return staticDirectory;
}

export async function startServer(
  config: LaunchConfig,
  state: ServerSession,
  metadata: DatasetSessionMetadata,
  frontendDir: string | undefined,
): Promise<RunningServer> {
  const { createApp } = await import("../../server/app.ts");
  const { loadMcpToken } = await import("../../server/mcp-token.ts");
  const mcpToken = await loadMcpToken();
  let devHtml: HTMLBundle | undefined;
  if (config.dev) {
    if (isCompiled) throw new Error("--dev serves the frontend source: run it from a checkout (vp run dev)");
    devHtml = (await import(DEV_INDEX_HTML)).default;
  }
  try {
    return createApp({
      port: config.port,
      host: config.host,
      store: state.store,
      state,
      config: metadata,
      frontendDir,
      devHtml,
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
