import type { NodeHost } from "@ndea/sdk";

export interface DatasetConfig {
  datasetKey: string | null;
}

export type DatasetCapabilities = "data-read";
export type DatasetNodeHost = NodeHost<DatasetConfig, DatasetCapabilities>;
