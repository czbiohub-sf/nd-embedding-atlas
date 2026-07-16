import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { buildPlateMounts, readPlateMeta } from "../../server/plate.ts";
import type { PlateChannel, PlateMetaInfo, PlateMount } from "../../server/plate.ts";
import type { DatasetSessionMetadata, ServerSession } from "../../server/state.ts";
import type { LaunchConfig } from "../config.ts";
import type { PreparedDatasets } from "./datasets.ts";
import type { PreparedQuerySession } from "./ingest.ts";
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
    for (const name of state.store.annotationColumns.keys()) {
      if (!state.obsColumns.includes(name)) state.obsColumns.push(name);
    }
    printAnnotationsRestored(restored);
  } catch (error) {
    printAnnotationsWarning(error);
  }
}

export async function prepareServerSession(
  config: LaunchConfig,
  datasets: PreparedDatasets,
  query: PreparedQuerySession,
): Promise<PreparedServerSession> {
  const plateMounts = buildPlateMounts(datasets.datasetConfigs, datasets.isMultiDataset);
  const platesByMount = await readPlateMetadata(plateMounts);
  const state: ServerSession = {
    store: query.store,
    datasets: datasets.datasetConfigs,
    spatial: datasets.spatial,
    obsColumns: config.obsColumns ?? datasets.detectedObsColumns,
    port: config.port,
    availableObsmKeys: datasets.availableObsmKeys,
    loadingTasks: new Map(),
    loadErrors: new Map(),
    accessors: new Map(datasets.loaded.map(({ entry, adata }) => [entry.name, adata])),
    plateMounts,
    obsmLoaders: new Map(),
    cropPool: null,
    annotationsSidecarPath: query.cacheEnabled ? null : resolveAnnotationsSidecarPath(config.datasets[0].path),
  };
  await restoreAnnotations(state);
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
    obsColumnNames: session.state.obsColumns,
    embeddingProps: {},
    hasPlate: session.state.plateMounts.length > 0,
    plateMeta,
    defaultX: "x",
    defaultY: "y",
    idColumn: "_index",
    datasetKeys: datasets.isMultiDataset ? [...datasets.datasetConfigs.keys()] : null,
    datasetChannels,
    preset: config.preset,
  };
}
