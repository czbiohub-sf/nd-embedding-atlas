import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import type { CollectionSummary } from "@ndea/protocol";
import type { MuData } from "@ndea/zarr";
import { buildPlateMounts, readPlateMeta } from "../../server/plate.ts";
import type { PlateChannel, PlateMetaInfo, PlateMount } from "../../server/plate.ts";
import type { DatasetSessionMetadata, ServerSession } from "../../server/state.ts";
import { createServerSession } from "../../server/state.ts";
import { diskBytes } from "../../server/status.ts";
import type { LaunchConfig } from "../config.ts";
import type { PreparedDatasets } from "./datasets.ts";
import type { PreparedQuerySession } from "./ingest.ts";
import type { Workspace } from "../../server/workspace.ts";
import { workspaceIssues } from "../../server/routes/workspace.ts";
import type { WorkspaceDocument } from "../../frontend/core/workspace/types.ts";
import { printAnnotationsRestored, printAnnotationsWarning } from "./output.ts";

type PlateMetadataByMount = Map<string, PlateMetaInfo | null>;

export interface PreparedServerSession {
  state: ServerSession;
  platesByMount: PlateMetadataByMount;
}

async function readPlateMetadata(mounts: readonly PlateMount[]): Promise<PlateMetadataByMount> {
  const entries = await Promise.all(
    mounts.map(async (mount) => [mount.mount, await readPlateMeta(mount.diskPath)] as const),
  );
  return new Map(entries);
}

export function resolveAnnotationsSidecarPath(zarrPath: string): string {
  const cacheRoot = process.env.XDG_CACHE_HOME ?? resolve(homedir(), ".cache");
  const directory = resolve(cacheRoot, "ndea", "annotations");
  mkdirSync(directory, { recursive: true });
  let hash = 5381;
  for (let index = 0; index < zarrPath.length; index += 1) {
    hash = ((hash << 5) + hash + zarrPath.charCodeAt(index)) >>> 0;
  }
  return resolve(directory, `${hash.toString(16)}.parquet`);
}

async function restoreAnnotations(state: ServerSession): Promise<void> {
  if (!state.annotationsSidecarPath) return;
  try {
    await state.store.loadAnnotationsSidecar(state.annotationsSidecarPath);
    const restored = state.store.annotationColumns.size;
    if (restored === 0) return;
    printAnnotationsRestored(restored);
  } catch (error) {
    printAnnotationsWarning(error);
  }
}

export async function prepareServerSession(
  config: LaunchConfig,
  datasets: PreparedDatasets,
  query: PreparedQuerySession,
  workspace: Workspace,
  collections: CollectionSummary[],
): Promise<PreparedServerSession> {
  const plateMounts = buildPlateMounts(datasets.datasetConfigs, datasets.isMultiDataset);
  const platesByMount = await readPlateMetadata(plateMounts);
  const state = createServerSession({
    store: query.store,
    datasets: datasets.datasetConfigs,
    spatial: datasets.spatial,
    availableObsmKeys: datasets.availableObsmKeys,
    accessors: new Map(datasets.loaded.map(({ entry, adata }) => [entry.name, adata])),
    plateMounts,
    annotationsSidecarPath: query.cacheEnabled ? null : resolveAnnotationsSidecarPath(datasets.loaded[0].entry.path),
    workspace,
  });
  state.status = {
    ingest: query.cached ? "cached" : query.cacheEnabled ? "fresh" : "uncached",
    collection: config.collection,
    collections,
    datasets: datasets.loaded.map(({ entry, adata, obsmKeys, nVars }) => {
      // One mount per plate: `/plate/<name>` for a union, else the single dataset's `/plate`.
      const mount = entry.platePath && plateMounts.find((m) => (m.datasetKey ?? entry.name) === entry.name);
      const meta = mount ? platesByMount.get(mount.mount) : null;
      const color = (name: string, fallback: string) => (entry.channels?.[name]?.color ?? fallback).replace(/^#?/, "#");
      return {
        name: entry.name,
        format: adata.kind,
        path: entry.path,
        observations: adata.nObs,
        variables: nVars,
        obsColumns: adata.obs.columns.length,
        modalities:
          adata.kind === "mudata"
            ? [...(adata as MuData).mod].map(([name, mod]) => ({ name, observations: mod.nObs, variables: mod.nVars }))
            : undefined,
        embeddings: obsmKeys,
        plate: entry.platePath
          ? {
              path: entry.platePath,
              wells: meta?.wells ?? 0,
              channels: meta
                ? meta.channels.map((c) => ({ name: c.label, color: color(c.label, c.color) }))
                : Object.entries(entry.channels ?? {}).map(([name, c]) => ({ name, color: color(name, c.color) })),
            }
          : undefined,
      };
    }),
  };
  // Not awaited: the status screen shows `…` until the one walk per dataset finishes.
  for (const dataset of state.status.datasets) void diskBytes(dataset.path).then((bytes) => (dataset.bytes = bytes));
  await restoreAnnotations(state);
  const document = workspace.get().document as WorkspaceDocument | null;
  if (document) {
    for (const issue of await workspaceIssues(document, state)) {
      console.warn(`${issue.pointer}: ${issue.detail}`);
    }
  }
  return { state, platesByMount };
}

export function buildPlateMetadata(
  mounts: readonly PlateMount[],
  metadata: PlateMetadataByMount,
  isMultiDataset: boolean,
): { plateMeta: Record<string, unknown> | null; datasetChannels: Record<string, PlateChannel[]> | null } {
  if (mounts.length === 0) return { plateMeta: null, datasetChannels: null };

  const plateStores = mounts.map((mount) => ({
    mount: mount.mount,
    name: mount.datasetKey ?? "",
    ome_version: metadata.get(mount.mount)?.omeVersion ?? "0.4",
  }));
  const omeVersion = mounts.some((mount) => metadata.get(mount.mount)?.omeVersion === "0.5") ? "0.5" : "0.4";
  const datasetChannels = collectDatasetChannels(mounts, metadata);
  const displayMetadata = firstPlateMetadata(mounts, metadata);

  const plateMeta: Record<string, unknown> = {
    plate_stores: plateStores,
    plate_ome_version: omeVersion,
  };
  if (displayMetadata) {
    plateMeta.plate_channels = displayMetadata.channels;
    plateMeta.plate_pixel_scale = displayMetadata.pixelScale;
  }

  return {
    plateMeta,
    datasetChannels: isMultiDataset && Object.keys(datasetChannels).length > 0 ? datasetChannels : null,
  };
}

function collectDatasetChannels(
  mounts: readonly PlateMount[],
  metadata: PlateMetadataByMount,
): Record<string, PlateChannel[]> {
  const channels: Record<string, PlateChannel[]> = {};
  for (const mount of mounts) {
    const info = metadata.get(mount.mount);
    if (info && mount.datasetKey) channels[mount.datasetKey] = info.channels;
  }
  return channels;
}

function firstPlateMetadata(mounts: readonly PlateMount[], metadata: PlateMetadataByMount): PlateMetaInfo | null {
  for (const mount of mounts) {
    const info = metadata.get(mount.mount);
    if (info) return info;
  }
  return null;
}

export function buildDatasetMetadata(
  config: LaunchConfig,
  datasets: PreparedDatasets,
  session: PreparedServerSession,
): DatasetSessionMetadata {
  const { plateMeta, datasetChannels } = buildPlateMetadata(
    session.state.plateMounts,
    session.platesByMount,
    datasets.isMultiDataset,
  );
  return {
    obsColumnNames: config.obsColumns ?? datasets.detectedObsColumns,
    embeddingProps: {},
    hasPlate: session.state.plateMounts.length > 0,
    plateMeta,
    defaultX: "x",
    defaultY: "y",
    idColumn: "_index",
    datasetKeys: datasets.isMultiDataset ? [...datasets.datasetConfigs.keys()] : null,
    datasetChannels,
  };
}
