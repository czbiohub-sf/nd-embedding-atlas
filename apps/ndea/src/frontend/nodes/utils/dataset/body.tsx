import { useState } from "react";

import type { NodeBodyProps } from "@/core/node/app-node-host";
import type { DatasetCapabilities, DatasetConfig } from "./node";

interface DatasetConfigHost {
  patchConfig(patch: Partial<DatasetConfig>): void;
}

export function patchDatasetKey(host: DatasetConfigHost, value: string): string {
  host.patchConfig({ datasetKey: value || null });
  return value;
}

export function DatasetBody({ host }: NodeBodyProps<DatasetConfig, DatasetCapabilities>) {
  const keys = host.data.metadata.dataset_keys ?? [];
  const [datasetKey, setDatasetKey] = useState(host.config.datasetKey ?? "");

  if (keys.length <= 1) {
    return <div className="font-mono text-3xs text-text-muted">single dataset · no _dataset split</div>;
  }

  return (
    <div className="flex flex-col gap-[7px]" data-nodrag="1">
      <span className="font-mono text-3xs text-text-muted">_dataset</span>
      <select
        value={datasetKey}
        onChange={(event) => {
          setDatasetKey(patchDatasetKey(host, event.target.value));
        }}
        title={datasetKey || "all datasets"}
        className="nodrag w-full truncate rounded border border-border bg-muted px-1.5 py-1 font-mono text-3xs text-foreground"
      >
        <option value="">all datasets</option>
        {keys.map((key) => (
          <option key={key} value={key}>
            {key}
          </option>
        ))}
      </select>
    </div>
  );
}
