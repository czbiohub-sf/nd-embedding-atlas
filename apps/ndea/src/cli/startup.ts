/** Startup orchestration: open stores, prepare data, and launch the server. */

import { DEFAULT_PRESET, loadPreset } from "../server/presets.ts";
import { WorkspaceDocumentStore } from "../server/workspace.ts";
import type { LaunchConfig } from "./config.ts";
import { openDatasets, prepareDatasets } from "./startup/datasets.ts";
import { createQuerySession } from "./startup/ingest.ts";
import { printBanner, printReady } from "./startup/output.ts";
import {
  openBrowser,
  prewarmEmbeddings,
  registerGracefulShutdown,
  resolveStaticDirectory,
  startServer,
} from "./startup/server.ts";
import { buildDatasetMetadata, prepareServerSession } from "./startup/session.ts";

export async function startup(config: LaunchConfig): Promise<void> {
  const startTime = performance.now();
  printBanner();

  // Before ingest, so an invalid workspace file or preset fails in milliseconds, not minutes.
  const workspace = await WorkspaceDocumentStore.open(config.workspace, () =>
    loadPreset(config.preset ?? DEFAULT_PRESET),
  );
  const loaded = await openDatasets(config.datasets);
  const datasets = prepareDatasets(loaded);
  const query = await createQuerySession(datasets);
  const session = await prepareServerSession(config, datasets, query, workspace);

  const frontendDir = resolveStaticDirectory(config);
  const metadata = buildDatasetMetadata(datasets, session);
  const server = await startServer(config, session.state, metadata, frontendDir);

  // A failure past this point would otherwise leave the server holding the process open.
  await prewarmEmbeddings(session.state).catch((error: unknown) => {
    void server.stop();
    session.state.store.close();
    throw error;
  });
  printReady(config, loaded, datasets.availableObsmKeys, startTime);
  openBrowser(config);
  registerGracefulShutdown(session.state, server);
}
