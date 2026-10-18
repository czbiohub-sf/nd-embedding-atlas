import { AnnData, MuData, open, type DatasetHandle } from "@ndea/zarr";
import { DEFAULT_OBSM_PRIORITY } from "../../server/store.ts";
import { detectSpatialColumns, spatialHiddenColumns } from "../../server/state.ts";
import type { DatasetMountConfig, SpatialColumns } from "../../server/state.ts";
import type { ProjectDatasetMount } from "../config.ts";
import { task } from "../lib/style.ts";
import { describeDataset } from "./output.ts";

export interface LoadedDataset {
  entry: ProjectDatasetMount;
  adata: DatasetHandle;
  obsmKeys: string[];
  nVars: number;
}

export interface PreparedDatasets {
  loaded: LoadedDataset[];
  isMultiDataset: boolean;
  hasMuData: boolean;
  datasetNames: string[];
  datasetConfigs: Map<string, DatasetMountConfig>;
  availableObsmKeys: string[];
  spatial: SpatialColumns | null;
  hidden: Set<string>;
  detectedObsColumns: string[];
}

function countMuDataVariables(mudata: MuData): number {
  let count = mudata.var.length;
  for (const modality of mudata.mod.values()) count += modality.nVars;
  return count;
}

async function openDataset(entry: ProjectDatasetMount): Promise<LoadedDataset> {
  const parsed = await open(entry.path);
  let adata: DatasetHandle;
  let nVars: number;

  if (parsed.kind === "anndata") {
    const annData = AnnData.from(parsed);
    adata = annData;
    nVars = annData.nVars;
  } else if (parsed.kind === "mudata") {
    const muData = MuData.from(parsed);
    adata = muData;
    nVars = countMuDataVariables(muData);
  } else {
    throw new Error(`${entry.name}: store is ${parsed.kind}, not AnnData/MuData`);
  }

  return { entry, adata, nVars, obsmKeys: await discoverObsmKeys(adata) };
}

export async function openDatasets(entries: readonly ProjectDatasetMount[]): Promise<LoadedDataset[]> {
  const loaded: LoadedDataset[] = [];
  for (const entry of entries) {
    const dataset = await task(`Opening ${entry.name}`, async (update) => {
      try {
        const opened = await openDataset(entry);
        update(describeDataset(opened));
        return opened;
      } catch (error) {
        throw new Error(`${entry.name}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
      }
    });
    loaded.push(dataset);
  }
  return loaded;
}

function collectDatasetConfigs(loaded: readonly LoadedDataset[]): Map<string, DatasetMountConfig> {
  return new Map(
    loaded.map(({ entry }) => [entry.name, { path: entry.path, platePath: entry.platePath, channels: entry.channels }]),
  );
}

export function prepareDatasets(loaded: LoadedDataset[]): PreparedDatasets {
  const isMultiDataset = loaded.length > 1;
  const hasMuData = loaded.some(({ adata }) => adata.kind === "mudata");
  if (hasMuData && isMultiDataset) throw new Error("multi-dataset unions with MuData are not supported yet");

  const firstColumns = [...loaded[0].adata.obs.columns];
  const detectedSpatial = detectSpatialColumns(new Set(firstColumns));
  const hasSpatial = detectedSpatial.fov != null || detectedSpatial.bbox != null || detectedSpatial.x != null;
  const spatial = hasSpatial ? detectedSpatial : null;
  const hidden = spatialHiddenColumns(spatial);
  const allObsmKeys = loaded.flatMap(({ obsmKeys }) => obsmKeys);

  return {
    loaded,
    isMultiDataset,
    hasMuData,
    datasetNames: loaded.map(({ entry }) => entry.name),
    datasetConfigs: collectDatasetConfigs(loaded),
    availableObsmKeys: sortObsmKeys([...new Set(allObsmKeys)]),
    spatial,
    hidden,
    detectedObsColumns: firstColumns.filter((column) => !column.startsWith("__") && !hidden.has(column)),
  };
}

export async function discoverObsmKeys(adata: DatasetHandle): Promise<string[]> {
  const listed = await adata.listObsmKeys();
  if (listed) return listed;

  const candidates = [
    "X_umap",
    "X_tsne",
    "X_phate",
    "X_pca",
    "X_scvi",
    "X_draw_graph_fr",
    "X_diffmap",
    "X_harmony",
    "X_scanorama",
  ];
  const keys: string[] = [];
  for (const key of candidates) {
    try {
      await adata.getObsmShape(key);
      keys.push(key);
    } catch {
      // The fallback probes a fixed candidate set; absence is expected.
    }
  }
  return keys;
}

export function sortObsmKeys(keys: readonly string[]): string[] {
  const priority = new Map(DEFAULT_OBSM_PRIORITY.map((key, index) => [key, index]));
  return keys.toSorted((left, right) => {
    const leftPriority = priority.get(left) ?? 999;
    const rightPriority = priority.get(right) ?? 999;
    return leftPriority === rightPriority ? left.localeCompare(right) : leftPriority - rightPriority;
  });
}
