/** Startup orchestration: open stores, prepare data, and launch the server. */

import type { CollectionSummary } from "@ndea/protocol";
import { DEFAULT_PRESET, loadPreset } from "../server/presets.ts";
import { workspaceIssues } from "../server/routes/workspace.ts";
import { Workspace } from "../server/workspace.ts";
import { captureConsole } from "../server/status.ts";
import { sessionChanged } from "../server/ws.ts";
import type { WorkspaceDocument } from "../frontend/core/workspace/types.ts";
import type { LaunchConfig } from "./config.ts";
import { openDatasets, prepareDatasets, summarizeCollections } from "./startup/datasets.ts";
import { createQuerySession } from "./startup/ingest.ts";
import { printBanner, printReady } from "./startup/output.ts";
import { openBrowser, prewarmEmbeddings, registerGracefulShutdown, startServer } from "./startup/server.ts";
import { buildDatasetMetadata, prepareServerSession } from "./startup/session.ts";

/** Ingest one collection's datasets into a fresh session (own DuckDB `dataset` VIEW, caches, embeddings). */
async function openCollection(config: LaunchConfig, workspace: Workspace, collections: CollectionSummary[]) {
  const entries = config.collections.find((c) => c.name === config.collection)!.datasets;
  const loaded = await openDatasets(entries);
  const datasets = prepareDatasets(loaded);
  const query = await createQuerySession(datasets);
  const session = await prepareServerSession(config, datasets, query, workspace, collections);
  await prewarmEmbeddings(session.state).catch((error: unknown) => {
    session.state.store.close();
    throw error;
  });
  return { loaded, datasets, state: session.state, metadata: buildDatasetMetadata(config, datasets, session) };
}

/**
 * Drop every filter scope's `dataset` source (the Data panel's and ⌘K's dataset filter): its
 * clause names the old collection's datasets, so it would select nothing, or no `_dataset` column, in another.
 */
async function clearDatasetFilters(workspace: Workspace): Promise<void> {
  const { revision, document } = workspace.get();
  const filter = (document as WorkspaceDocument | null)?.state.filter ?? {};
  const ops = Object.keys(filter)
    .filter((scope) => filter[scope].dataset)
    .map((scope) => ({
      op: "remove" as const,
      path: `/state/filter/${scope.replaceAll("~", "~0").replaceAll("/", "~1")}/dataset`,
    }));
  if (ops.length === 0) return;
  const result = await workspace.patch(ops, { base: revision, actor: { kind: "system" } });
  if (result.kind !== "accepted") console.warn(`could not clear the dataset filter (${result.kind})`);
}

export async function startup(config: LaunchConfig): Promise<void> {
  const startTime = performance.now();
  captureConsole();
  printBanner();

  // Before ingest, so an invalid workspace file or preset fails in milliseconds, not minutes.
  // One workspace file for every collection: validation follows whichever session is open.
  const workspace = await Workspace.open(config.workspace, () => loadPreset(config.preset ?? DEFAULT_PRESET), {
    // Writes arrive only once the server is up, after `current` exists.
    validate: (document) => workspaceIssues(document, current.state),
  });
  const collections = await summarizeCollections(config.collections);
  let current = await openCollection(config, workspace, collections);

  // In-process: the new session is built beside the old one, then served on the same port.
  const switchCollection = async (name: string) => {
    console.log(`Switching to collection ${name}`);
    await clearDatasetFilters(workspace);
    const next = await openCollection({ ...config, collection: name }, workspace, collections);
    const previous = current;
    current = next;
    server.serve(next.state, next.metadata);
    previous.state.cropPool?.dispose();
    previous.state.store.close();
    sessionChanged(name);
  };
  const server = await startServer(config, current.state, current.metadata, switchCollection).catch(
    (error: unknown) => {
      current.state.store.close();
      throw error;
    },
  );

  // The status screen shows all of this, and the summary would reappear on the normal screen when it exits.
  if (!config.tui) printReady(config, current.loaded, current.datasets.availableObsmKeys, startTime);
  openBrowser(config);
  // Not awaited: the `view` action ends at "Ready" so Crust releases Ctrl-C to the server.
  void registerGracefulShutdown(config, () => current.state, server);
}
