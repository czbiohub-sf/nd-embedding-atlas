import type { PluginRuntimeSnapshot } from "../../server/plugins/assets.ts";
import { flushAnnotationSaves } from "../../server/routes/annotate.ts";
import type { DatasetSessionMetadata, ServerSession } from "../../server/state.ts";
import { resolveFrontendDir } from "../../server/static.ts";
import type { LaunchConfig } from "../config.ts";
import {
  displayHost,
  printMissingFrontend,
  printPluginDiagnostic,
  printPortInUse,
  printShutdownHint,
  printShuttingDown,
} from "./output.ts";

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

export function installDevErrorBridge(config: LaunchConfig): void {
  if (!config.noStatic) return;
  process.on("uncaughtException", (error) => void reportBackendError(error));
  process.on("unhandledRejection", (reason) => void reportBackendError(reason));
}

async function readViteDevUrl(): Promise<string | null> {
  try {
    const { readFileSync } = await import("node:fs");
    const raw = readFileSync(".vite/dev-server.json", "utf8");
    const { url } = JSON.parse(raw) as { url?: string };
    return typeof url === "string" ? url : null;
  } catch {
    return null;
  }
}

async function reportBackendError(error: unknown): Promise<void> {
  const url = await readViteDevUrl();
  if (!url) return;
  const payload =
    error instanceof Error
      ? { message: error.message, stack: error.stack ?? "" }
      : { message: String(error), stack: "" };
  try {
    await fetch(`${url}/__dev_error`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch {
    // Reporting is best-effort; the original terminal error remains primary.
  }
}

export function resolveStaticDirectory(config: LaunchConfig): string | undefined {
  if (config.noStatic) return undefined;
  const staticDirectory = resolveFrontendDir() ?? undefined;
  if (!staticDirectory) printMissingFrontend();
  return staticDirectory;
}

export async function bootstrapPlugins(config: LaunchConfig): Promise<PluginRuntimeSnapshot> {
  const { buildPluginBootstrap } = await import("../../server/plugins/bootstrap.ts");
  const snapshot = await buildPluginBootstrap({
    projectPluginPaths: config.pluginPaths,
    projectPluginContainmentRoot: config.pluginPathRoot,
  });
  for (const diagnostic of snapshot.catalog.diagnostics) {
    printPluginDiagnostic(diagnostic.sourceId, diagnostic.message);
  }
  return snapshot;
}

export async function startServer(
  config: LaunchConfig,
  state: ServerSession,
  metadata: DatasetSessionMetadata,
  frontendDir: string | undefined,
  pluginSnapshot: PluginRuntimeSnapshot,
): Promise<RunningServer> {
  const { createApp } = await import("../../server/app.ts");
  try {
    return createApp({
      port: config.port,
      host: config.host,
      store: state.store,
      state,
      config: metadata,
      frontendDir,
      noStatic: config.noStatic,
      pluginSnapshot,
    });
  } catch (error) {
    if (!isPortCollision(error)) throw error;
    printPortInUse(config);
    process.exit(1);
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
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}
