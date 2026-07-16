import type { DatasetConfig } from "./node";

export interface DatasetConfigHost {
  patchConfig(patch: Partial<DatasetConfig>): void;
}

export function patchDatasetKey(host: DatasetConfigHost, value: string): string {
  host.patchConfig({ datasetKey: value || null });
  return value;
}
