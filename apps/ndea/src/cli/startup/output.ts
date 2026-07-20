import type { LaunchConfig } from "../config.ts";
import { getNetworkAddress } from "../resolve.ts";
import type { LoadedDataset } from "./datasets.ts";

export const ANSI = {
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  reset: "\x1b[0m",
} as const;

export function formatNumber(value: number): string {
  return value.toLocaleString("en-US");
}

export function printBanner(): void {
  console.log(`\n  ${ANSI.bold}nd-embedding-atlas${ANSI.reset} ${ANSI.dim}v0.1.0${ANSI.reset}\n`);
}

export function printOpeningDatasets(count: number): void {
  console.log(`  ${ANSI.dim}Opening ${count} dataset(s)...${ANSI.reset}`);
}

export function printDatasetOpened(dataset: LoadedDataset): void {
  console.log(
    `    ${ANSI.green}✓${ANSI.reset} ${dataset.entry.name}  ${ANSI.dim}${formatNumber(dataset.adata.nObs)} obs × ${formatNumber(dataset.nVars)} var${ANSI.reset}`,
  );
}

export function printDatasetOpenError(name: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`    ${ANSI.red}✗${ANSI.reset} ${name}: ${message}`);
}

export function printPreparingObs(): void {
  console.log(`\n  ${ANSI.dim}Preparing obs metadata...${ANSI.reset}`);
}

export function printUnsupportedMuDataUnion(): void {
  console.error(`    ${ANSI.red}✗${ANSI.reset} Multi-dataset unions with MuData are not supported yet.`);
}

export function printIngestOpenError(name: string, error: unknown): void {
  printDatasetOpenError(name, error);
}

export function printCachedIngest(key: string): void {
  console.log(`    ${ANSI.dim}↻ reusing cached ingest ${key}${ANSI.reset}`);
}

export function printIngestSummary(nObs: number, nVars: number | null): void {
  console.log(`    ${ANSI.green}✓${ANSI.reset} ${formatNumber(nObs)} observations loaded into DuckDB`);
  if (nVars !== null) {
    console.log(`    ${ANSI.green}✓${ANSI.reset} ${formatNumber(nVars)} variables loaded into DuckDB (var_base)`);
  }
}

export function printAnnotationsRestored(count: number): void {
  console.log(`    ${ANSI.green}✓${ANSI.reset} restored ${count} annotation column(s) from sidecar`);
}

export function printAnnotationsWarning(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  console.warn(`    ${ANSI.yellow}⚠${ANSI.reset}  annotations sidecar load failed: ${message}`);
}

export function printMissingFrontend(): void {
  console.log(
    `\n  ${ANSI.yellow}⚠${ANSI.reset}  No frontend dist found. Run ${ANSI.dim}vp build${ANSI.reset} (or ${ANSI.dim}vp run dev${ANSI.reset} for dev mode with Vite HMR).`,
  );
}

export function printPluginDiagnostic(sourceId: string, message: string): void {
  console.warn(`    ${ANSI.yellow}⚠${ANSI.reset}  plugin ${sourceId}: ${message}`);
}

export function printPortInUse(config: Pick<LaunchConfig, "port" | "host">): void {
  console.error(`\n  ${ANSI.red}✗${ANSI.reset} Port ${config.port} is already in use on ${config.host}.`);
  console.error(`    Find the existing process:  ${ANSI.dim}lsof -nP -iTCP:${config.port} -sTCP:LISTEN${ANSI.reset}`);
  console.error(`    Kill it:                    ${ANSI.dim}pkill -f "ndea view"${ANSI.reset}`);
  console.error(`    Or pick a different port:   ${ANSI.dim}ndea view ... --port 5056${ANSI.reset}\n`);
}

export function displayHost(host: string): string {
  return host === "127.0.0.1" ? "localhost" : host;
}

function printDatasets(datasets: readonly LoadedDataset[]): void {
  console.log(`\n  ${ANSI.bold}Datasets:${ANSI.reset}`);
  for (const dataset of datasets) {
    const plateTag = dataset.entry.platePath ? ` ${ANSI.dim}+ plate${ANSI.reset}` : "";
    console.log(
      `    ${dataset.entry.name}  ${ANSI.dim}${formatNumber(dataset.adata.nObs)} obs × ${formatNumber(dataset.nVars)} var${ANSI.reset}${plateTag}`,
    );
  }
}

function printServerUrls(config: LaunchConfig, host: string): void {
  const networkAddress = getNetworkAddress();
  console.log(`\n  ${ANSI.bold}Server:${ANSI.reset}`);
  console.log(`    ${ANSI.cyan}Local:${ANSI.reset}   http://${host}:${config.port}`);
  if (networkAddress && config.host !== "127.0.0.1") {
    console.log(`    ${ANSI.cyan}Network:${ANSI.reset} http://${networkAddress}:${config.port}`);
  }
}

function printDevUrls(config: LaunchConfig, host: string): void {
  console.log(
    `\n  ${ANSI.bold}App:${ANSI.reset}  ${ANSI.green}http://${host}:5173${ANSI.reset}  ${ANSI.dim}← open this (Vite + HMR)${ANSI.reset}`,
  );
  console.log(
    `  ${ANSI.bold}API:${ANSI.reset}  ${ANSI.dim}http://${host}:${config.port}  (backend: for /api/* and debugging)${ANSI.reset}`,
  );
}

export function printReady(
  config: LaunchConfig,
  datasets: readonly LoadedDataset[],
  availableObsmKeys: readonly string[],
  startTime: number,
): void {
  printDatasets(datasets);
  if (availableObsmKeys.length > 0) {
    console.log(`\n  ${ANSI.bold}Embeddings:${ANSI.reset} ${ANSI.dim}${availableObsmKeys.join(", ")}${ANSI.reset}`);
  }

  const host = displayHost(config.host);
  if (process.env.NDEA_NO_STATIC === "1") printDevUrls(config, host);
  else printServerUrls(config, host);

  const elapsed = ((performance.now() - startTime) / 1000).toFixed(1);
  console.log(`\n  ${ANSI.dim}Ready in ${elapsed}s${ANSI.reset}  ${ANSI.dim}(pid ${process.pid})${ANSI.reset}`);
}

export function printShutdownHint(): void {
  console.log(`\n  ${ANSI.dim}Press Ctrl+C to stop${ANSI.reset}\n`);
}

export function printShuttingDown(): void {
  console.log(`\n  ${ANSI.dim}Shutting down...${ANSI.reset}`);
}
