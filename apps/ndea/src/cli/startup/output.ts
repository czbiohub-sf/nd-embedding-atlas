import type { LaunchConfig } from "../config.ts";
import { accent, heading, label, num, ok, url, warn } from "../lib/style.ts";
import { getNetworkAddress } from "../resolve.ts";
import { VERSION } from "../../env/version.ts";
import type { LoadedDataset } from "./datasets.ts";

export function printBanner(): void {
  console.log(`\n  ${accent("nd-embedding-atlas")} ${label(`v${VERSION}`)}\n`);
}

export function describeDataset(dataset: LoadedDataset): string {
  return `${dataset.entry.name}  ${label(`${num(dataset.adata.nObs)} obs × ${num(dataset.nVars)} var`)}`;
}

export function printAnnotationsRestored(count: number): void {
  console.log(`  ${ok(`restored ${count} annotation column(s) from sidecar`)}`);
}

export function printAnnotationsWarning(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  console.warn(`  ${warn(`annotations sidecar load failed: ${message}`)}`);
}

export function displayHost(host: string): string {
  return host === "127.0.0.1" ? "localhost" : host;
}

export function printReady(
  config: LaunchConfig,
  datasets: readonly LoadedDataset[],
  availableObsmKeys: readonly string[],
  startTime: number,
): void {
  console.log(`\n  ${heading("Datasets")}`);
  for (const dataset of datasets) {
    console.log(`    ${describeDataset(dataset)}${dataset.entry.platePath ? label(" + plate") : ""}`);
  }
  if (availableObsmKeys.length > 0) {
    console.log(`\n  ${heading("Embeddings")}  ${label(availableObsmKeys.join(", "))}`);
  }

  const host = displayHost(config.host);
  const origin = `http://${host}:${config.port}`;
  console.log(`\n  ${heading("Local")}    ${url(origin)}`);
  const networkAddress = getNetworkAddress();
  if (networkAddress && config.host !== "127.0.0.1") {
    console.log(`  ${heading("Network")}  ${url(`http://${networkAddress}:${config.port}`)}`);
  }
  if (!["127.0.0.1", "localhost", "::1"].includes(config.host)) {
    console.warn(
      `  ${warn(`bound to ${config.host}: data, /ws and /plate routes are unauthenticated; prefer loopback + SSH forwarding`)}`,
    );
  }
  console.log(
    `  ${heading("MCP")}      ${url(`${origin}/mcp`)}  ${label("(Authorization: Bearer <~/.ndea/mcp-token>)")}`,
  );

  const elapsed = ((performance.now() - startTime) / 1000).toFixed(1);
  console.log(`\n  ${label(`Ready in ${elapsed}s  (pid ${process.pid})`)}`);
}

export function printShutdownHint(): void {
  console.log(`  ${label("Press Ctrl+C to stop")}\n`);
}

export function printShuttingDown(): void {
  console.log(`\n  ${label("Shutting down...")}`);
}

export function openUrl(href: string): void {
  try {
    if (process.platform === "darwin") Bun.spawn(["open", href]);
    else if (process.platform === "linux") Bun.spawn(["xdg-open", href]);
    else if (process.platform === "win32") Bun.spawn(["cmd", "/c", "start", "", href]);
  } catch {
    // Browser opening is non-critical; the URL is on screen or printed.
  }
}
