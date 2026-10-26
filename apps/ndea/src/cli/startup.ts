/** Startup orchestration: open stores, prepare data, and launch the server. */

import type { CollectionSummary } from "@ndea/protocol";
import { Harness } from "../server/harness.ts";
import { DEFAULT_PRESET, loadPreset } from "../server/presets.ts";
import { workspaceIssues } from "../server/routes/workspace.ts";
import { SessionHost } from "../server/session-host.ts";
import { Workspace } from "../server/workspace.ts";
import { captureConsole } from "../server/status.ts";
import type { LaunchConfig } from "./config.ts";
import { openDatasets, prepareDatasets, summarizeCollections } from "./startup/datasets.ts";
import { createQuerySession } from "./startup/ingest.ts";
import { printBanner, printReady } from "./startup/output.ts";
import { openBrowser, prewarmEmbeddings, registerGracefulShutdown, startServer } from "./startup/server.ts";
import { buildDatasetMetadata, prepareServerSession } from "./startup/session.ts";

/** Ingest one collection's datasets into a fresh session (own DuckDB `dataset` VIEW, caches, embeddings). */
async function openCollection(
  config: LaunchConfig,
  shared: { workspace: Workspace; harness: Harness },
  collections: CollectionSummary[],
) {
  const entries = config.collections.find((c) => c.name === config.collection)!.datasets;
  const loaded = await openDatasets(entries);
  const datasets = prepareDatasets(loaded);
  const query = await createQuerySession(datasets);
  const session = await prepareServerSession(config, datasets, query, shared, collections);
  await prewarmEmbeddings(session.state).catch((error: unknown) => {
    session.state.store.close();
    throw error;
  });
  return { loaded, datasets, state: session.state, metadata: buildDatasetMetadata(config, datasets, session) };
}

export async function startup(config: LaunchConfig): Promise<void> {
  const startTime = performance.now();
  captureConsole();
  printBanner();

  // Before ingest, so an invalid workspace file or preset fails in milliseconds, not minutes.
  // One workspace file (and one harness) for every collection: validation follows whichever session is open.
  const workspace = await Workspace.open(config.workspace, () => loadPreset(config.preset ?? DEFAULT_PRESET), {
    // Writes arrive only once the server is up, after `sessions` exists.
    validate: (document) => workspaceIssues(document, sessions.current.state),
  });
  const shared = { workspace, harness: new Harness(workspace) };
  const collections = await summarizeCollections(config.collections);
  const first = await openCollection(config, shared, collections);
  // In-process: a new collection's session is built beside the old one, then served on the same port.
  const sessions = new SessionHost(first, (name) =>
    openCollection({ ...config, collection: name }, shared, collections),
  );
  const server = await startServer(config, sessions).catch((error: unknown) => {
    first.state.store.close();
    throw error;
  });

  // The status screen shows all of this, and the summary would reappear on the normal screen when it exits.
  if (!config.tui) printReady(config, first.loaded, first.datasets.availableObsmKeys, startTime);
  openBrowser(config);
  // Not awaited: the `view` action ends at "Ready" so Crust releases Ctrl-C to the server.
  void registerGracefulShutdown(config, () => sessions.current.state, server);
}
