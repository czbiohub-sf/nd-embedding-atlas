/** Startup orchestration — open stores, prepare data, and launch the server. */

import type { LaunchConfig } from "./config.ts";
import { openDatasets, prepareDatasets } from "./startup/datasets.ts";
import { createQuerySession } from "./startup/ingest.ts";
import { printBanner, printPreparingObs, printReady } from "./startup/output.ts";
import {
  bootstrapPlugins,
  installDevErrorBridge,
  openBrowser,
  prewarmEmbeddings,
  registerGracefulShutdown,
  resolveStaticDirectory,
  startServer,
} from "./startup/server.ts";
import { buildDatasetMetadata, prepareServerSession } from "./startup/session.ts";

export async function startup(config: LaunchConfig): Promise<void> {
  const startTime = performance.now();
  installDevErrorBridge(config);
  printBanner();

  const loaded = await openDatasets(config.datasets);
  printPreparingObs();
  const datasets = prepareDatasets(loaded);
  const query = await createQuerySession(datasets);
  const session = await prepareServerSession(config, datasets, query);

  const frontendDir = resolveStaticDirectory(config);
  const pluginSnapshot = await bootstrapPlugins(config);
  const metadata = buildDatasetMetadata(config, datasets, session);
  const server = await startServer(config, session.state, metadata, frontendDir, pluginSnapshot);

  await prewarmEmbeddings(session.state);
  printReady(config, loaded, datasets.availableObsmKeys, startTime);
  openBrowser(config);
  registerGracefulShutdown(session.state, server);
}
